import path from 'node:path';
import { createApp } from './app';
import { config } from './config';
import { openDb } from './db';
import { purgeExpiredSessions } from './auth/sessions';

const db = openDb(path.join(config.dataDir, 'geekhub.sqlite'));
purgeExpiredSessions(db);
setInterval(() => purgeExpiredSessions(db), 60 * 60 * 1000).unref();

createApp({ db }).listen(config.port, () => {
  console.log(`GeekHub listening on http://localhost:${config.port}`);
});
