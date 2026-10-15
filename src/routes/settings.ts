import { Router } from 'express';
import type { DB } from '../db';
import { requireAuth } from '../auth/middleware';
import { createToken, listTokens, revokeToken } from '../auth/tokens';
import { validateTokenName, validateTokenExpiry } from '../auth/validation';

export function settingsRouter(db: DB): Router {
  const router = Router();
  router.use('/settings', requireAuth);

  const renderTokens = (res: import('express').Response, userId: number, extra: object = {}) =>
    res.render('tokens', {
      title: 'Access tokens',
      tokens: listTokens(db, userId).map((token) => ({
        ...token,
        expiresOn: token.expires_at === null ? null : new Date(token.expires_at).toISOString().slice(0, 10),
        expired: token.expires_at !== null && token.expires_at <= Date.now(),
      })),
      minExpiryDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      expiration: '',
      newToken: null,
      error: null,
      ...extra,
    });

  router.get('/settings/tokens', (req, res) => {
    renderTokens(res, req.user!.id);
  });

  router.post('/settings/tokens', (req, res) => {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const expiration = typeof req.body.expires_at === 'string' ? req.body.expires_at : '';
    const error = validateTokenName(name) ||
      (req.body.expires_at !== undefined && typeof req.body.expires_at !== 'string'
        ? 'Enter a valid expiration date.' : validateTokenExpiry(expiration));
    if (error) {
      res.status(400);
      return renderTokens(res, req.user!.id, { error, expiration });
    }
    // Plaintext is rendered once here and never stored.
    const expiresAt = expiration ? Date.parse(`${expiration}T00:00:00.000Z`) : null;
    const newToken = createToken(db, req.user!.id, name, expiresAt);
    renderTokens(res, req.user!.id, { newToken });
  });

  router.post('/settings/tokens/:id/revoke', (req, res) => {
    const id = Number(req.params.id);
    if (Number.isInteger(id)) revokeToken(db, req.user!.id, id);
    res.redirect('/settings/tokens');
  });

  return router;
}
