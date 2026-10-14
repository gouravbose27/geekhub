import crypto from 'node:crypto';
import type { DB } from '../db';

const RESET_TTL_MS = 60 * 60 * 1000;

export interface PasswordResetToken {
  token_hash: string;
  user_id: number;
  expires_at: number;
}

function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createPasswordResetToken(db: DB, userId: number): string {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ? OR expires_at <= ?').run(userId, Date.now());
  db.prepare('INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    tokenHash(token),
    userId,
    Date.now() + RESET_TTL_MS,
  );
  return token;
}

export function getPasswordResetToken(db: DB, token: string): PasswordResetToken | undefined {
  if (token.length < 32) return undefined;
  return db
    .prepare('SELECT token_hash, user_id, expires_at FROM password_reset_tokens WHERE token_hash = ? AND expires_at > ?')
    .get(tokenHash(token), Date.now()) as PasswordResetToken | undefined;
}

export function deletePasswordResetToken(db: DB, tokenHashValue: string): void {
  db.prepare('DELETE FROM password_reset_tokens WHERE token_hash = ?').run(tokenHashValue);
}

export function deletePasswordResetTokensForUser(db: DB, userId: number): void {
  db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(userId);
}
