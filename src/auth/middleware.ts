import type { RequestHandler } from 'express';
import type { DB } from '../db';
import { SESSION_COOKIE, getSessionUser } from './sessions';
import type { User } from './users';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      sessionToken?: string;
    }
  }
}

export function optionalAuth(db: DB): RequestHandler {
  return (req, res, next) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string') {
      const user = getSessionUser(db, token);
      if (user) {
        req.user = user;
        req.sessionToken = token;
      } else {
        res.clearCookie(SESSION_COOKIE, { path: '/' });
      }
    }
    res.locals.user = req.user ?? null;
    next();
  };
}

export const requireAuth: RequestHandler = (req, res, next) => {
  if (req.user) {
    next();
    return;
  }
  if (req.method === 'GET') {
    res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  } else {
    res.status(401).render('error', { title: 'Sign in required', message: 'You must sign in to do that.' });
  }
};
