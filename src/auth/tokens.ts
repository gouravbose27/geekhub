import crypto from 'node:crypto';
import type { DB } from '../db';
import type { User } from './users';

export interface AccessToken {
  id: number;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

export const TOKEN_PREFIX = 'ghp_';

// Tokens are 256-bit random values, so a fast hash is sufficient.
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createToken(db: DB, userId: number, name: string): string {
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO access_tokens (user_id, token_hash, name) VALUES (?, ?, ?)').run(
    userId,
    hashToken(token),
    name,
  );
  return token;
}

export function listTokens(db: DB, userId: number): AccessToken[] {
  return db
    .prepare(
      'SELECT id, name, created_at, last_used_at FROM access_tokens WHERE user_id = ? ORDER BY id DESC',
    )
    .all(userId) as AccessToken[];
}

export function revokeToken(db: DB, userId: number, tokenId: number): boolean {
  return (
    db.prepare('DELETE FROM access_tokens WHERE id = ? AND user_id = ?').run(tokenId, userId)
      .changes > 0
  );
}

// Used by the git transport for Basic auth: any username, token as password.
export function authenticateToken(db: DB, token: string): User | undefined {
  const hash = hashToken(token);
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.email, t.id AS token_id FROM access_tokens t
       JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?`,
    )
    .get(hash) as (User & { token_id: number }) | undefined;
  if (!row) return undefined;
  db.prepare("UPDATE access_tokens SET last_used_at = datetime('now') WHERE id = ?").run(row.token_id);
  return { id: row.id, username: row.username, email: row.email };
}
