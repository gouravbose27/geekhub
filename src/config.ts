import path from 'node:path';

const root = path.resolve(__dirname, '..');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dataDir: path.resolve(process.env.GEEKHUB_DATA_DIR ?? path.join(root, 'data')),
  viewsDir: path.join(root, 'src', 'views'),
  publicDir: path.join(root, 'public'),
  secureCookies: process.env.NODE_ENV === 'production',
};
