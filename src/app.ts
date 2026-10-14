import express from 'express';
import type { ErrorRequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { config } from './config';
import type { DB } from './db';
import { csrf } from './auth/csrf';
import { optionalAuth } from './auth/middleware';
import { gitHttpRouter } from './git/httpBackend';
import { authRouter } from './routes/auth';
import { repoRouter } from './routes/repos';
import { settingsRouter } from './routes/settings';

export interface AppOptions {
  db: DB;
  secureCookies?: boolean;
  rateLimit?: boolean;
  reposDir?: string;
  maxPushBytes?: number;
}

export function createApp(opts: AppOptions): express.Express {
  const { db } = opts;
  const secureCookies = opts.secureCookies ?? config.secureCookies;
  const reposDir = opts.reposDir ?? config.reposDir;
  const app = express();

  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', config.viewsDir);
  app.locals.enc = encodeURIComponent;
  app.locals.encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

  // Git clients are not browsers: no CSRF, cookies, or body parsing on this path.
  app.use(gitHttpRouter(db, { reposDir, maxPushBytes: opts.maxPushBytes ?? config.maxPushBytes }));

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'img-src': ["'self'", 'data:', 'https:'],
          'upgrade-insecure-requests': null,
        },
      },
    }),
  );
  app.use(express.static(config.publicDir));
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(optionalAuth(db));
  app.use(csrf(secureCookies));

  app.get('/', (req, res) => {
    if (req.user) return res.redirect('/dashboard');
    res.render('home', { title: 'GeekHub' });
  });
  app.use(authRouter(db, { secureCookies, rateLimit: opts.rateLimit ?? true }));
  app.use(settingsRouter(db));
  app.use(repoRouter(db, { reposDir }));

  app.use((_req, res) => {
    res.status(404).render('error', { title: 'Not found', message: 'Page not found.' });
  });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Something went wrong.' });
  };
  app.use(onError);

  return app;
}
