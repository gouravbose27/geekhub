import express from 'express';
import type { ErrorRequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config';
import type { DB } from './db';
import { csrf } from './auth/csrf';
import { optionalAuth } from './auth/middleware';
import { authRouter } from './routes/auth';
import { settingsRouter } from './routes/settings';

export interface AppOptions {
  db: DB;
  secureCookies?: boolean;
  rateLimit?: boolean;
}

export function createApp(opts: AppOptions): express.Express {
  const { db } = opts;
  const secureCookies = opts.secureCookies ?? config.secureCookies;
  const app = express();

  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', config.viewsDir);

  app.use(express.static(config.publicDir));
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(optionalAuth(db));
  app.use(csrf(secureCookies));

  app.get('/', (_req, res) => {
    res.render('home', { title: 'GeekHub' });
  });
  app.use(authRouter(db, { secureCookies, rateLimit: opts.rateLimit ?? true }));
  app.use(settingsRouter(db));

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
