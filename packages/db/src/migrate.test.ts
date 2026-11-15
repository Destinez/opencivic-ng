import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from './migrate';
import { seedDatabase } from './seed';
import { openTestDatabase } from './testing';

const handle = await openTestDatabase();
const uploadDir = await mkdtemp(join(tmpdir(), 'opencivic-schema-'));
await handle.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
await handle.exec(
  "INSERT INTO audit_events(action, entity_type, entity_id) VALUES ('legacy', 'test', 'legacy')",
);
await migrateDatabase(handle.exec);
await seedDatabase(handle.db, { uploadDir });

afterAll(async () => {
  await handle.close();
  await rm(uploadDir, { recursive: true, force: true });
});

describe('Sheet Match schema', () => {
  it('upgrades existing data and runs repeatedly without losing the audit chain', async () => {
    await migrateDatabase(handle.exec);
    const migrations = await handle.db.execute(
      sql`SELECT name FROM schema_migrations ORDER BY name`,
    );
    expect(migrations.rows).toEqual([
      { name: '0001_init.sql' },
      { name: '0002_sheet_match.sql' },
      { name: '0003_case_evidence.sql' },
      { name: '0004_query_indexes.sql' },
    ]);
    const events = await handle.db.execute(
      sql`SELECT hash, prev_hash FROM audit_events ORDER BY id`,
    );
    expect(events.rows[0]?.prev_hash).toBe('0'.repeat(64));
    for (let index = 0; index < events.rows.length; index += 1) {
      expect(events.rows[index]?.hash).toMatch(/^[a-f0-9]{64}$/);
      if (index) expect(events.rows[index]?.prev_hash).toBe(events.rows[index - 1]?.hash);
    }
  });

  it('creates the full set of tables and trigram indexes', async () => {
    const tables = await handle.db.execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        'submission_reviews',
        'reference_records',
        'discrepancy_flags',
        'discrepancy_cases',
        'case_items',
        'observer_profiles',
        'evidence_packs',
        'rate_limits',
      ]),
    );
    const indexes = await handle.db.execute(
      sql`SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND indexname LIKE '%trgm_idx'`,
    );
    expect(indexes.rows).toHaveLength(2);
  });

  it('seeds a fictional reference with a hash and generated submission totals', async () => {
    const references = await handle.db.execute(
      sql`SELECT source, dataset, source_url, image_sha256 FROM reference_records`,
    );
    expect(references.rows[0]).toMatchObject({ source: 'sample', dataset: 'sample' });
    expect(references.rows[0]?.source_url).toContain('example.com/sample-reference');
    expect(references.rows[0]?.image_sha256).toMatch(/^[a-f0-9]{64}$/);
    const totals = await handle.db.execute(sql`SELECT total_votes FROM submissions LIMIT 1`);
    expect(totals.rows[0]?.total_votes).toBeGreaterThanOrEqual(0);
  });

  it('enforces independent reviews and reference verification in the database', async () => {
    await expect(
      handle.exec(`INSERT INTO submission_reviews(submission_id, reviewer_id, decision)
      SELECT id, observer_id, 'approved' FROM submissions LIMIT 1`),
    ).rejects.toThrow(/reviewer cannot be observer/);
    await expect(
      handle.exec('UPDATE reference_records SET verified_by = transcribed_by'),
    ).rejects.toThrow(/check constraint/);
    await expect(handle.exec('UPDATE observer_profiles SET trust_level = 4')).rejects.toThrow(
      /check constraint/,
    );
    await expect(
      handle.exec(`INSERT INTO discrepancy_cases(id, election_id, polling_unit_id, status, severity, opened_by, confirmed_by, summary)
      VALUES ('case-invalid', 'election-sample-poll', 'sample-ward-lagos-ikeja-gra-pu-3', 'open', 'warn', 'user-chidi', 'user-chidi', 'Sample case')`),
    ).rejects.toThrow(/check constraint/);
  });

  it('keeps audit rows append-only for updates, deletes, and truncate', async () => {
    for (const statement of [
      "UPDATE audit_events SET action = 'tamper'",
      'DELETE FROM audit_events',
      'TRUNCATE audit_events',
    ]) {
      await expect(handle.exec(statement)).rejects.toThrow(/append-only/);
    }
  });
});
