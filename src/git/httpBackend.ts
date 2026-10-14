import { spawn } from 'node:child_process';
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { DB } from '../db';
import type { User } from '../auth/users';
import { authenticateToken } from '../auth/tokens';
import { canWrite } from '../repos/permissions';
import { getRepo, repoPath } from '../repos/repos';

export interface GitHttpOptions {
  reposDir: string;
  maxPushBytes: number;
}

type Service = 'git-upload-pack' | 'git-receive-pack';

function requestedService(req: Request, sub: string): Service | null {
  if (sub === 'info/refs' && req.method === 'GET') {
    const s = req.query.service;
    return s === 'git-upload-pack' || s === 'git-receive-pack' ? s : null;
  }
  if (req.method === 'POST' && (sub === 'git-upload-pack' || sub === 'git-receive-pack')) return sub;
  return null;
}

function basicAuthUser(db: DB, header: string | undefined): User | undefined {
  const m = /^Basic\s+(.+)$/i.exec(header ?? '');
  if (!m) return undefined;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  return i < 0 ? undefined : authenticateToken(db, decoded.slice(i + 1));
}

function challenge(res: Response): void {
  res.set('WWW-Authenticate', 'Basic realm="GeekHub"').status(401).type('text/plain').send('Authentication required\n');
}

export function gitHttpRouter(db: DB, opts: GitHttpOptions): Router {
  const router = Router();

  // /:owner/:repo.git/<info/refs | git-upload-pack | git-receive-pack>
  router.all(/^\/([^/]+)\/([^/]+?)\.git\/(.+)$/, (req, res) => {
    const { 0: owner, 1: name, 2: sub } = req.params as unknown as Record<number, string>;
    const repo = getRepo(db, owner, name);
    const service = requestedService(req, sub);
    if (!repo || !service) {
      res.status(404).type('text/plain').send('Not found\n');
      return;
    }

    let remoteUser = '';
    if (service === 'git-receive-pack') {
      const user = basicAuthUser(db, req.get('authorization'));
      if (!user) return challenge(res);
      if (!canWrite(db, repo, user)) {
        res.status(403).type('text/plain').send('You do not have push access to this repository\n');
        return;
      }
      remoteUser = user.username;
      const declared = Number(req.get('content-length') ?? 0);
      if (declared > opts.maxPushBytes) {
        res.status(413).type('text/plain').send('Push too large\n');
        return;
      }
    }

    repoPath(opts.reposDir, repo.owner, repo.name); // throws if the path would leave reposDir
    const child = spawn('git', ['http-backend'], {
      windowsHide: true,
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: opts.reposDir,
        GIT_HTTP_EXPORT_ALL: '1',
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'receive.maxInputSize',
        GIT_CONFIG_VALUE_0: String(opts.maxPushBytes),
        REQUEST_METHOD: req.method,
        PATH_INFO: `/${repo.owner}/${repo.name}.git/${sub}`,
        QUERY_STRING: req.originalUrl.split('?')[1] ?? '',
        CONTENT_TYPE: req.get('content-type') ?? '',
        CONTENT_LENGTH: req.get('content-length') ?? '',
        HTTP_CONTENT_ENCODING: req.get('content-encoding') ?? '',
        REMOTE_USER: remoteUser,
        REMOTE_ADDR: req.ip ?? '',
        GATEWAY_INTERFACE: 'CGI/1.1',
        SERVER_PROTOCOL: 'HTTP/1.1',
      },
    });

    let finished = false;
    const fail = (status: number, msg: string) => {
      child.kill();
      if (!res.headersSent) res.status(status).type('text/plain').send(msg);
      else res.destroy();
    };

    let received = 0;
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (service === 'git-receive-pack' && received > opts.maxPushBytes) {
        req.unpipe(child.stdin);
        fail(413, 'Push too large\n');
      }
    });
    req.pipe(child.stdin);
    child.stdin.on('error', () => {});

    // CGI output: header block, blank line, then the body.
    let head = Buffer.alloc(0);
    let headersDone = false;
    child.stdout.on('data', (chunk: Buffer) => {
      if (headersDone) {
        res.write(chunk);
        return;
      }
      head = Buffer.concat([head, chunk]);
      const m = /\r?\n\r?\n/.exec(head.toString('latin1'));
      if (!m) {
        if (head.length > 64 * 1024) fail(502, 'Bad gateway\n');
        return;
      }
      headersDone = true;
      for (const line of head.subarray(0, m.index).toString('latin1').split(/\r?\n/)) {
        const i = line.indexOf(':');
        if (i < 0) continue;
        const key = line.slice(0, i).trim();
        const value = line.slice(i + 1).trim();
        if (key.toLowerCase() === 'status') res.status(parseInt(value, 10) || 200);
        else res.set(key, value);
      }
      const rest = head.subarray(m.index + m[0].length);
      if (rest.length) res.write(rest);
    });
    child.stdout.on('end', () => {
      finished = true;
      if (!headersDone && !res.headersSent) res.status(502).type('text/plain').send('Bad gateway\n');
      else res.end();
    });
    child.on('error', () => fail(500, 'Failed to run git\n'));
    res.on('close', () => {
      if (!finished) child.kill();
    });
  });

  return router;
}
