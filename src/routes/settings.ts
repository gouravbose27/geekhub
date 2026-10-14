import { Router } from 'express';
import type { DB } from '../db';
import { requireAuth } from '../auth/middleware';
import { createToken, listTokens, revokeToken } from '../auth/tokens';
import { validateTokenName } from '../auth/validation';

export function settingsRouter(db: DB): Router {
  const router = Router();
  router.use('/settings', requireAuth);

  const renderTokens = (res: import('express').Response, userId: number, extra: object = {}) =>
    res.render('tokens', {
      title: 'Access tokens',
      tokens: listTokens(db, userId),
      newToken: null,
      error: null,
      ...extra,
    });

  router.get('/settings/tokens', (req, res) => {
    renderTokens(res, req.user!.id);
  });

  router.post('/settings/tokens', (req, res) => {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const error = validateTokenName(name);
    if (error) {
      res.status(400);
      return renderTokens(res, req.user!.id, { error });
    }
    // Plaintext is rendered once here and never stored.
    const newToken = createToken(db, req.user!.id, name);
    renderTokens(res, req.user!.id, { newToken });
  });

  router.post('/settings/tokens/:id/revoke', (req, res) => {
    const id = Number(req.params.id);
    if (Number.isInteger(id)) revokeToken(db, req.user!.id, id);
    res.redirect('/settings/tokens');
  });

  return router;
}
