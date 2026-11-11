import { readFileSync } from 'node:fs';

export async function migrateDatabase(exec: (sql: string) => Promise<void>): Promise<void> {
  const sql = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8');
  await exec(sql);
}
