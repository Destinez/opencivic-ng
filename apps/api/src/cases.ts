import { randomUUID } from 'node:crypto';
import {
  type AppDb,
  auditEvents,
  caseComments,
  caseItems,
  discrepancyCases,
  discrepancyFlags,
} from '@opencivic/db';
import { hasContactDetails } from '@opencivic/shared/privacy';
import { and, asc, eq, notInArray, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps, AppEnv, SessionUser } from './app';
import { gatherEvidence, pseudonym } from './case-evidence';
import { parse, readJson, reject, requireRole } from './http';
import { getPollingUnit, recordAudit } from './queries';
import { identifierSchema } from './request-validation';

const newCaseSchema = z
  .object({
    flagIds: z
      .array(identifierSchema)
      .min(1)
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length, 'Choose each flag once.'),
    summary: z
      .string()
      .trim()
      .min(10)
      .max(1000)
      .refine((text) => !hasContactDetails(text), 'Remove phone numbers and email addresses.'),
  })
  .strict();
const transitionSchema = z
  .object({
    to: z.enum(['under_investigation', 'confirmed', 'explained', 'dismissed', 'retracted']),
    note: z
      .string()
      .trim()
      .min(8)
      .max(1000)
      .refine((text) => !hasContactDetails(text), 'Remove phone numbers and email addresses.'),
  })
  .strict();
const commentSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .refine((text) => !hasContactDetails(text), 'Remove phone numbers and email addresses.'),
  })
  .strict();

export function canReadCase(row: typeof discrepancyCases.$inferSelect, user: SessionUser | null) {
  return Boolean(
    row.publishedAt ||
      user?.role === 'reviewer' ||
      user?.role === 'admin' ||
      (user?.role === 'desk' && row.status !== 'open'),
  );
}

export async function findReadableCase(db: AppDb, id: string, user: SessionUser | null) {
  const [row] = await db.select().from(discrepancyCases).where(eq(discrepancyCases.id, id));
  if (!row || !canReadCase(row, user)) reject('not_found', 'That case is not available.', 404);
  return row;
}

export async function caseHistory(db: AppDb, id: string) {
  const rows = await db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.entityType, 'case'), eq(auditEvents.entityId, id)))
    .orderBy(asc(auditEvents.id));
  return rows.map((event) => ({
    id: event.id,
    at: event.occurredAt,
    actor: event.actorId ? pseudonym(event.actorId, 'reviewer') : 'system',
    action: event.action,
    note: typeof event.metadata.note === 'string' ? event.metadata.note : null,
    status: event.metadata.status ?? null,
    hash: event.hash,
    prevHash: event.prevHash,
  }));
}

export async function caseDocument(db: AppDb, row: typeof discrepancyCases.$inferSelect) {
  const items = await db
    .select()
    .from(caseItems)
    .where(eq(caseItems.caseId, row.id))
    .orderBy(asc(caseItems.flagId));
  const location = await getPollingUnit(db, row.pollingUnitId);
  return {
    id: row.id,
    electionId: row.electionId,
    pollingUnit: location?.data,
    status: row.status,
    severity: row.severity,
    summary: row.summary,
    openedBy: pseudonym(row.openedBy, 'reviewer'),
    confirmedBy: row.confirmedBy ? pseudonym(row.confirmedBy, 'reviewer') : null,
    createdAt: row.createdAt,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
    retractionPending: Boolean(row.retractionRequestedBy && row.status === 'published'),
    retractionNote: row.retractionNote,
    evidence: items.map((item) => item.snapshot),
    history: await caseHistory(db, row.id),
  };
}

export function mountCaseRoutes(app: Hono<AppEnv>, deps: AppDeps) {
  app.post('/v1/cases', async (c) => {
    const user = requireRole(c, ['reviewer', 'admin']);
    const input = parse(newCaseSchema, await readJson(c));
    const id = await deps.db.transaction(async (tx) => {
      const [flag] = await tx
        .select()
        .from(discrepancyFlags)
        .where(eq(discrepancyFlags.id, input.flagIds[0]));
      if (!flag) reject('not_found', 'That discrepancy flag does not exist.', 404);
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`case:${flag.electionId}:${flag.pollingUnitId}`}))`,
      );
      const [existing] = await tx
        .select()
        .from(discrepancyCases)
        .where(
          and(
            eq(discrepancyCases.electionId, flag.electionId),
            eq(discrepancyCases.pollingUnitId, flag.pollingUnitId),
            notInArray(discrepancyCases.status, ['dismissed', 'explained']),
          ),
        );
      if (existing)
        reject('conflict', 'This unit already has an active case.', 409, { caseId: existing.id });
      const evidence = await gatherEvidence(tx, input.flagIds);
      const id = randomUUID();
      const severity = evidence.some((item) => item.snapshot.flag.severity === 'critical')
        ? 'critical'
        : 'warn';
      await tx.insert(discrepancyCases).values({
        id,
        electionId: flag.electionId,
        pollingUnitId: flag.pollingUnitId,
        status: 'open',
        severity,
        summary: input.summary,
        openedBy: user.id,
      });
      await tx
        .insert(caseItems)
        .values(
          evidence.map((item) => ({ caseId: id, flagId: item.flagId, snapshot: item.snapshot })),
        );
      await recordAudit(tx, {
        actorId: user.id,
        action: 'case.opened',
        entityType: 'case',
        entityId: id,
        metadata: { status: 'open', note: input.summary, flagIds: input.flagIds },
      });
      return id;
    });
    return c.json({ id, status: 'open' }, 201);
  });

  app.post('/v1/cases/:id/transition', async (c) => {
    const user = requireRole(c, ['reviewer', 'admin']);
    const id = parse(identifierSchema, c.req.param('id'));
    const input = parse(transitionSchema, await readJson(c));
    const result = await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(discrepancyCases)
        .where(eq(discrepancyCases.id, id))
        .for('update');
      if (!row) reject('not_found', 'That case does not exist.', 404);
      const audit = (action: string, status: string) =>
        recordAudit(tx, {
          actorId: user.id,
          action,
          entityType: 'case',
          entityId: id,
          metadata: { note: input.note, status },
        });
      if (input.to === 'retracted') {
        if (user.role !== 'admin')
          reject('forbidden', 'Two different admins must approve a retraction.', 403);
        if (row.status !== 'published')
          reject('conflict', 'Only a published case can be retracted.', 409);
        if (row.retractionRequestedBy === user.id)
          reject('two_person_rule', 'A different admin must confirm this retraction.', 403);
        if (!row.retractionRequestedBy) {
          await tx
            .update(discrepancyCases)
            .set({
              retractionRequestedBy: user.id,
              retractionNote: input.note,
              updatedAt: new Date(),
            })
            .where(eq(discrepancyCases.id, id));
          await audit('case.retraction_requested', 'published');
          return { id, status: 'published', retractionPending: true };
        }
        await tx
          .update(discrepancyCases)
          .set({
            status: 'retracted',
            retractedBy: user.id,
            retractionNote: `${row.retractionNote}\nConfirmation: ${input.note}`,
            updatedAt: new Date(),
          })
          .where(eq(discrepancyCases.id, id));
        await audit('case.retracted', 'retracted');
        return { id, status: 'retracted', retractionPending: false };
      }
      const allowed: Record<string, string[]> = {
        open: ['under_investigation'],
        under_investigation: ['confirmed', 'explained', 'dismissed'],
      };
      if (!allowed[row.status]?.includes(input.to))
        reject('conflict', 'That transition is not allowed from the current case status.', 409);
      if (input.to === 'confirmed') {
        if (row.openedBy === user.id)
          reject('two_person_rule', 'A different reviewer must confirm this case.', 403);
        const items = await tx.select().from(caseItems).where(eq(caseItems.caseId, id));
        const evidence = await gatherEvidence(
          tx,
          items.map((item) => item.flagId),
          true,
        );
        for (const item of evidence)
          await tx
            .update(caseItems)
            .set({ snapshot: item.snapshot })
            .where(and(eq(caseItems.caseId, id), eq(caseItems.flagId, item.flagId)));
        await tx
          .update(discrepancyCases)
          .set({ status: 'confirmed', confirmedBy: user.id, updatedAt: new Date() })
          .where(eq(discrepancyCases.id, id));
        await audit('case.confirmed', 'confirmed');
        await tx
          .update(discrepancyCases)
          .set({ status: 'published', publishedAt: new Date(), updatedAt: new Date() })
          .where(eq(discrepancyCases.id, id));
        await audit('case.published', 'published');
        return { id, status: 'published' };
      }
      await tx
        .update(discrepancyCases)
        .set({ status: input.to, updatedAt: new Date() })
        .where(eq(discrepancyCases.id, id));
      await audit(`case.${input.to}`, input.to);
      return { id, status: input.to };
    });
    return c.json(result);
  });

  app.get('/v1/cases/:id', async (c) => {
    const user = c.get('user');
    const id = parse(identifierSchema, c.req.param('id'));
    const row = await findReadableCase(deps.db, id, user);
    const staff = user && ['reviewer', 'desk', 'admin'].includes(user.role);
    const comments = staff
      ? await deps.db
          .select()
          .from(caseComments)
          .where(eq(caseComments.caseId, id))
          .orderBy(asc(caseComments.createdAt))
          .limit(200)
      : [];
    const reviewer = user && ['reviewer', 'admin'].includes(user.role);
    return c.json({
      ...(await caseDocument(deps.db, row)),
      permissions: {
        investigate: Boolean(reviewer && row.status === 'open'),
        resolve: Boolean(reviewer && row.status === 'under_investigation'),
        confirm: Boolean(
          reviewer && row.status === 'under_investigation' && row.openedBy !== user.id,
        ),
        retract: Boolean(
          user?.role === 'admin' &&
            row.status === 'published' &&
            row.retractionRequestedBy !== user.id,
        ),
        comment: Boolean(staff),
      },
      comments: comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        at: comment.createdAt,
        author: pseudonym(comment.authorId, 'staff'),
      })),
    });
  });

  app.get('/v1/cases/:id/history', async (c) => {
    const id = parse(identifierSchema, c.req.param('id'));
    await findReadableCase(deps.db, id, c.get('user'));
    return c.json({ data: await caseHistory(deps.db, id) });
  });

  app.post('/v1/cases/:id/comments', async (c) => {
    const user = requireRole(c, ['reviewer', 'desk', 'admin']);
    const id = parse(identifierSchema, c.req.param('id'));
    const input = parse(commentSchema, await readJson(c));
    await deps.db.transaction(async (tx) => {
      await findReadableCase(tx, id, user);
      await tx
        .insert(caseComments)
        .values({ id: randomUUID(), caseId: id, authorId: user.id, body: input.body });
      await recordAudit(tx, {
        actorId: user.id,
        action: 'case.commented',
        entityType: 'case',
        entityId: id,
      });
    });
    return c.json({ ok: true }, 201);
  });
}
