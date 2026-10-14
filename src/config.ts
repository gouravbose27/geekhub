import path from 'node:path';

const root = path.resolve(__dirname, '..');
const dataDir = path.resolve(process.env.GEEKHUB_DATA_DIR ?? path.join(root, 'data'));

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dataDir,
  reposDir: path.join(dataDir, 'repos'),
  viewsDir: path.join(root, 'src', 'views'),
  publicDir: path.join(root, 'public'),
  secureCookies: process.env.NODE_ENV === 'production',
  maxPushBytes: Number(process.env.GEEKHUB_MAX_PUSH_BYTES ?? 100 * 1024 * 1024),
};
