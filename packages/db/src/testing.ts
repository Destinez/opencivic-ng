import { randomUUID } from 'node:crypto';
import { type DatabaseHandle, openDatabase } from './client';

export async function openTestDatabase(): Promise<DatabaseHandle> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return openDatabase('pglite');
  const control = await openDatabase(url);
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  await control.exec(`CREATE SCHEMA ${schema}`);
  const isolated = new URL(url);
  isolated.searchParams.set('options', `-csearch_path=${schema}`);
  const handle = await openDatabase(isolated.toString());
  return {
    ...handle,
    close: async () => {
      await handle.close();
      try {
        await control.exec(`DROP SCHEMA ${schema} CASCADE`);
      } finally {
        await control.close();
      }
    },
  };
}
