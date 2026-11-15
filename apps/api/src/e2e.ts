import { serve } from '@hono/node-server';
import { migrateDatabase, openDatabase, seedDatabase } from '@opencivic/db';
import { createApp } from './app';

const source = process.env.DATABASE_URL ?? 'pglite:./.data/e2e';
const schema = process.env.E2E_SCHEMA;
if (!schema || !/^e2e_[a-f0-9]+$/.test(schema))
  throw new Error('A unique test schema is required.');
let databaseUrl = `${source}-${schema}`;
let cleanup = async () => {};
if (source.startsWith('postgres')) {
  const control = await openDatabase(source);
  await control.exec(`CREATE SCHEMA ${schema}`);
  const url = new URL(source);
  url.searchParams.set('options', `-csearch_path=${schema}`);
  databaseUrl = url.toString();
  cleanup = async () => {
    await control.exec(`DROP SCHEMA ${schema} CASCADE`);
    await control.close();
  };
}
const handle = await openDatabase(databaseUrl);
const uploadDir = `./.data/e2e-uploads-${schema}`;
await migrateDatabase(handle.exec);
await seedDatabase(handle.db, { uploadDir });
// Quotas are covered by API tests; each browser run has an isolated database.
const app = createApp({
  db: handle.db,
  uploadDir,
  webOrigins: ['http://localhost:3000'],
  cookieSecure: false,
  rateLimit: false,
});
const server = serve({
  fetch: app.fetch,
  hostname: '0.0.0.0',
  port: Number(process.env.PORT ?? 4000),
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  server.close();
  await handle.close();
  await cleanup();
  process.exit(0);
}
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
