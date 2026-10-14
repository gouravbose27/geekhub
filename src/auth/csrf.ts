import crypto from 'node:crypto';
import type { RequestHandler } from 'express';

export const CSRF_COOKIE = 'gh_csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function equal(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Double-submit cookie: the form must echo the HttpOnly cookie value in `_csrf`.
export function csrf(secure: boolean): RequestHandler {
  return (req, res, next) => {
    let token = req.cookies?.[CSRF_COOKIE];
    if (typeof token !== 'string' || token.length < 32) {
      token = crypto.randomBytes(32).toString('base64url');
      res.cookie(CSRF_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, path: '/' });
    }
    res.locals.csrfToken = token;

    if (!SAFE_METHODS.has(req.method)) {
      const submitted = req.body?._csrf;
      if (typeof submitted !== 'string' || !equal(submitted, token)) {
        res.status(403).render('error', { title: 'Forbidden', message: 'Invalid or missing CSRF token.' });
        return;
      }
    }
    next();
  };
}
