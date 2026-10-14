import type { DB } from '../db';
import type { User } from '../auth/users';
import type { Repo } from './repos';

// Single source of truth for repository authorization.

export function canRead(_repo: Repo, _user?: User): boolean {
  return true;
}

export function isOwner(repo: Repo, user?: User): boolean {
  return !!user && user.id === repo.owner_id;
}

export function canWrite(db: DB, repo: Repo, user?: User): boolean {
  if (!user) return false;
  if (isOwner(repo, user)) return true;
  return (
    db
      .prepare("SELECT 1 FROM collaborators WHERE repo_id = ? AND user_id = ? AND role = 'write'")
      .get(repo.id, user.id) !== undefined
  );
}
