import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { git, startEnv } from './helpers';
import type { TestEnv } from './helpers';
import { createRepo, repoPath } from '../src/repos/repos';

let env: TestEnv;
let sha: string;

const EVIL_NAME = '<img src=x onerror=alert(1)>.txt';
const EVIL_MSG = '<script>alert("msg")</script>';
const README = [
  '# Title',
  '<script>alert("readme")</script>',
  '<img src="https://example.com/x.png" onerror="alert(2)">',
  '[click](javascript:alert(3))',
  '<a href="data:text/html,x" onclick="alert(4)">d</a>',
].join('\n');

async function plumb(gitDir: string, args: string[], input?: string): Promise<string> {
  const r = await git(args, { gitDir, input });
  assert.equal(r.code, 0, r.stderr);
  return r.stdout.trim();
}

before(async () => {
  env = await startEnv();
  const user = env.addUser('mallory');
  await createRepo(env.db, env.reposDir, user, 'xss', '<b>desc</b>');
  const dir = repoPath(env.reposDir, 'mallory', 'xss');

  const readme = await plumb(dir, ['hash-object', '-w', '--stdin'], README);
  const file = await plumb(dir, ['hash-object', '-w', '--stdin'], '<script>alert("file")</script>\n');
  const tree = await plumb(dir, ['mktree'], `100644 blob ${readme}\tREADME.md\n100644 blob ${file}\t${EVIL_NAME}\n`);
  sha = await plumb(dir, ['commit-tree', tree, '-m', EVIL_MSG]);
  await plumb(dir, ['update-ref', 'refs/heads/main', sha]);
});

after(() => env.close());

async function page(p: string): Promise<{ status: number; html: string }> {
  const res = await env.client().req(p);
  return { status: res.status, html: await res.text() };
}

function assertNoActiveContent(html: string): void {
  assert.ok(!/<script>alert/.test(html), 'raw script tag present');
  assert.ok(!/<img[^>]+onerror/i.test(html), 'event handler on element');
  assert.ok(!/<[a-z][^>]*\sonclick=/i.test(html), 'onclick present');
  assert.ok(!/href="javascript:/i.test(html), 'javascript: link present');
  assert.ok(!/href="data:/i.test(html), 'data: link present');
}

describe('output escaping', () => {
  it('sanitizes the rendered README', async () => {
    const { status, html } = await page('/mallory/xss');
    assert.equal(status, 200);
    assert.match(html, /<h1>Title<\/h1>/);
    assertNoActiveContent(html);
  });

  it('escapes file names, repo descriptions, commit messages, and file contents', async () => {
    const home = await page('/mallory/xss');
    assert.ok(home.html.includes('&lt;img src=x onerror=alert(1)&gt;.txt'));

    const explore = await page('/explore');
    assert.ok(explore.html.includes('&lt;b&gt;desc&lt;/b&gt;'));

    const commits = await page('/mallory/xss/commits');
    assert.ok(commits.html.includes('&lt;script&gt;alert(&#34;msg&#34;)&lt;/script&gt;'));
    assertNoActiveContent(commits.html);

    const commit = await page(`/mallory/xss/commit/${sha}`);
    assert.equal(commit.status, 200);
    assertNoActiveContent(commit.html);
    assert.ok(commit.html.includes('&lt;script&gt;alert(&#34;msg&#34;)&lt;/script&gt;'));

    const blob = await page(`/mallory/xss/blob/main/${encodeURIComponent(EVIL_NAME)}`);
    assert.equal(blob.status, 200);
    assertNoActiveContent(blob.html);
    assert.ok(blob.html.includes('&lt;script&gt;alert(&#34;file&#34;)&lt;/script&gt;'));
  });

  it('sends a restrictive Content-Security-Policy', async () => {
    const res = await env.client().req('/mallory/xss');
    const csp = res.headers.get('content-security-policy')!;
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /script-src-attr 'none'/);
  });
});

describe('argument injection and traversal', () => {
  it('rejects refs and shas that look like options or revision syntax', async () => {
    for (const p of [
      '/mallory/xss/tree/--output=pwned',
      '/mallory/xss/tree/-x',
      '/mallory/xss/tree/main..main',
      '/mallory/xss/blob/--help/README.md',
      '/mallory/xss/commits/--all',
      '/mallory/xss/commit/-1',
      '/mallory/xss/commit/--stat',
      '/mallory/xss/commit/HEAD',
      '/mallory/xss/commit/deadbeef',
    ]) {
      assert.equal((await page(p)).status, 404, p);
    }
  });

  it('rejects path traversal in tree and blob paths', async () => {
    for (const p of [
      '/mallory/xss/blob/main/..%2F..%2Fconfig',
      '/mallory/xss/blob/main/%2e%2e/config',
      '/mallory/xss/tree/main/%2e%2e',
      '/mallory/xss/blob/main/README.md%00',
    ]) {
      assert.equal((await page(p)).status, 404, p);
    }
  });

  it('serves only the smart HTTP protocol endpoints', async () => {
    for (const p of ['HEAD', 'config', 'objects/info/packs', 'info/refs']) {
      const res = await fetch(`${env.base}/mallory/xss.git/${p}`);
      assert.equal(res.status, 404, p);
    }
    const dumb = await fetch(`${env.base}/mallory/..%2Fxss.git/info/refs?service=git-upload-pack`);
    assert.equal(dumb.status, 404);
  });
});
