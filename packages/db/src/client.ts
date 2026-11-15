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
    const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
    const { drizzle } = await import('drizzle-orm/pglite');
    const spec = databaseUrl === 'pglite' ? '' : databaseUrl.slice('pglite:'.length);
    if (spec && spec !== 'memory') mkdirSync(spec, { recursive: true });
    const client = new PGlite({
      dataDir: spec === '' || spec === 'memory' ? undefined : spec,
      extensions: { pg_trgm },
    });
    await client.exec('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
    const db = drizzle(client, { schema });
    return {
      db: db as unknown as AppDb,
      exec: async (sql: string) => {
        await client.transaction(async (tx) => {
          await tx.exec(sql);
        });
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
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        await connection.query(sql);
        await connection.query('COMMIT');
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally {
        connection.release();
      }
    },
    close: async () => {
      await pool.end();
    },
  };
}
