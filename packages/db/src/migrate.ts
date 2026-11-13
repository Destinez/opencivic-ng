import { readFileSync, readdirSync } from 'node:fs';

export async function migrateDatabase(exec: (sql: string) => Promise<void>): Promise<void> {
  const directory = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(directory)
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort()) {
    const source = readFileSync(new URL(file, directory), 'utf8');
    const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
    await exec(`
      SELECT pg_advisory_xact_lock(741209);
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
      );
      DO $migration_runner$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = ${literal(file)}) THEN
          EXECUTE ${literal(source)};
          INSERT INTO schema_migrations(name) VALUES (${literal(file)});
        END IF;
      END;
      $migration_runner$;
    `);
  }
}
