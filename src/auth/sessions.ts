import crypto from 'node:crypto';
import type { DB } from '../db';
import type { User } from './users';

export const SESSION_COOKIE = 'gh_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Only the hash is stored, so a leaked database cannot be replayed as cookies.
function sessionId(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createSession(db: DB, userId: number): string {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(
    sessionId(token),
    userId,
    Date.now() + SESSION_TTL_MS,
  );
  return token;
}

export function getSessionUser(db: DB, token: string): User | undefined {
  return db
    .prepare(
      `SELECT u.id, u.username, u.email FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(sessionId(token), Date.now()) as User | undefined;
}

export function deleteSession(db: DB, token: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId(token));
}

export function deleteUserSessions(db: DB, userId: number): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function purgeExpiredSessions(db: DB): void {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}
