import { serve } from '@hono/node-server';
import { migrateDatabase, openDatabase, seedDatabase } from '@opencivic/db';
import { createApp } from './app';

const databaseUrl = process.env.DATABASE_URL ?? 'pglite:./.data/opencivic';
const uploadDir = process.env.UPLOAD_DIR ?? './.data/uploads';
const port = Number(process.env.PORT ?? 4000);
const webOrigins = (process.env.WEB_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const handle = await openDatabase(databaseUrl);
let migrated = false;
let lastError: unknown;
for (let attempt = 1; attempt <= 20; attempt += 1) {
  try {
    await migrateDatabase(handle.exec);
    migrated = true;
    break;
  } catch (error) {
    lastError = error;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
if (!migrated) throw lastError;

const seedByDefault = databaseUrl.startsWith('pglite');
const shouldSeed = process.env.SEED_ON_BOOT ? process.env.SEED_ON_BOOT === 'true' : seedByDefault;
if (shouldSeed) {
  await seedDatabase(handle.db, { uploadDir });
  console.log('Demo data is loaded. Default account passwords are public.');
}

const app = createApp({
  db: handle.db,
  uploadDir,
  webOrigins,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
});

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`OpenCivic API listening on ${info.port}`);
});
