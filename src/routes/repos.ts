import { Router } from 'express';
import type { Request, Response } from 'express';
import type { DB } from '../db';
import { requireAuth } from '../auth/middleware';
import {
  defaultRef,
  isValidRef,
  isValidSha,
  listRefs,
  listTree,
  logCommits,
  normalizePath,
  readBlob,
  resolveCommit,
  showCommit,
} from '../git/cli';
import { isOwner } from '../repos/permissions';
import { userContributions } from '../repos/contributions';
import { isMarkdownName, isReadmeName, MAX_README_BYTES, renderMarkdown } from '../repos/readme';
import {
  RepoExistsError,
  addCollaborator,
  createRepo,
  deleteRepo,
  getRepo,
  listCollaborators,
  listOwnedRepos,
  listSharedRepos,
  removeCollaborator,
  repoPath,
  searchRepos,
  validateDescription,
  validateRepoName,
} from '../repos/repos';
import type { Repo } from '../repos/repos';

const COMMITS_PER_PAGE = 30;

export interface RepoRoutesOptions {
  reposDir: string;
}

function notFound(res: Response): void {
  res.status(404).render('error', { title: 'Not found', message: 'Page not found.' });
}

function pageParam(value: unknown): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 10000 ? n : 1;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

function classifyDiff(diff: string): { cls: string; text: string }[] {
  return diff.split('\n').map((text) => {
    let cls = 'ctx';
    if (text.startsWith('diff --git') || text.startsWith('+++ ') || text.startsWith('--- ')) cls = 'meta';
    else if (text.startsWith('@@')) cls = 'hunk';
    else if (text.startsWith('+')) cls = 'add';
    else if (text.startsWith('-')) cls = 'del';
    return { cls, text };
  });
}

export function repoRouter(db: DB, opts: RepoRoutesOptions): Router {
  const router = Router();

  const load = (req: Request, res: Response): { repo: Repo; dir: string } | null => {
    const repo = getRepo(db, String(req.params.owner), String(req.params.repo));
    if (!repo) {
      notFound(res);
      return null;
    }
    return { repo, dir: repoPath(opts.reposDir, repo.owner, repo.name) };
  };

  const base = (req: Request, repo: Repo) => ({
    repo,
    owner: isOwner(repo, req.user),
    cloneUrl: `${req.protocol}://${req.get('host')}/${repo.owner}/${repo.name}.git`,
  });

  router.get('/dashboard', requireAuth, (req, res) => {
    res.render('dashboard', {
      title: 'Dashboard',
      owned: listOwnedRepos(db, req.user!.id),
      shared: listSharedRepos(db, req.user!.id),
    });
  });

  router.get('/explore', (req, res) => {
    const q = str(req.query.q).slice(0, 100);
    const page = pageParam(req.query.page);
    const { repos, hasNext } = searchRepos(db, q, page);
    res.render('explore', { title: 'Explore', q, page, repos, hasNext });
  });

  router.get('/new', requireAuth, (_req, res) => {
    res.render('new', { title: 'New repository', error: null, values: { name: '', description: '' } });
  });

  router.post('/new', requireAuth, async (req, res) => {
    const name = str(req.body.name);
    const description = str(req.body.description);
    const error = validateRepoName(name) ?? validateDescription(description);
    const fail = (status: number, message: string) =>
      res.status(status).render('new', { title: 'New repository', error: message, values: { name, description } });
    if (error) return fail(400, error);
    try {
      await createRepo(db, opts.reposDir, req.user!, name, description);
    } catch (err) {
      if (err instanceof RepoExistsError) return fail(400, 'You already have a repository with that name.');
      throw err;
    }
    res.redirect(`/${encodeURIComponent(req.user!.username)}/${encodeURIComponent(name)}`);
  });

  router.get('/:owner', async (req, res) => {
    const row = db.prepare('SELECT id, username, email FROM users WHERE username = ?').get(req.params.owner) as
      | { id: number; username: string; email: string }
      | undefined;
    if (!row) return notFound(res);
    res.render('profile', {
      title: row.username,
      profile: row,
      contributions: await userContributions(db, opts.reposDir, row),
      repos: listOwnedRepos(db, row.id),
    });
  });

  router.get('/:owner/:repo', async (req, res) => {
    const c = load(req, res);
    if (!c) return;
    const branch = await defaultRef(c.dir);
    if (!branch) {
      return res.render('repo', { title: `${c.repo.owner}/${c.repo.name}`, ...base(req, c.repo), active: 'code', empty: true });
    }
    const commit = (await resolveCommit(c.dir, branch))!;
    const entries = (await listTree(c.dir, commit, '')) ?? [];

    let readme: { name: string; html: string | null; text: string | null } | null = null;
    const file = entries.find((e) => e.type === 'blob' && isReadmeName(e.name) && (e.size ?? 0) <= MAX_README_BYTES);
    if (file) {
      const blob = await readBlob(c.dir, commit, file.name);
      if (blob.kind === 'text') {
        readme = isMarkdownName(file.name)
          ? { name: file.name, html: renderMarkdown(blob.content), text: null }
          : { name: file.name, html: null, text: blob.content };
      }
    }
    const refs = await listRefs(c.dir);
    res.render('repo', {
      title: `${c.repo.owner}/${c.repo.name}`,
      ...base(req, c.repo),
      active: 'code',
      empty: false,
      ref: branch,
      refs,
      entries,
      crumbs: [],
      dirPath: '',
      readme,
    });
  });

  router.get('/:owner/:repo/tree/:ref{/*path}', async (req, res) => {
    const c = load(req, res);
    if (!c) return;
    const ref = String(req.params.ref);
    const dirPath = normalizePath(req.params.path as string[] | undefined);
    if (dirPath === null || !isValidRef(ref)) return notFound(res);
    const commit = await resolveCommit(c.dir, ref);
    if (!commit) return notFound(res);
    const entries = await listTree(c.dir, commit, dirPath);
    if (!entries) return notFound(res);
    const parts = dirPath ? dirPath.split('/') : [];
    res.render('repo', {
      title: `${c.repo.owner}/${c.repo.name}`,
      ...base(req, c.repo),
      active: 'code',
      empty: false,
      ref,
      refs: await listRefs(c.dir),
      entries,
      crumbs: parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') })),
      dirPath,
      readme: null,
    });
  });

  router.get('/:owner/:repo/blob/:ref/*path', async (req, res) => {
    const c = load(req, res);
    if (!c) return;
    const ref = String(req.params.ref);
    const filePath = normalizePath(req.params.path as string[]);
    if (!filePath || !isValidRef(ref)) return notFound(res);
    const commit = await resolveCommit(c.dir, ref);
    if (!commit) return notFound(res);
    const blob = await readBlob(c.dir, commit, filePath);
    if (blob.kind === 'missing') return notFound(res);
    if (blob.kind === 'tree') {
      return res.redirect(`/${encodeURIComponent(c.repo.owner)}/${encodeURIComponent(c.repo.name)}/tree/${encodeURIComponent(ref)}/${encPath(filePath)}`);
    }
    const parts = filePath.split('/');
    res.render('blob', {
      title: `${filePath} · ${c.repo.owner}/${c.repo.name}`,
      ...base(req, c.repo),
      active: 'code',
      ref,
      filePath,
      crumbs: parts.slice(0, -1).map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') })),
      fileName: parts[parts.length - 1],
      blob,
    });
  });

  router.get('/:owner/:repo/commits{/:ref}', async (req, res) => {
    const c = load(req, res);
    if (!c) return;
    const ref = req.params.ref ? String(req.params.ref) : await defaultRef(c.dir);
    if (!ref) {
      return res.render('commits', { title: 'Commits', ...base(req, c.repo), active: 'commits', ref: null, commits: [], page: 1, hasNext: false });
    }
    if (!isValidRef(ref)) return notFound(res);
    const commit = await resolveCommit(c.dir, ref);
    if (!commit) return notFound(res);
    const page = pageParam(req.query.page);
    const rows = await logCommits(c.dir, commit, (page - 1) * COMMITS_PER_PAGE, COMMITS_PER_PAGE + 1);
    res.render('commits', {
      title: `Commits · ${c.repo.owner}/${c.repo.name}`,
      ...base(req, c.repo),
      active: 'commits',
      ref,
      commits: rows.slice(0, COMMITS_PER_PAGE),
      page,
      hasNext: rows.length > COMMITS_PER_PAGE,
    });
  });

  router.get('/:owner/:repo/commit/:sha', async (req, res) => {
    const c = load(req, res);
    if (!c) return;
    const sha = String(req.params.sha);
    if (!isValidSha(sha)) return notFound(res);
    const full = await resolveCommit(c.dir, sha);
    if (!full) return notFound(res);
    const detail = await showCommit(c.dir, full);
    res.render('commit', {
      title: `${detail.message.split('\n')[0]} · ${c.repo.owner}/${c.repo.name}`,
      ...base(req, c.repo),
      active: 'commits',
      commit: detail,
      diffLines: classifyDiff(detail.diff),
    });
  });

  // Owner-only management

  const ownerOnly = (req: Request, res: Response): { repo: Repo; dir: string } | null => {
    const c = load(req, res);
    if (!c) return null;
    if (!isOwner(c.repo, req.user)) {
      res.status(403).render('error', { title: 'Forbidden', message: 'Only the repository owner can do that.' });
      return null;
    }
    return c;
  };

  const renderSettings = (req: Request, res: Response, repo: Repo, extra: object = {}) =>
    res.render('repo_settings', {
      title: `Settings · ${repo.owner}/${repo.name}`,
      ...base(req, repo),
      active: 'settings',
      collaborators: listCollaborators(db, repo.id),
      error: null,
      ...extra,
    });

  const settingsUrl = (repo: Repo) => `/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/settings`;

  router.get('/:owner/:repo/settings', requireAuth, (req, res) => {
    const c = ownerOnly(req, res);
    if (c) renderSettings(req, res, c.repo);
  });

  router.post('/:owner/:repo/settings/collaborators', requireAuth, (req, res) => {
    const c = ownerOnly(req, res);
    if (!c) return;
    const result = addCollaborator(db, c.repo, str(req.body.username));
    if (result === 'added') return res.redirect(settingsUrl(c.repo));
    const error = result === 'no-such-user' ? 'No user with that username.' : 'The owner already has full access.';
    res.status(400);
    renderSettings(req, res, c.repo, { error });
  });

  router.post('/:owner/:repo/settings/collaborators/:userId/remove', requireAuth, (req, res) => {
    const c = ownerOnly(req, res);
    if (!c) return;
    const userId = Number(req.params.userId);
    if (Number.isInteger(userId)) removeCollaborator(db, c.repo, userId);
    res.redirect(settingsUrl(c.repo));
  });

  router.post('/:owner/:repo/settings/delete', requireAuth, (req, res) => {
    const c = ownerOnly(req, res);
    if (!c) return;
    if (str(req.body.confirm) !== c.repo.name) {
      res.status(400);
      return renderSettings(req, res, c.repo, { error: 'Type the repository name to confirm deletion.' });
    }
    deleteRepo(db, opts.reposDir, c.repo);
    res.redirect('/dashboard');
  });

  return router;
}
