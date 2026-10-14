import { execFile } from 'node:child_process';

export const MAX_BLOB_VIEW_BYTES = 1024 * 1024;
export const MAX_DIFF_BYTES = 1024 * 1024;

const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const SHA_RE = /^[0-9a-fA-F]{4,40}$/;

// Refs and shas reach git as arguments, so reject anything that could be read as an option or revision syntax.
export function isValidRef(ref: string): boolean {
  return REF_RE.test(ref) && !ref.includes('..') && !ref.includes('//') && !ref.endsWith('/') && !ref.endsWith('.lock');
}

export function isValidSha(sha: string): boolean {
  return SHA_RE.test(sha);
}

// Returns a normalized tree path, or null when any segment could escape or confuse git.
export function normalizePath(segments: string | string[] | undefined): string | null {
  const parts = segments === undefined ? [] : Array.isArray(segments) ? segments : [segments];
  for (const p of parts) {
    if (p === '' || p === '.' || p === '..' || /[\x00-\x1f]/.test(p) || p.includes('/')) return null;
  }
  return parts.join('/');
}

export class GitError extends Error {}

interface RunResult {
  stdout: Buffer;
  truncated: boolean;
}

function run(gitDir: string, args: string[], maxBuffer = 16 * 1024 * 1024): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['--git-dir', gitDir, '-c', 'core.quotepath=false', ...args],
      {
        encoding: 'buffer',
        maxBuffer,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
      },
      (err, stdout, stderr) => {
        if (!err) return resolve({ stdout, truncated: false });
        if ((err as NodeJS.ErrnoException).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          return resolve({ stdout, truncated: true });
        }
        reject(new GitError(stderr.toString('utf8').trim() || err.message));
      },
    );
  });
}

async function text(gitDir: string, args: string[], maxBuffer?: number): Promise<string> {
  return (await run(gitDir, args, maxBuffer)).stdout.toString('utf8');
}

export async function initBare(gitDir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile('git', ['init', '--bare', '--initial-branch=main', '--', gitDir], { windowsHide: true }, (err, _o, stderr) =>
      err ? reject(new GitError(String(stderr).trim() || err.message)) : resolve(),
    );
  });
}

// Resolves a branch, tag, or sha to a full commit sha; null if it does not exist.
export async function resolveCommit(gitDir: string, rev: string): Promise<string | null> {
  try {
    const out = await text(gitDir, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${rev}^{commit}`]);
    return out.trim() || null;
  } catch {
    return null;
  }
}

export async function listRefs(gitDir: string): Promise<{ branches: string[]; tags: string[] }> {
  const out = await text(gitDir, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/tags']);
  const branches: string[] = [];
  const tags: string[] = [];
  for (const line of out.split('\n')) {
    if (line.startsWith('refs/heads/')) branches.push(line.slice('refs/heads/'.length));
    else if (line.startsWith('refs/tags/')) tags.push(line.slice('refs/tags/'.length));
  }
  return { branches, tags };
}

// HEAD's branch if it exists, else any branch; null for an empty repo.
export async function defaultRef(gitDir: string): Promise<string | null> {
  try {
    const head = (await text(gitDir, ['symbolic-ref', '--quiet', 'HEAD'])).trim();
    if (head.startsWith('refs/heads/') && (await resolveCommit(gitDir, head))) {
      return head.slice('refs/heads/'.length);
    }
  } catch {
    // detached or missing HEAD: fall through
  }
  const { branches } = await listRefs(gitDir);
  return branches[0] ?? null;
}

export interface TreeEntry {
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size: number | null;
  name: string;
}

export async function listTree(gitDir: string, commit: string, dir: string): Promise<TreeEntry[] | null> {
  const spec = dir ? `${commit}:${dir}` : commit;
  let out: string;
  try {
    out = await text(gitDir, ['ls-tree', '-z', '-l', '--end-of-options', spec]);
  } catch {
    return null;
  }
  const entries: TreeEntry[] = [];
  for (const rec of out.split('\0')) {
    const m = /^(\d+) (blob|tree|commit) ([0-9a-f]+) +(-|\d+)\t([\s\S]+)$/.exec(rec);
    if (!m) continue;
    entries.push({ mode: m[1], type: m[2] as TreeEntry['type'], sha: m[3], size: m[4] === '-' ? null : Number(m[4]), name: m[5] });
  }
  entries.sort((a, b) => Number(b.type === 'tree') - Number(a.type === 'tree') || a.name.localeCompare(b.name));
  return entries;
}

export type BlobResult =
  | { kind: 'missing' }
  | { kind: 'tree' }
  | { kind: 'large'; size: number }
  | { kind: 'binary'; size: number }
  | { kind: 'text'; size: number; content: string };

export async function readBlob(gitDir: string, commit: string, filePath: string): Promise<BlobResult> {
  const spec = `${commit}:${filePath}`;
  let type: string;
  try {
    type = (await text(gitDir, ['cat-file', '-t', '--end-of-options', spec])).trim();
  } catch {
    return { kind: 'missing' };
  }
  if (type === 'tree') return { kind: 'tree' };
  if (type !== 'blob') return { kind: 'missing' };
  const size = Number((await text(gitDir, ['cat-file', '-s', '--end-of-options', spec])).trim());
  if (size > MAX_BLOB_VIEW_BYTES) return { kind: 'large', size };
  const { stdout } = await run(gitDir, ['cat-file', 'blob', '--end-of-options', spec], MAX_BLOB_VIEW_BYTES + 1);
  if (stdout.subarray(0, 8000).includes(0)) return { kind: 'binary', size };
  return { kind: 'text', size, content: stdout.toString('utf8') };
}

export interface CommitSummary {
  sha: string;
  shortSha: string;
  author: string;
  date: string;
  subject: string;
}

export async function logCommits(gitDir: string, commit: string, skip: number, limit: number): Promise<CommitSummary[]> {
  const out = await text(gitDir, [
    'log',
    `--skip=${skip}`,
    `--max-count=${limit}`,
    '--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e',
    commit,
    '--',
  ]);
  return out
    .split('\x1e')
    .map((r) => r.replace(/^\n/, ''))
    .filter(Boolean)
    .map((r) => {
      const [sha, shortSha, author, date, subject] = r.split('\x1f');
      return { sha, shortSha, author, date, subject };
    });
}

export interface CommitDetail {
  sha: string;
  parents: string[];
  author: string;
  email: string;
  date: string;
  message: string;
  diff: string;
  truncated: boolean;
}

export async function showCommit(gitDir: string, commit: string): Promise<CommitDetail> {
  const meta = await text(gitDir, ['show', '-s', '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%B', commit, '--']);
  const [sha, parents, author, email, date, ...rest] = meta.split('\x1f');
  const diff = await run(
    gitDir,
    ['show', '--format=', '--patch', '--no-color', '--no-ext-diff', '--no-textconv', '-M', commit, '--'],
    MAX_DIFF_BYTES,
  );
  return {
    sha,
    parents: parents ? parents.split(' ') : [],
    author,
    email,
    date,
    message: rest.join('\x1f').trim(),
    diff: diff.stdout.toString('utf8'),
    truncated: diff.truncated,
  };
}
