import { createHash } from 'node:crypto';
import { and, asc, gt, lte, sql } from 'drizzle-orm';
import type { AppDb } from './client';
import { auditEvents } from './schema';

export async function verifyAuditChain(db: AppDb) {
  const [end] = await db
    .select({ id: sql<number>`coalesce(max(${auditEvents.id}), 0)::bigint` })
    .from(auditEvents);
  const maxId = Number(end?.id ?? 0);
  let after = 0;
  let events = 0;
  let previous = '0'.repeat(64);
  while (after < maxId) {
    const batch = await db
      .select({
        id: auditEvents.id,
        prevHash: auditEvents.prevHash,
        hash: auditEvents.hash,
        payload: sql<string>`audit_event_payload(${auditEvents})`,
      })
      .from(auditEvents)
      .where(and(gt(auditEvents.id, after), lte(auditEvents.id, maxId)))
      .orderBy(asc(auditEvents.id))
      .limit(1000);
    if (!batch.length) throw new Error('Audit chain ended unexpectedly.');
    for (const event of batch) {
      const expected = createHash('sha256').update(`${previous}\n${event.payload}`).digest('hex');
      if (event.prevHash !== previous || event.hash !== expected)
        throw new Error(`Audit chain mismatch at event ${event.id}.`);
      previous = event.hash;
      after = event.id;
      events += 1;
    }
  }
  return { verified: true, events, lastId: after, lastHash: previous };
}
