import type { DB } from '../db';

export interface User {
  id: number;
  username: string;
  email: string;
}

export interface UserWithHash extends User {
  password_hash: string;
}

export function createUser(db: DB, username: string, email: string, passwordHash: string): User {
  const info = db
    .prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)')
    .run(username, email, passwordHash);
  return { id: Number(info.lastInsertRowid), username, email };
}

export function usernameTaken(db: DB, username: string): boolean {
  return db.prepare('SELECT 1 FROM users WHERE username = ?').get(username) !== undefined;
}

export function emailTaken(db: DB, email: string): boolean {
  return db.prepare('SELECT 1 FROM users WHERE email = ?').get(email) !== undefined;
}

export function findByLogin(db: DB, login: string): UserWithHash | undefined {
  return db
    .prepare('SELECT id, username, email, password_hash FROM users WHERE username = ? OR email = ?')
    .get(login, login) as UserWithHash | undefined;
}

export function updatePassword(db: DB, userId: number, passwordHash: string): void {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
}

export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === 'SQLITE_CONSTRAINT_UNIQUE';
}
