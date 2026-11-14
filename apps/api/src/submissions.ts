import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import {
  elections,
  observerProfiles,
  pollingUnits,
  recomputeSheetMatch,
  submissions,
} from '@opencivic/db';
import { type SubmissionInput, consistencyWarnings, parseSubmissionBody } from '@opencivic/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps, AppEnv } from './app';
import { readJson, reject, requireRole, validation } from './http';
import { processPhoto, storePhoto } from './photos';
import { recordAudit } from './queries';
import { SUBMISSION_LIMIT, type TakeRequest } from './rate-limit';

function present(row: typeof submissions.$inferSelect) {
  return {
    id: row.id,
    clientId: row.clientId,
    status: row.status,
    capturedAt: row.capturedAt,
    receivedAt: row.receivedAt,
    photoSha256: row.photoSha256,
    photoBytes: row.photoBytes,
    warnings: row.consistencyWarnings,
  };
}

function matchesRetry(row: typeof submissions.$inferSelect, input: SubmissionInput) {
  return (
    row.electionId === input.electionId &&
    row.pollingUnitId === input.pollingUnitId &&
    row.accreditedVoters === input.accreditedVoters &&
    row.rejectedBallots === input.rejectedBallots &&
    row.capturedAt?.getTime() === new Date(input.capturedAt).getTime() &&
    row.declaredTotalVotes === (input.declaredTotalVotes ?? null) &&
    Object.entries(input.partyVotes).every(
      ([party, votes]) => row.partyVotes[party as keyof typeof row.partyVotes] === votes,
    )
  );
}

export function mountSubmissionRoutes(app: Hono<AppEnv>, deps: AppDeps, takeRequest: TakeRequest) {
  app.post('/v1/submissions', async (c) => {
    const user = requireRole(c, ['observer']);
    let payload: unknown;
    let photo: File | null = null;
    if (c.req.header('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
      try {
        const body = await c.req.parseBody({ all: true });
        if (Array.isArray(body.photo)) reject('validation', 'Attach one photo.');
        if (body.photo instanceof File && body.photo.size) photo = body.photo;
        payload = body;
      } catch (error) {
        if (error instanceof Error && error.name === 'HTTPException') throw error;
        reject('validation', 'The multipart form could not be read.', 400);
      }
    } else payload = await readJson(c);
    let input: SubmissionInput;
    try {
      input = parseSubmissionBody(payload);
    } catch (error) {
      if (error instanceof z.ZodError) return validation(c, error);
      reject('validation', 'Party votes must be valid JSON.');
    }
    let storedPath: string | null = null;
    try {
      const result = await deps.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`observer:${user.id}`}))`);
        const [existing] = await tx
          .select()
          .from(submissions)
          .where(
            and(eq(submissions.observerId, user.id), eq(submissions.clientId, input.clientId)),
          );
        if (existing) {
          if (!matchesRetry(existing, input))
            reject('conflict', 'This clientId already belongs to different figures.', 409);
          return { row: existing, created: false };
        }
        const [election] = await tx
          .select()
          .from(elections)
          .where(eq(elections.id, input.electionId));
        if (!election) reject('not_found', 'That election is not in this dataset.', 404);
        if (!election.acceptsSubmissions)
          reject('election_closed', 'This election is not accepting observations.', 409);
        const [unit] = await tx
          .select()
          .from(pollingUnits)
          .where(eq(pollingUnits.id, input.pollingUnitId));
        if (!unit) reject('not_found', 'That polling unit is not in this dataset.', 404);
        if (unit.registeredVoters != null && input.accreditedVoters > unit.registeredVoters)
          reject(
            'validation',
            'Accredited voters cannot exceed registered voters in this dataset.',
          );
        const captured = new Date(input.capturedAt).getTime();
        const day = election.heldOn
          ? new Date(`${election.heldOn}T00:00:00Z`).getTime()
          : Number.NaN;
        if (
          !Number.isFinite(day) ||
          captured < day - 86_400_000 ||
          captured >= day + 2 * 86_400_000
        )
          reject(
            'validation',
            'Capture time must be within the election day, allowing 24 hours on either side.',
          );
        const [profile] = await tx
          .select()
          .from(observerProfiles)
          .where(eq(observerProfiles.userId, user.id));
        if (profile?.frozen)
          reject('forbidden', 'Submissions are frozen pending an admin review.', 403);
        const [count] = await tx
          .select({ total: sql<number>`count(*)::int` })
          .from(submissions)
          .where(
            and(
              eq(submissions.observerId, user.id),
              eq(submissions.electionId, input.electionId),
              eq(submissions.pollingUnitId, input.pollingUnitId),
            ),
          );
        if ((count?.total ?? 0) >= 3)
          reject(
            'rate_limited',
            'At most three observations per polling unit are allowed for this election.',
            429,
          );
        if (deps.rateLimit !== false) {
          const limit = await takeRequest(`submission:${user.id}`, SUBMISSION_LIMIT, tx);
          if (!limit.allowed) {
            c.header('Retry-After', String(limit.retryAfter));
            reject('rate_limited', 'At most ten new observations per hour are allowed.', 429);
          }
        }
        const id = randomUUID();
        const image = photo ? await processPhoto(photo) : null;
        if (image) storedPath = await storePhoto(deps.uploadDir, id, image);
        const warnings = consistencyWarnings(input);
        const [row] = await tx
          .insert(submissions)
          .values({
            id,
            electionId: input.electionId,
            pollingUnitId: input.pollingUnitId,
            observerId: user.id,
            clientId: input.clientId,
            capturedAt: new Date(input.capturedAt),
            receivedAt: new Date(),
            accreditedVoters: input.accreditedVoters,
            rejectedBallots: input.rejectedBallots,
            partyVotes: input.partyVotes,
            declaredTotalVotes: input.declaredTotalVotes,
            consistencyWarnings: warnings,
            photoPath: storedPath,
            photoSha256: image?.sha256,
            photoPhash: image?.phash,
            photoBytes: image?.bytes.length,
            status: 'pending',
          })
          .returning();
        if (!row) throw new Error('Submission insert did not return a row.');
        await tx.insert(observerProfiles).values({ userId: user.id }).onConflictDoNothing();
        await recordAudit(tx, {
          actorId: user.id,
          action: 'submission.created',
          entityType: 'submission',
          entityId: id,
          metadata: {
            clientId: input.clientId,
            electionId: input.electionId,
            pollingUnitId: input.pollingUnitId,
            hasPhoto: Boolean(image),
          },
        });
        await recomputeSheetMatch(tx, input.electionId, input.pollingUnitId);
        return { row, created: true };
      });
      return c.json(present(result.row), result.created ? 201 : 200);
    } catch (error) {
      if (storedPath) await unlink(storedPath).catch(() => undefined);
      throw error;
    }
  });

  app.post('/v1/submissions/:id/photo', async (c) => {
    const user = requireRole(c, ['observer']);
    if (!c.req.header('content-type')?.toLowerCase().startsWith('multipart/form-data'))
      reject('unsupported_media', 'Use a multipart photo field.', 415);
    const body = await c.req
      .parseBody({ all: true })
      .catch(() => reject('validation', 'The multipart form could not be read.', 400));
    if (!(body.photo instanceof File)) reject('validation', 'Attach one photo.');
    const [candidate] = await deps.db
      .select()
      .from(submissions)
      .where(eq(submissions.id, c.req.param('id')));
    if (!candidate) reject('not_found', 'That observation does not exist.', 404);
    if (candidate.observerId !== user.id)
      reject('forbidden', 'Only the observer can attach this photo.', 403);
    const image = await processPhoto(body.photo);
    let storedPath: string | null = null;
    try {
      const row = await deps.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(submissions)
          .where(eq(submissions.id, candidate.id))
          .for('update');
        if (!current) reject('not_found', 'That observation does not exist.', 404);
        if (current.photoSha256 === image.sha256) return current;
        if (current.photoSha256 || current.status !== 'pending' || current.claimedBy)
          reject('conflict', 'A photo can only be attached once, before review starts.', 409);
        storedPath = await storePhoto(deps.uploadDir, current.id, image);
        const [updated] = await tx
          .update(submissions)
          .set({
            photoPath: storedPath,
            photoSha256: image.sha256,
            photoPhash: image.phash,
            photoBytes: image.bytes.length,
          })
          .where(eq(submissions.id, current.id))
          .returning();
        if (!updated) throw new Error('Photo update did not return a row.');
        await recordAudit(tx, {
          actorId: user.id,
          action: 'submission.photo_attached',
          entityType: 'submission',
          entityId: current.id,
          metadata: { sha256: image.sha256, bytes: image.bytes.length },
        });
        await recomputeSheetMatch(tx, current.electionId, current.pollingUnitId);
        return updated;
      });
      return c.json(present(row));
    } catch (error) {
      if (storedPath) await unlink(storedPath).catch(() => undefined);
      throw error;
    }
  });
}
