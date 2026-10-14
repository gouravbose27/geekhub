import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { git, startEnv } from './helpers';
import type { TestEnv } from './helpers';
import { createRepo } from '../src/repos/repos';

let env: TestEnv;
let small: TestEnv;
let work: string;
let alice: ReturnType<TestEnv['addUser']>;
let bob: ReturnType<TestEnv['addUser']>;
let smallAlice: ReturnType<TestEnv['addUser']>;

const urlFor = (e: TestEnv, owner: string, token?: string, repo = 'demo') =>
  e.base.replace('http://', `http://${token ? `x:${token}@` : ''}`) + `/${owner}/${repo}.git`;

const dir = (name: string) => path.join(work, name);

before(async () => {
  env = await startEnv();
  small = await startEnv({ maxPushBytes: 2000 });
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'geekhub-work-'));
  alice = env.addUser('alice');
  bob = env.addUser('bob');
  await createRepo(env.db, env.reposDir, alice, 'demo', '');
  smallAlice = small.addUser('alice');
  await createRepo(small.db, small.reposDir, smallAlice, 'demo', '');
});

after(async () => {
  await env.close();
  await small.close();
  fs.rmSync(work, { recursive: true, force: true });
});

async function ok(p: ReturnType<typeof git>): Promise<string> {
  const r = await p;
  assert.equal(r.code, 0, r.stderr);
  return r.stdout;
}

describe('clone and push over HTTP', () => {
  it('clones an empty repo, commits, and pushes with the owner token', async () => {
    await ok(git(['clone', urlFor(env, 'alice', alice.token), dir('a')]));
    await ok(git(['checkout', '-B', 'main'], { cwd: dir('a') }));
    fs.writeFileSync(path.join(dir('a'), 'hello.txt'), 'hello world\n');
    await ok(git(['add', '.'], { cwd: dir('a') }));
    await ok(git(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-m', 'first commit'], { cwd: dir('a') }));
    await ok(git(['push', 'origin', 'main'], { cwd: dir('a') }));
  });

  it('shows the pushed commit, tree, file, and diff in the UI', async () => {
    const c = env.client();
    const commits = await (await c.req('/alice/demo/commits')).text();
    assert.match(commits, /first commit/);
    const sha = commits.match(/\/alice\/demo\/commit\/([0-9a-f]{40})/)![1];

    assert.match(await (await c.req('/alice/demo')).text(), /hello\.txt/);
    assert.match(await (await c.req('/alice/demo/blob/main/hello.txt')).text(), /hello world/);
    const commit = await (await c.req(`/alice/demo/commit/${sha}`)).text();
    assert.match(commit, /\+hello world/);
    assert.match(commit, /class="add"/);
  });

  it('shows a GitHub-style contribution graph on user profiles', async () => {
    await createRepo(env.db, env.reposDir, alice, 'contrib', '');
    await ok(git(['clone', urlFor(env, 'alice', alice.token, 'contrib'), dir('contrib')]));
    fs.writeFileSync(path.join(dir('contrib'), 'note.txt'), 'profile contribution\n');
    await ok(git(['add', '.'], { cwd: dir('contrib') }));
    await ok(git(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '-m', 'profile contribution'], { cwd: dir('contrib') }));
    await ok(git(['push', 'origin', 'HEAD:main'], { cwd: dir('contrib') }));

    const html = await (await env.client().req('/alice')).text();
    assert.match(html, /class="contribution-graph"/);
    assert.match(html, /[1-9]\d*<\/strong> contributions? in the last year/);
    assert.match(html, /[1-9]\d* contributions on \d{4}-\d{2}-\d{2}/);
    assert.match(html, /class="contribution-day level-[1-4]"/);
  });

  it('allows anonymous clone', async () => {
    await ok(git(['clone', urlFor(env, 'alice'), dir('anon')]));
    assert.equal(fs.readFileSync(path.join(dir('anon'), 'hello.txt'), 'utf8').trim(), 'hello world');
  });

  it('rejects push without a token (401)', async () => {
    fs.writeFileSync(path.join(dir('anon'), 'a.txt'), 'x');
    await ok(git(['add', '.'], { cwd: dir('anon') }));
    await ok(git(['commit', '-m', 'anon'], { cwd: dir('anon') }));
    const r = await git(['push', 'origin', 'HEAD'], { cwd: dir('anon') });
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /401|Authentication|could not read Username/i);
  });

  it('rejects push from a non-collaborator (403) and accepts it once shared', async () => {
    await ok(git(['clone', urlFor(env, 'alice', bob.token), dir('b')]));
    fs.writeFileSync(path.join(dir('b'), 'bob.txt'), 'from bob\n');
    await ok(git(['add', '.'], { cwd: dir('b') }));
    await ok(git(['commit', '-m', 'bob was here'], { cwd: dir('b') }));

    const denied = await git(['push', 'origin', 'HEAD:main'], { cwd: dir('b') });
    assert.notEqual(denied.code, 0);
    assert.match(denied.stderr, /403/);

    const owner = env.client();
    await owner.login('alice');
    assert.equal((await owner.post('/alice/demo/settings/collaborators', { username: 'bob' })).status, 302);

    await ok(git(['push', 'origin', 'HEAD:main'], { cwd: dir('b') }));
    assert.match(await (await env.client().req('/alice/demo/commits')).text(), /bob was here/);
  });

  it('enforces the push size limit', async () => {
    await ok(git(['clone', urlFor(small, 'alice', smallAlice.token), dir('s')]));
    fs.writeFileSync(path.join(dir('s'), 'big.bin'), crypto.randomBytes(200 * 1024));
    await ok(git(['add', '.'], { cwd: dir('s') }));
    await ok(git(['commit', '-m', 'big'], { cwd: dir('s') }));
    const r = await git(['push', 'origin', 'HEAD:main'], { cwd: dir('s') });
    assert.notEqual(r.code, 0);
    assert.equal(await commitCount(small), 0);
  });
});

async function commitCount(e: TestEnv): Promise<number> {
  const html = await (await e.client().req('/alice/demo/commits')).text();
  return (html.match(/\/commit\/[0-9a-f]{40}/g) ?? []).length;
}
