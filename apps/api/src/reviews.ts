import {
  type AppDb,
  discrepancyFlags,
  observerProfiles,
  recomputeSheetMatch,
  referenceRecords,
  submissionReviews,
  submissions,
} from '@opencivic/db';
import { decisionSchema } from '@opencivic/shared';
import { and, desc, eq, lt, ne, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import type { AppDeps, AppEnv } from './app';
import { parse, readJson, reject, requireRole } from './http';
import { listSubmissions, recordAudit } from './queries';
import { presentReference } from './references';
import { identifierSchema, queryValues, reviewQuerySchema } from './request-validation';
import { refreshTrust } from './trust';

export async function expireClaims(db: AppDb, id?: string) {
  const expired = await db
    .select()
    .from(submissions)
    .where(
      and(
        eq(submissions.status, 'in_review'),
        lt(submissions.claimedUntil, new Date()),
        id ? eq(submissions.id, id) : undefined,
      ),
    )
    .limit(100)
    .for('update');
  for (const row of expired) {
    const [last] = await db
      .select()
      .from(submissionReviews)
      .where(eq(submissionReviews.submissionId, row.id))
      .orderBy(desc(submissionReviews.id))
      .limit(1);
    const status = last && last.decision !== 'approved' ? last.decision : 'pending';
    await db
      .update(submissions)
      .set({ status, claimedBy: null, claimedUntil: null })
      .where(eq(submissions.id, row.id));
    await recordAudit(db, {
      actorId: null,
      action: 'submission.claim_expired',
      entityType: 'submission',
      entityId: row.id,
      metadata: { status },
    });
  }
}

export function mountReviewRoutes(app: Hono<AppEnv>, deps: AppDeps) {
  app.get('/v1/review/submissions', async (c) => {
    requireRole(c, ['reviewer', 'admin']);
    const filters = parse(reviewQuerySchema, queryValues(c.req.queries()));
    await deps.db.transaction((tx) => expireClaims(tx));
    return c.json({ data: await listSubmissions(deps.db, filters) });
  });

  app.get('/v1/review/submissions/:id', async (c) => {
    requireRole(c, ['reviewer', 'admin']);
    const id = parse(identifierSchema, c.req.param('id'));
    await deps.db.transaction((tx) => expireClaims(tx, id));
    const [submission] = await listSubmissions(deps.db, { id });
    if (!submission) reject('not_found', 'That observation does not exist.', 404);
    const [profile] = submission.observer
      ? await deps.db
          .select()
          .from(observerProfiles)
          .where(eq(observerProfiles.userId, submission.observer.id))
      : [];
    const reviews = await deps.db
      .select()
      .from(submissionReviews)
      .where(eq(submissionReviews.submissionId, id))
      .orderBy(submissionReviews.id);
    const references = await deps.db
      .select()
      .from(referenceRecords)
      .where(
        and(
          eq(referenceRecords.electionId, submission.electionId),
          eq(referenceRecords.pollingUnitId, submission.pollingUnit.id),
        ),
      )
      .orderBy(desc(referenceRecords.createdAt), desc(referenceRecords.id));
    const flags = await deps.db
      .select()
      .from(discrepancyFlags)
      .where(and(eq(discrepancyFlags.submissionId, id), eq(discrepancyFlags.active, true)));
    return c.json({
      submission,
      trustLevel: profile?.trustLevel ?? 0,
      reviews,
      references: references.map(presentReference),
      flags,
    });
  });

  app.post('/v1/review/submissions/:id/claim', async (c) => {
    const user = requireRole(c, ['reviewer', 'admin']);
    const id = parse(identifierSchema, c.req.param('id'));
    const result = await deps.db.transaction(async (tx) => {
      await expireClaims(tx, id);
      const [row] = await tx.select().from(submissions).where(eq(submissions.id, id)).for('update');
      if (!row) reject('not_found', 'That observation does not exist.', 404);
      if (row.observerId === user.id)
        reject('forbidden', 'You cannot claim your own observation.', 403);
      const reviews = await tx
        .select()
        .from(submissionReviews)
        .where(eq(submissionReviews.submissionId, id));
      if (reviews.some((review) => review.reviewerId === user.id))
        reject('two_person_rule', 'A different reviewer must make the next decision.', 403);
      if (
        !['pending', 'in_review', 'flagged', 'rejected'].includes(row.status) ||
        (row.status === 'rejected' &&
          reviews.filter((review) => review.decision === 'rejected').length >= 2)
      )
        reject('conflict', 'This observation is no longer in the review queue.', 409);
      if (row.claimedBy && row.claimedBy !== user.id)
        reject('claimed_by_other', 'Another reviewer holds this claim.', 409);
      if (row.claimedBy === user.id)
        return { id, status: row.status, claimedUntil: row.claimedUntil };
      const claimedUntil = new Date(Date.now() + 10 * 60_000);
      await tx
        .update(submissions)
        .set({ status: 'in_review', claimedBy: user.id, claimedUntil })
        .where(eq(submissions.id, id));
      await recordAudit(tx, {
        actorId: user.id,
        action: 'submission.claimed',
        entityType: 'submission',
        entityId: id,
        metadata: { claimedUntil: claimedUntil.toISOString() },
      });
      return { id, status: 'in_review', claimedUntil };
    });
    return c.json(result);
  });

  app.post('/v1/review/submissions/:id', async (c) => {
    const user = requireRole(c, ['reviewer', 'admin']);
    const id = parse(identifierSchema, c.req.param('id'));
    const input = parse(decisionSchema, await readJson(c));
    const result = await deps.db.transaction(async (tx) => {
      const [row] = await tx.select().from(submissions).where(eq(submissions.id, id)).for('update');
      if (!row) reject('not_found', 'That observation does not exist.', 404);
      if (row.observerId === user.id)
        reject('forbidden', 'You cannot review your own observation.', 403);
      if (
        row.claimedBy !== user.id ||
        row.status !== 'in_review' ||
        !row.claimedUntil ||
        row.claimedUntil.getTime() <= Date.now()
      )
        reject(
          'conflict',
          'Claim this observation before recording a decision. Claims last ten minutes.',
          409,
        );
      const reviews = await tx
        .select()
        .from(submissionReviews)
        .where(eq(submissionReviews.submissionId, id));
      if (reviews.some((review) => review.reviewerId === user.id))
        reject('two_person_rule', 'A different reviewer must make the next decision.', 403);
      const [profile] = row.observerId
        ? await tx
            .select()
            .from(observerProfiles)
            .where(eq(observerProfiles.userId, row.observerId))
        : [];
      const needed = (profile?.trustLevel ?? 0) === 0 ? 2 : 1;
      const approvals =
        reviews.filter((review) => review.decision === 'approved').length +
        (input.decision === 'approved' ? 1 : 0);
      let status: string =
        input.decision === 'approved' && approvals < needed ? 'pending' : input.decision;
      await tx
        .insert(submissionReviews)
        .values({ submissionId: id, reviewerId: user.id, ...input });
      if (status === 'approved' && row.observerId) {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`approval:${row.observerId}:${row.electionId}:${row.pollingUnitId}`}))`,
        );
        const others = await tx
          .select()
          .from(submissions)
          .where(
            and(
              eq(submissions.observerId, row.observerId),
              eq(submissions.electionId, row.electionId),
              eq(submissions.pollingUnitId, row.pollingUnitId),
              eq(submissions.status, 'approved'),
              ne(submissions.id, id),
            ),
          );
        if (
          others.some(
            (other) =>
              other.receivedAt.getTime() > row.receivedAt.getTime() ||
              (other.receivedAt.getTime() === row.receivedAt.getTime() && other.id > row.id),
          )
        )
          status = 'superseded';
        else
          for (const other of others) {
            await tx
              .update(submissions)
              .set({ status: 'superseded' })
              .where(eq(submissions.id, other.id));
            await recordAudit(tx, {
              actorId: user.id,
              action: 'submission.superseded',
              entityType: 'submission',
              entityId: other.id,
              metadata: { replacementId: id },
            });
          }
      }
      await tx
        .update(submissions)
        .set({
          status,
          decidedBy: user.id,
          decidedAt: new Date(),
          decisionNote: input.note,
          claimedBy: null,
          claimedUntil: null,
        })
        .where(eq(submissions.id, id));
      await recordAudit(tx, {
        actorId: user.id,
        action: `submission.${input.decision}`,
        entityType: 'submission',
        entityId: id,
        metadata: {
          status,
          reasonCode: input.reasonCode ?? 'checked',
          note: input.note,
          approvals,
          needed,
        },
      });
      if (row.observerId)
        await refreshTrust(
          tx,
          row.observerId,
          input.decision === 'rejected' && input.reasonCode === 'fabrication',
        );
      await recomputeSheetMatch(tx, row.electionId, row.pollingUnitId);
      return { id, status, approvals, approvalsRequired: needed };
    });
    return c.json(result);
  });

  app.post('/v1/submissions/:id/withdraw', async (c) => {
    const user = requireRole(c, ['observer']);
    const id = parse(identifierSchema, c.req.param('id'));
    await deps.db.transaction(async (tx) => {
      const [row] = await tx.select().from(submissions).where(eq(submissions.id, id)).for('update');
      if (!row) reject('not_found', 'That observation does not exist.', 404);
      if (row.observerId !== user.id)
        reject('forbidden', 'Only the observer can withdraw this sheet.', 403);
      const [review] = await tx
        .select()
        .from(submissionReviews)
        .where(eq(submissionReviews.submissionId, id))
        .limit(1);
      if (row.status !== 'pending' || row.claimedBy || review)
        reject('conflict', 'An observation can only be withdrawn before review starts.', 409);
      await tx.update(submissions).set({ status: 'withdrawn' }).where(eq(submissions.id, id));
      await recordAudit(tx, {
        actorId: user.id,
        action: 'submission.withdrawn',
        entityType: 'submission',
        entityId: id,
      });
      await recomputeSheetMatch(tx, row.electionId, row.pollingUnitId);
    });
    return c.json({ id, status: 'withdrawn' });
  });
}
