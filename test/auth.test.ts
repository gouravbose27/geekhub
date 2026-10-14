import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app';
import { openDb } from '../src/db';
import { authenticateToken } from '../src/auth/tokens';

let server: ReturnType<ReturnType<typeof createApp>['listen']>;
let base: string;
const db = openDb(':memory:');

class Client {
  cookies = new Map<string, string>();

  async req(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    const res = await fetch(base + path, { ...init, headers, redirect: 'manual' });
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

  async csrf(path = '/login'): Promise<string> {
    await this.req(path);
    return this.cookies.get('gh_csrf')!;
  }

  async post(path: string, fields: Record<string, string>, withCsrf = true): Promise<Response> {
    const body = new URLSearchParams(fields);
    if (withCsrf) body.set('_csrf', await this.csrf());
    return this.req(path, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
  }
}

const signupFields = {
  username: 'alice',
  email: 'alice@example.com',
  password: 'correct horse',
  confirm: 'correct horse',
};

before(async () => {
  server = createApp({ db, rateLimit: false }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  db.close();
});

describe('auth', () => {
  it('rejects POST without a CSRF token', async () => {
    const res = await new Client().post('/signup', signupFields, false);
    assert.equal(res.status, 403);
  });

  it('validates sign-up input', async () => {
    const c = new Client();
    const res = await c.post('/signup', { ...signupFields, username: 'login', password: 'x', confirm: 'y' });
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.match(html, /reserved/);
    assert.match(html, /at least 8/);
    assert.match(html, /do not match/);
  });

  it('signs up, stores only a password hash, and starts a session', async () => {
    const c = new Client();
    const res = await c.post('/signup', signupFields);
    assert.equal(res.status, 302);
    assert.ok(c.cookies.has('gh_session'));
    const row = db.prepare('SELECT password_hash FROM users WHERE username = ?').get('alice') as {
      password_hash: string;
    };
    assert.notEqual(row.password_hash, signupFields.password);
    const home = await (await c.req('/')).text();
    assert.match(home, /Signed in as <strong>alice/);
  });

  it('rejects duplicate username and email case-insensitively', async () => {
    const res = await new Client().post('/signup', { ...signupFields, username: 'ALICE', email: 'ALICE@example.com' });
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.match(html, /already taken/);
    assert.match(html, /already registered/);
  });

  it('logs in with a generic error on failure, and redirects only to local paths', async () => {
    const c = new Client();
    const bad = await c.post('/login', { login: 'alice', password: 'wrong', next: '/' });
    assert.equal(bad.status, 401);
    const missing = await c.post('/login', { login: 'nobody', password: 'wrong', next: '/' });
    assert.equal(missing.status, 401);
    assert.equal((await bad.text()).includes('Invalid username or password.'), true);

    const evil = await c.post('/login', { login: 'alice@example.com', password: 'correct horse', next: '//evil.com' });
    assert.equal(evil.status, 302);
    assert.equal(evil.headers.get('location'), '/');
  });

  it('logs out and invalidates the session', async () => {
    const c = new Client();
    await c.post('/login', { login: 'alice', password: 'correct horse', next: '/' });
    const token = c.cookies.get('gh_session')!;
    await c.post('/logout', {});
    assert.equal(c.cookies.has('gh_session'), false);

    const stale = new Client();
    stale.cookies.set('gh_session', token);
    assert.match(await (await stale.req('/')).text(), /Sign in/);
  });
});

describe('access tokens', () => {
  it('requires authentication', async () => {
    const res = await new Client().req('/settings/tokens');
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location')!, /^\/login\?next=/);
  });

  it('creates a token shown once, stores only its hash, and revokes it', async () => {
    const c = new Client();
    await c.post('/login', { login: 'alice', password: 'correct horse', next: '/' });

    const created = await c.post('/settings/tokens', { name: 'laptop' });
    assert.equal(created.status, 200);
    const token = (await created.text()).match(/ghp_[A-Za-z0-9_-]+/)![0];

    const stored = db.prepare('SELECT token_hash FROM access_tokens').all() as { token_hash: string }[];
    assert.equal(stored.length, 1);
    assert.ok(!stored[0].token_hash.includes(token));

    const list = await (await c.req('/settings/tokens')).text();
    assert.ok(!list.includes(token));
    assert.match(list, /laptop/);

    assert.equal(authenticateToken(db, token)?.username, 'alice');
    assert.equal(authenticateToken(db, 'ghp_bogus'), undefined);

    const id = (db.prepare('SELECT id FROM access_tokens').get() as { id: number }).id;
    await c.post(`/settings/tokens/${id}/revoke`, {});
    assert.equal(authenticateToken(db, token), undefined);
  });
});
