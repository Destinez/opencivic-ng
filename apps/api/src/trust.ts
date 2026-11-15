import { createHash } from 'node:crypto';
import {
  type AppDb,
  discrepancyFlags,
  elections,
  observerProfiles,
  recomputeSheetMatch,
  states,
  submissionSignals,
  submissions,
  users,
} from '@opencivic/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps, AppEnv } from './app';
import { parse, readJson, reject, requireRole } from './http';
import { recordAudit } from './queries';
import { emptyQuerySchema, identifierSchema, queryValues } from './request-validation';

export async function refreshTrust(db: AppDb, observerId: string, fabrication = false) {
  await db.insert(observerProfiles).values({ userId: observerId }).onConflictDoNothing();
  const [profile] = await db
    .select()
    .from(observerProfiles)
    .where(eq(observerProfiles.userId, observerId))
    .for('update');
  const [counts] = await db
    .select({
      approved: sql<number>`count(*) FILTER (WHERE ${submissions.status} IN ('approved', 'superseded'))::int`,
      rejected: sql<number>`count(*) FILTER (WHERE EXISTS (SELECT 1 FROM submission_reviews r WHERE r.submission_id = submissions.id AND r.decision = 'rejected'))::int`,
    })
    .from(submissions)
    .where(eq(submissions.observerId, observerId));
  const trustLevel = fabrication
    ? 0
    : profile.trustLevel === 0 && !profile.frozen && counts.approved >= 3 && counts.rejected === 0
      ? 1
      : profile.trustLevel;
  await db
    .update(observerProfiles)
    .set({
      approvedCount: counts.approved,
      rejectedCount: counts.rejected,
      trustLevel,
      frozen: fabrication || profile.frozen,
    })
    .where(eq(observerProfiles.userId, observerId));
  if (trustLevel !== profile.trustLevel || fabrication)
    await recordAudit(db, {
      actorId: null,
      action: fabrication ? 'observer.frozen' : 'observer.promoted',
      entityType: 'user',
      entityId: observerId,
      metadata: {
        trustLevel,
        reason: fabrication ? 'fabrication' : 'three_approved_without_rejection',
      },
    });
  if (trustLevel !== profile.trustLevel) {
    const units = await db
      .selectDistinct({ electionId: submissions.electionId, unitId: submissions.pollingUnitId })
      .from(submissions)
      .where(eq(submissions.observerId, observerId));
    for (const unit of units) await recomputeSheetMatch(db, unit.electionId, unit.unitId);
  }
}

export async function recordSubmissionSignal(
  db: AppDb,
  input: {
    submissionId: string;
    observerId: string;
    pollingUnitId: string;
    address: string;
    deviceId?: string;
  },
) {
  const hash = (kind: string, value: string) =>
    createHash('sha256').update(`${kind}:${value}`).digest('hex');
  await db.insert(submissionSignals).values({
    submissionId: input.submissionId,
    observerId: input.observerId,
    pollingUnitId: input.pollingUnitId,
    ipHash: hash('ip', input.address),
    deviceHash: input.deviceId ? hash('device', input.deviceId) : null,
  });
}

export function mountTrustRoutes(app: Hono<AppEnv>, deps: AppDeps) {
  app.get('/v1/admin/observers', async (c) => {
    requireRole(c, ['admin']);
    parse(emptyQuerySchema, queryValues(c.req.queries()));
    const rows = await deps.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        trustLevel: observerProfiles.trustLevel,
        accreditationRef: observerProfiles.accreditationRef,
        approvedCount: observerProfiles.approvedCount,
        rejectedCount: observerProfiles.rejectedCount,
        frozen: observerProfiles.frozen,
        homeStateId: observerProfiles.homeStateId,
      })
      .from(users)
      .leftJoin(observerProfiles, eq(observerProfiles.userId, users.id))
      .where(and(eq(users.role, 'observer'), isNull(users.deletedAt)))
      .orderBy(users.name)
      .limit(200);
    return c.json({ data: rows });
  });
  app.post('/v1/admin/observers/:id/trust', async (c) => {
    const user = requireRole(c, ['admin']);
    const id = parse(identifierSchema, c.req.param('id'));
    const input = parse(
      z
        .object({
          trustLevel: z.number().int().min(0).max(3),
          accreditationRef: z.string().trim().min(3).max(160).nullable().optional(),
          homeStateId: identifierSchema.nullable().optional(),
          frozen: z.boolean(),
          note: z.string().trim().min(8).max(500),
        })
        .strict(),
      await readJson(c),
    );
    if (input.trustLevel >= 2 && !input.accreditationRef)
      reject('validation', 'Accredited observers need an accreditation reference.');
    if (input.frozen && input.trustLevel !== 0)
      reject('validation', 'A frozen observer must remain at level zero.');
    await deps.db.transaction(async (tx) => {
      const [target] = await tx
        .select()
        .from(users)
        .where(and(eq(users.id, id), eq(users.role, 'observer'), isNull(users.deletedAt)))
        .for('update');
      if (!target) reject('not_found', 'That observer does not exist.', 404);
      if (input.homeStateId) {
        const [state] = await tx.select().from(states).where(eq(states.id, input.homeStateId));
        if (!state) reject('validation', 'Choose a state in the loaded dataset.');
      }
      await tx.insert(observerProfiles).values({ userId: id }).onConflictDoNothing();
      await tx
        .update(observerProfiles)
        .set({
          trustLevel: input.trustLevel,
          accreditationRef: input.accreditationRef ?? null,
          homeStateId: input.homeStateId ?? null,
          frozen: input.frozen,
        })
        .where(eq(observerProfiles.userId, id));
      await recordAudit(tx, {
        actorId: user.id,
        action: 'observer.trust_changed',
        entityType: 'user',
        entityId: id,
        metadata: { trustLevel: input.trustLevel, frozen: input.frozen, note: input.note },
      });
      const units = await tx
        .selectDistinct({ electionId: submissions.electionId, unitId: submissions.pollingUnitId })
        .from(submissions)
        .where(eq(submissions.observerId, id));
      for (const unit of units) await recomputeSheetMatch(tx, unit.electionId, unit.unitId);
    });
    return c.json({ id, trustLevel: input.trustLevel, frozen: input.frozen });
  });
  app.get('/v1/admin/abuse', async (c) => {
    requireRole(c, ['admin']);
    parse(emptyQuerySchema, queryValues(c.req.queries()));
    const groups = await deps.db.execute(sql`
      WITH signals AS (SELECT * FROM submission_signals WHERE created_at > now() - interval '30 days'),
      keys AS (SELECT 'shared_address' AS kind, ip_hash AS key, observer_id, polling_unit_id, created_at FROM signals
        UNION ALL SELECT 'shared_device', device_hash, observer_id, polling_unit_id, created_at FROM signals WHERE device_hash IS NOT NULL)
      SELECT kind, key, count(*)::int AS submissions, count(DISTINCT polling_unit_id)::int AS units,
        count(DISTINCT observer_id)::int AS observers, max(created_at) AS "lastSeen"
      FROM keys GROUP BY kind, key HAVING count(*) >= 5 AND count(DISTINCT polling_unit_id) >= 3
      ORDER BY max(created_at) DESC LIMIT 100
    `);
    const duplicates = await deps.db
      .select({
        id: discrepancyFlags.id,
        submissionId: discrepancyFlags.submissionId,
        pollingUnitId: discrepancyFlags.pollingUnitId,
        createdAt: discrepancyFlags.createdAt,
      })
      .from(discrepancyFlags)
      .where(and(eq(discrepancyFlags.rule, 'duplicate_image'), eq(discrepancyFlags.active, true)))
      .orderBy(desc(discrepancyFlags.createdAt))
      .limit(100);
    return c.json({
      signals: groups.rows,
      duplicateImages: duplicates,
      note: 'Signals need human review. Shared connections can be legitimate. No ASN is inferred from untrusted forwarding headers.',
    });
  });
  app.post('/v1/admin/elections/:id/config', async (c) => {
    const user = requireRole(c, ['admin']);
    const id = parse(identifierSchema, c.req.param('id'));
    const input = parse(
      z
        .object({ acceptsSubmissions: z.boolean(), note: z.string().trim().min(8).max(500) })
        .strict(),
      await readJson(c),
    );
    await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .update(elections)
        .set({ acceptsSubmissions: input.acceptsSubmissions })
        .where(eq(elections.id, id))
        .returning();
      if (!row) reject('not_found', 'That election does not exist.', 404);
      await recordAudit(tx, {
        actorId: user.id,
        action: 'election.config_changed',
        entityType: 'election',
        entityId: id,
        metadata: input,
      });
    });
    return c.json({ id, acceptsSubmissions: input.acceptsSubmissions });
  });
}
