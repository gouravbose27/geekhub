import { Router } from 'express';
import type { Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { DB } from '../db';
import { hashPassword, verifyDummy, verifyPassword } from '../auth/password';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSession,
  deleteSession,
  deleteUserSessions,
} from '../auth/sessions';
import {
  createPasswordResetToken,
  deletePasswordResetToken,
  deletePasswordResetTokensForUser,
  getPasswordResetToken,
} from '../auth/passwordReset';
import {
  createUser,
  emailTaken,
  findByLogin,
  isUniqueViolation,
  updatePassword,
  usernameTaken,
} from '../auth/users';
import { safeNext, validateEmail, validatePassword, validateUsername } from '../auth/validation';

export interface AuthRouterOptions {
  secureCookies: boolean;
  rateLimit: boolean;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function authRouter(db: DB, opts: AuthRouterOptions): Router {
  const router = Router();

  const limiter = (limit: number, windowMs: number, skipSuccessfulRequests = false) =>
    opts.rateLimit
      ? rateLimit({
          windowMs,
          limit,
          skipSuccessfulRequests,
          standardHeaders: true,
          legacyHeaders: false,
          handler: (_req, res) => {
            res.status(429).render('error', {
              title: 'Too many requests',
              message: 'Too many attempts. Try again later.',
            });
          },
        })
      : (_req: unknown, _res: unknown, next: () => void) => next();

  const startSession = (res: Response, userId: number) => {
    const token = createSession(db, userId);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: opts.secureCookies,
      maxAge: SESSION_TTL_MS,
      path: '/',
    });
  };

  router.get('/signup', (req, res) => {
    if (req.user) return res.redirect('/');
    res.render('signup', { title: 'Sign up', errors: [], form: {} });
  });

  router.post('/signup', limiter(10, 60 * 60 * 1000), async (req, res) => {
    if (req.user) return res.redirect('/');
    const username = str(req.body.username).trim();
    const email = str(req.body.email).trim();
    const password = str(req.body.password);
    const confirm = str(req.body.confirm);

    const errors = [
      validateUsername(username),
      validateEmail(email),
      validatePassword(password),
      password !== confirm ? 'Passwords do not match.' : null,
    ].filter((e): e is string => e !== null);

    if (!errors.length) {
      if (usernameTaken(db, username)) errors.push('That username is already taken.');
      if (emailTaken(db, email)) errors.push('That email is already registered.');
    }

    const fail = (list: string[]) =>
      res.status(400).render('signup', { title: 'Sign up', errors: list, form: { username, email } });
    if (errors.length) return fail(errors);

    try {
      const user = createUser(db, username, email, await hashPassword(password));
      startSession(res, user.id);
      res.redirect('/');
    } catch (err) {
      if (isUniqueViolation(err)) return fail(['That username or email is already registered.']);
      throw err;
    }
  });

  router.get('/login', (req, res) => {
    const next = safeNext(req.query.next);
    if (req.user) return res.redirect(next);
    res.render('login', { title: 'Sign in', error: null, form: {}, next });
  });

  router.post('/login', limiter(10, 15 * 60 * 1000, true), async (req, res) => {
    const login = str(req.body.login).trim();
    const password = str(req.body.password);
    const next = safeNext(req.body.next);

    const user = login ? findByLogin(db, login) : undefined;
    const ok = user ? await verifyPassword(password, user.password_hash) : (await verifyDummy(password), false);

    if (!user || !ok) {
      return res.status(401).render('login', {
        title: 'Sign in',
        error: 'Invalid username or password.',
        form: { login },
        next,
      });
    }
    startSession(res, user.id);
    res.redirect(next);
  });

  router.get('/forgot-password', (req, res) => {
    if (req.user) return res.redirect('/');
    res.render('forgot_password', { title: 'Forgot password', message: null, resetUrl: null, form: {} });
  });

  router.post('/forgot-password', limiter(5, 60 * 60 * 1000), (req, res) => {
    if (req.user) return res.redirect('/');
    const login = str(req.body.login).trim();
    const user = login ? findByLogin(db, login) : undefined;
    const token = user ? createPasswordResetToken(db, user.id) : null;

    res.render('forgot_password', {
      title: 'Forgot password',
      message: 'If the account exists, a password reset link has been prepared.',
      resetUrl: token ? `/reset-password?token=${encodeURIComponent(token)}` : null,
      form: { login },
    });
  });

  router.get('/reset-password', (req, res) => {
    const token = str(req.query.token);
    const reset = getPasswordResetToken(db, token);
    res.render('reset_password', {
      title: 'Reset password',
      error: reset ? null : 'This password reset link is invalid or has expired.',
      token: reset ? token : '',
    });
  });

  router.post('/reset-password', limiter(10, 15 * 60 * 1000), async (req, res) => {
    const token = str(req.body.token);
    const password = str(req.body.password);
    const confirm = str(req.body.confirm);
    const reset = getPasswordResetToken(db, token);

    if (!reset) {
      return res.status(400).render('reset_password', {
        title: 'Reset password',
        error: 'This password reset link is invalid or has expired.',
        token: '',
      });
    }

    const errors = [
      validatePassword(password),
      password !== confirm ? 'Passwords do not match.' : null,
    ].filter((e): e is string => e !== null);

    if (errors.length) {
      return res.status(400).render('reset_password', {
        title: 'Reset password',
        error: errors.join(' '),
        token,
      });
    }

    const passwordHash = await hashPassword(password);
    db.transaction(() => {
      updatePassword(db, reset.user_id, passwordHash);
      deletePasswordResetTokensForUser(db, reset.user_id);
      deletePasswordResetToken(db, reset.token_hash);
      deleteUserSessions(db, reset.user_id);
    })();
    startSession(res, reset.user_id);
    res.redirect('/dashboard');
  });

  router.post('/logout', (req, res) => {
    if (req.sessionToken) deleteSession(db, req.sessionToken);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.redirect('/');
  });

  return router;
}
