import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { migrate, openDb } from '../src/db';
import { authenticateToken, createToken, listTokens } from '../src/auth/tokens';
import { validateTokenExpiry } from '../src/auth/validation';
import { createRepo } from '../src/repos/repos';
import { basic, startEnv } from './helpers';
import type { TestEnv } from './helpers';

let env: TestEnv;
let userId: number;
const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const futureExpiry = Date.parse(`${futureDate}T00:00:00.000Z`);

before(async () => {
  env = await startEnv();
  userId = env.addUser('alice').id;
  env.addUser('bob');
});

after(() => env.close());

describe('token expiry', () => {
  it('validates real future dates while allowing no expiration', () => {
    assert.equal(validateTokenExpiry(''), null);
    assert.equal(validateTokenExpiry(futureDate), null);
    for (const value of ['invalid', '2099-02-30', '2099-13-01', '2099-1-01', '2000-01-01',
      new Date().toISOString().slice(0, 10)]) {
      assert.ok(validateTokenExpiry(value), value);
    }
  });

  it('preserves non-expiring tokens when migrating an existing database', () => {
    const db = openDb(':memory:');
    try {
      db.exec('ALTER TABLE access_tokens DROP COLUMN expires_at');
      db.pragma('user_version = 2');
      db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)').run(
        'legacy', 'legacy@example.com', 'unused',
      );
      db.prepare('INSERT INTO access_tokens (user_id, token_hash, name) VALUES (?, ?, ?)').run(
        1, 'legacy-hash', 'legacy token',
      );
      migrate(db);
      migrate(db);
      assert.equal(listTokens(db, 1)[0].expires_at, null);
      assert.equal(listTokens(db, 1)[0].name, 'legacy token');
    } finally {
      db.close();
    }
  });

  it('authenticates future and non-expiring tokens but rejects expired tokens at the boundary', (t) => {
    const token = createToken(env.db, userId, 'expiring', futureExpiry);
    const permanent = createToken(env.db, userId, 'permanent');
    assert.equal(listTokens(env.db, userId).find((row) => row.name === 'expiring')?.expires_at, futureExpiry);
    assert.equal(authenticateToken(env.db, token)?.id, userId);
    env.db.prepare('UPDATE access_tokens SET last_used_at = NULL WHERE name = ?').run('expiring');
    t.mock.method(Date, 'now', () => futureExpiry);
    assert.equal(authenticateToken(env.db, token), undefined);
    assert.equal(listTokens(env.db, userId).find((row) => row.name === 'expiring')?.last_used_at, null);
    assert.equal(authenticateToken(env.db, permanent)?.id, userId);
    assert.throws(() => createToken(env.db, userId, 'past', futureExpiry));
    assert.throws(() => createToken(env.db, userId, 'invalid', NaN));
  });

  it('shows expiration dates, expired status and Never without showing stored token plaintext', async () => {
    const client = env.client();
    await client.login('alice');
    const response = await client.post('/settings/tokens', { name: 'dated token', expires_at: futureDate });
    assert.equal(response.status, 200);
    const html = await response.text();
    const token = html.match(/ghp_[A-Za-z0-9_-]+/)![0];
    assert.match(html, /Expires \(UTC\)/);
    assert.ok(html.includes(futureDate));
    const list = await (await client.req('/settings/tokens')).text();
    assert.ok(!list.includes(token));
    assert.match(list, /Never/);
    env.db.prepare('UPDATE access_tokens SET expires_at = ? WHERE name = ?').run(1, 'dated token');
    const expired = await (await client.req('/settings/tokens')).text();
    assert.match(expired, /1970-01-01 \(Expired\)/);
    await createRepo(env.db, env.reposDir, { id: userId, username: 'alice', email: 'alice@example.com' }, 'demo', '');
    const denied = await env.client().req('/alice/demo.git/info/refs?service=git-receive-pack', {
      headers: { authorization: basic(token) },
    });
    assert.equal(denied.status, 401);
  });

  it('rejects invalid expiration input without creating a token', async () => {
    const client = env.client();
    await client.login('alice');
    const count = listTokens(env.db, userId).length;
    for (const expires_at of ['2099-02-30', '2000-01-01', '<script>alert(1)</script>']) {
      const response = await client.post('/settings/tokens', { name: 'invalid', expires_at });
      assert.equal(response.status, 400);
      assert.ok(!(await response.text()).includes('<script>alert(1)</script>'));
    }
    assert.equal(listTokens(env.db, userId).length, count);
  });

  it('keeps token listings and revocation scoped to the owner', async () => {
    const client = env.client();
    await client.login('bob');
    const token = listTokens(env.db, userId).find((row) => row.name === 'dated token')!;
    assert.ok(!(await (await client.req('/settings/tokens')).text()).includes('dated token'));
    await client.post(`/settings/tokens/${token.id}/revoke`, {});
    assert.ok(listTokens(env.db, userId).some((row) => row.id === token.id));
  });
});
