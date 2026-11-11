import { mkdirSync } from 'node:fs';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export type AppDb = NodePgDatabase<typeof schema>;

export type DatabaseHandle = {
  db: AppDb;
  exec: (sql: string) => Promise<void>;
  close: () => Promise<void>;
};

export async function openDatabase(databaseUrl: string): Promise<DatabaseHandle> {
  if (databaseUrl === 'pglite' || databaseUrl.startsWith('pglite:')) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const spec = databaseUrl === 'pglite' ? '' : databaseUrl.slice('pglite:'.length);
    if (spec && spec !== 'memory') mkdirSync(spec, { recursive: true });
    const client = spec === '' || spec === 'memory' ? new PGlite() : new PGlite(spec);
    const db = drizzle(client, { schema });
    return {
      db: db as unknown as AppDb,
      exec: async (sql: string) => {
        await client.exec(sql);
      },
      close: async () => {
        await client.close();
      },
    };
  }

  const { default: pg } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  return {
    db,
    exec: async (sql: string) => {
      await pool.query(sql);
    },
    close: async () => {
      await pool.end();
    },
  };
}
