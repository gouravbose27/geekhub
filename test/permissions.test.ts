import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { basic, startEnv } from './helpers';
import type { TestEnv } from './helpers';
import { createRepo, repoPath, validateRepoName } from '../src/repos/repos';

let env: TestEnv;
let owner: ReturnType<TestEnv['addUser']>;
let carl: ReturnType<TestEnv['addUser']>;
let otto: ReturnType<TestEnv['addUser']>;

before(async () => {
  env = await startEnv();
  owner = env.addUser('olive');
  carl = env.addUser('carl');
  otto = env.addUser('otto');
  await createRepo(env.db, env.reposDir, owner, 'proj', 'demo');
});

after(() => env.close());

const refs = (service: string, token?: string) =>
  fetch(`${env.base}/olive/proj.git/info/refs?service=${service}`, {
    headers: token ? { authorization: basic(token) } : {},
  });

describe('permission matrix', () => {
  it('read: everyone can browse and fetch, including anonymous', async () => {
    for (const c of [env.client(), await login('otto')]) {
      assert.equal((await c.req('/olive/proj')).status, 200);
      assert.equal((await c.req('/olive/proj/commits')).status, 200);
    }
    assert.equal((await refs('git-upload-pack')).status, 200);
    assert.equal((await refs('git-upload-pack', otto.token)).status, 200);
  });

  it('push: 401 without valid credentials, 403 for non-collaborators', async () => {
    const anon = await refs('git-receive-pack');
    assert.equal(anon.status, 401);
    assert.match(anon.headers.get('www-authenticate')!, /^Basic/);
    assert.equal((await refs('git-receive-pack', 'ghp_bogus')).status, 401);
    assert.equal((await refs('git-receive-pack', otto.token)).status, 403);
    assert.equal((await refs('git-receive-pack', carl.token)).status, 403);
    assert.equal((await refs('git-receive-pack', owner.token)).status, 200);
  });

  it('share: only the owner can manage collaborators', async () => {
    const path = '/olive/proj/settings/collaborators';
    assert.equal((await env.client().post(path, { username: 'carl' })).status, 401);
    assert.equal((await (await login('otto')).post(path, { username: 'carl' })).status, 403);
    assert.equal((await (await login('otto')).req('/olive/proj/settings')).status, 403);
    assert.equal((await env.client().req('/olive/proj/settings')).status, 302);

    const o = await login('olive');
    assert.equal((await o.post(path, { username: 'nobody' })).status, 400);
    assert.equal((await o.post(path, { username: 'olive' })).status, 400);
    assert.equal((await o.post(path, { username: 'carl' })).status, 302);
    assert.match(await (await o.req('/olive/proj/settings')).text(), /carl/);
  });

  it('push: collaborators can push once added, but still cannot share or delete', async () => {
    assert.equal((await refs('git-receive-pack', carl.token)).status, 200);
    assert.equal((await refs('git-receive-pack', otto.token)).status, 403);

    const c = await login('carl');
    assert.equal((await c.post('/olive/proj/settings/collaborators', { username: 'otto' })).status, 403);
    assert.equal((await c.post('/olive/proj/settings/delete', { confirm: 'proj' })).status, 403);
    assert.match(await (await c.req('/dashboard')).text(), /olive\/proj/);
  });

  it('removing a collaborator revokes push access', async () => {
    const o = await login('olive');
    await o.post(`/olive/proj/settings/collaborators/${carl.id}/remove`, {});
    assert.equal((await refs('git-receive-pack', carl.token)).status, 403);
  });

  it('delete: owner only, with name confirmation', async () => {
    const path = '/olive/proj/settings/delete';
    assert.equal((await env.client().post(path, { confirm: 'proj' })).status, 401);
    assert.equal((await (await login('otto')).post(path, { confirm: 'proj' })).status, 403);
    assert.ok(fs.existsSync(repoPath(env.reposDir, 'olive', 'proj')));

    const o = await login('olive');
    assert.equal((await o.post(path, { confirm: 'wrong' })).status, 400);
    assert.equal((await o.post(path, { confirm: 'proj' })).status, 302);
    assert.equal(fs.existsSync(repoPath(env.reposDir, 'olive', 'proj')), false);
    assert.equal((await env.client().req('/olive/proj')).status, 404);
    assert.equal((await refs('git-upload-pack')).status, 404);
  });
});

describe('repository names', () => {
  it('rejects traversal and reserved shapes', () => {
    for (const bad of ['../x', '..', '.', 'a/b', 'a\\b', 'x.git', 'X.GIT', 'trailing.', 'con', 'NUL.txt', '', 'a b', 'a'.repeat(101)]) {
      assert.notEqual(validateRepoName(bad), null, JSON.stringify(bad));
    }
    for (const ok of ['proj', 'my-repo_1.2', '.github', 'a'.repeat(100)]) {
      assert.equal(validateRepoName(ok), null, ok);
    }
  });

  it('refuses paths outside the repositories directory', () => {
    assert.throws(() => repoPath(env.reposDir, '..', 'x'));
    assert.throws(() => repoPath(env.reposDir, 'olive', '../../x'));
  });

  it('rejects invalid names through the form and creates valid repos on disk', async () => {
    const o = await login('olive');
    assert.equal((await o.post('/new', { name: '../x', description: '' })).status, 400);
    assert.equal((await o.post('/new', { name: 'x.git', description: '' })).status, 400);
    const created = await o.post('/new', { name: 'fresh', description: 'hi' });
    assert.equal(created.status, 302);
    assert.ok(fs.existsSync(repoPath(env.reposDir, 'olive', 'fresh')));
    assert.equal((await o.post('/new', { name: 'FRESH', description: '' })).status, 400);
    assert.match(await (await env.client().req('/explore?q=fre')).text(), /olive\/fresh/);
  });
});

async function login(username: string) {
  const c = env.client();
  await c.login(username);
  return c;
}
