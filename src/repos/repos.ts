import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db';
import { initBare } from '../git/cli';
import { isUniqueViolation } from '../auth/users';

export interface Repo {
  id: number;
  owner_id: number;
  owner: string;
  name: string;
  description: string;
  created_at: string;
}

export const PAGE_SIZE = 20;

const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;
// Reserved device names would break on Windows filesystems.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

export function validateRepoName(name: string): string | null {
  if (!NAME_RE.test(name)) return 'Name must be 1-100 characters: letters, digits, ".", "_" or "-".';
  if (name === '.' || name === '..' || name.endsWith('.') || name.toLowerCase().endsWith('.git')) {
    return 'That name is not allowed.';
  }
  if (WINDOWS_RESERVED.test(name)) return 'That name is not allowed.';
  return null;
}

export function validateDescription(desc: string): string | null {
  return desc.length > 500 ? 'Description must be at most 500 characters.' : null;
}

// Resolved path must stay inside reposDir even if inputs are unexpected.
export function repoPath(reposDir: string, owner: string, name: string): string {
  const root = path.resolve(reposDir);
  const p = path.resolve(root, owner, `${name}.git`);
  if (!p.startsWith(root + path.sep) || path.dirname(path.dirname(p)) !== root) {
    throw new Error('Repository path escapes the repositories directory');
  }
  return p;
}

const SELECT = `SELECT r.id, r.owner_id, u.username AS owner, r.name, r.description, r.created_at
                FROM repositories r JOIN users u ON u.id = r.owner_id`;

export function getRepo(db: DB, owner: string, name: string): Repo | undefined {
  return db.prepare(`${SELECT} WHERE u.username = ? AND r.name = ?`).get(owner, name) as Repo | undefined;
}

export class RepoExistsError extends Error {}

export async function createRepo(
  db: DB,
  reposDir: string,
  owner: { id: number; username: string },
  name: string,
  description: string,
): Promise<Repo> {
  let id: number;
  try {
    id = Number(
      db
        .prepare('INSERT INTO repositories (owner_id, name, description) VALUES (?, ?, ?)')
        .run(owner.id, name, description).lastInsertRowid,
    );
  } catch (err) {
    if (isUniqueViolation(err)) throw new RepoExistsError();
    throw err;
  }
  const dir = repoPath(reposDir, owner.username, name);
  try {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await initBare(dir);
  } catch (err) {
    db.prepare('DELETE FROM repositories WHERE id = ?').run(id);
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  return getRepo(db, owner.username, name)!;
}

export function deleteRepo(db: DB, reposDir: string, repo: Repo): void {
  db.prepare('DELETE FROM repositories WHERE id = ?').run(repo.id);
  fs.rmSync(repoPath(reposDir, repo.owner, repo.name), { recursive: true, force: true });
}

export function searchRepos(db: DB, q: string, page: number): { repos: Repo[]; hasNext: boolean } {
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const rows = db
    .prepare(
      `${SELECT} WHERE r.name LIKE ? ESCAPE '\\' OR r.description LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\'
       ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`,
    )
    .all(like, like, like, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE) as Repo[];
  return { repos: rows.slice(0, PAGE_SIZE), hasNext: rows.length > PAGE_SIZE };
}

export function listOwnedRepos(db: DB, ownerId: number): Repo[] {
  return db.prepare(`${SELECT} WHERE r.owner_id = ? ORDER BY r.name`).all(ownerId) as Repo[];
}

export function listSharedRepos(db: DB, userId: number): Repo[] {
  return db
    .prepare(`${SELECT} JOIN collaborators c ON c.repo_id = r.id WHERE c.user_id = ? ORDER BY u.username, r.name`)
    .all(userId) as Repo[];
}

export interface Collaborator {
  user_id: number;
  username: string;
  role: string;
}

export function listCollaborators(db: DB, repoId: number): Collaborator[] {
  return db
    .prepare(
      `SELECT c.user_id, u.username, c.role FROM collaborators c
       JOIN users u ON u.id = c.user_id WHERE c.repo_id = ? ORDER BY u.username`,
    )
    .all(repoId) as Collaborator[];
}

export type AddCollaboratorResult = 'added' | 'no-such-user' | 'is-owner';

export function addCollaborator(db: DB, repo: Repo, username: string): AddCollaboratorResult {
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined;
  if (!user) return 'no-such-user';
  if (user.id === repo.owner_id) return 'is-owner';
  db.prepare("INSERT OR IGNORE INTO collaborators (repo_id, user_id, role) VALUES (?, ?, 'write')").run(repo.id, user.id);
  return 'added';
}

export function removeCollaborator(db: DB, repo: Repo, userId: number): void {
  db.prepare('DELETE FROM collaborators WHERE repo_id = ? AND user_id = ?').run(repo.id, userId);
}
