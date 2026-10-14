import { execFile } from 'node:child_process';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app';
import { openDb } from '../src/db';
import type { DB } from '../src/db';
import { createToken } from '../src/auth/tokens';
import { createUser } from '../src/auth/users';
import { hashPassword } from '../src/auth/password';

export class Client {
  cookies = new Map<string, string>();

  constructor(private base: string) {}

  async req(p: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    const res = await fetch(this.base + p, { ...init, headers, redirect: 'manual' });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (value === '' || /expires=thu, 01 jan 1970/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }

  async post(p: string, fields: Record<string, string>): Promise<Response> {
    await this.req('/login');
    const body = new URLSearchParams({ ...fields, _csrf: this.cookies.get('gh_csrf')! });
    return this.req(p, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  async login(username: string, password = 'correct horse'): Promise<void> {
    const res = await this.post('/login', { login: username, password, next: '/' });
    if (res.status !== 302) throw new Error(`login failed for ${username}: ${res.status}`);
  }
}

export interface TestEnv {
  db: DB;
  base: string;
  reposDir: string;
  client(): Client;
  addUser(username: string): { id: number; username: string; token: string };
  close(): Promise<void>;
}

export async function startEnv(opts: { maxPushBytes?: number } = {}): Promise<TestEnv> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geekhub-test-'));
  const reposDir = path.join(dir, 'repos');
  const db = openDb(':memory:');
  const server = createApp({ db, rateLimit: false, reposDir, maxPushBytes: opts.maxPushBytes }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const hash = await hashPassword('correct horse');
  return {
    db,
    base,
    reposDir,
    client: () => new Client(base),
    addUser(username) {
      const user = createUser(db, username, `${username}@example.com`, hash);
      return { ...user, token: createToken(db, user.id, 'test') };
    },
    async close() {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function basic(token: string, user = 'x'): string {
  return 'Basic ' + Buffer.from(`${user}:${token}`).toString('base64');
}

export function git(args: string[], opts: { cwd?: string; input?: string; gitDir?: string } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  const full = opts.gitDir ? ['--git-dir', opts.gitDir, ...args] : args;
  return new Promise((resolve) => {
    const child = execFile(
      'git',
      ['-c', 'credential.helper=', '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...full],
      { cwd: opts.cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'true', GCM_INTERACTIVE: 'never' }, windowsHide: true },
      (err, stdout, stderr) =>
        resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) }),
    );
    if (opts.input !== undefined) child.stdin!.end(opts.input);
  });
}
