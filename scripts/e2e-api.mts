import { openDatabase } from '../packages/db/src/client';

const source = process.env.DATABASE_URL ?? 'pglite:./.data/e2e';
const schema = process.env.E2E_SCHEMA;
if (!schema || !/^e2e_[a-f0-9]+$/.test(schema))
  throw new Error('A unique test schema is required.');
let cleanup = async () => {};
if (source.startsWith('postgres')) {
  const control = await openDatabase(source);
  await control.exec(`CREATE SCHEMA ${schema}`);
  const url = new URL(source);
  url.searchParams.set('options', `-csearch_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  cleanup = async () => {
    await control.exec(`DROP SCHEMA ${schema} CASCADE`);
    await control.close();
  };
} else process.env.DATABASE_URL = `${source}-${schema}`;
process.once('SIGTERM', () => {
  void cleanup().finally(() => process.exit(0));
});
await import('../apps/api/src/index');
