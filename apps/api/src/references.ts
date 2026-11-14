import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { elections, pollingUnits, recomputeSheetMatch, referenceRecords } from '@opencivic/db';
import { partyVotesSchema } from '@opencivic/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps, AppEnv } from './app';
import { parse, reject, requireRole } from './http';
import { processPhoto, readStoredPhoto, storePhoto } from './photos';
import { recordAudit } from './queries';
import { REFERENCE_LIMIT, type TakeRequest } from './rate-limit';
import { identifierSchema } from './request-validation';

const referenceSchema = z
  .object({
    electionId: identifierSchema,
    pollingUnitId: identifierSchema,
    source: z.enum(['irev', 'ec8a_copy', 'sample']),
    sourceUrl: z
      .string()
      .max(2000)
      .url()
      .refine((value) => {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password;
      }, 'Cite an HTTPS source without credentials.'),
    retrievedAt: z.string().datetime({ offset: true }),
    accreditedVoters: z.number().int().min(0).max(200_000),
    rejectedBallots: z.number().int().min(0).max(200_000),
    partyVotes: partyVotesSchema,
    declaredTotalVotes: z.number().int().min(0).max(2_000_000).optional(),
  })
  .strict();

export function presentReference(row: typeof referenceRecords.$inferSelect) {
  const { imagePath, ...record } = row;
  return {
    ...record,
    imageUrl: `/v1/references/${row.id}/photo`,
    notice:
      row.dataset === 'sample'
        ? 'SAMPLE — fictional reference, not an IReV record.'
        : 'Manually attached reference. Confirm the source and transcription.',
    official: false,
  };
}

export function mountReferenceRoutes(app: Hono<AppEnv>, deps: AppDeps, takeRequest: TakeRequest) {
  app.post('/v1/references', async (c) => {
    const user = requireRole(c, ['reviewer', 'admin']);
    if (!c.req.header('content-type')?.toLowerCase().startsWith('multipart/form-data'))
      reject('unsupported_media', 'Attach a photo and a JSON record in a multipart form.', 415);
    const body = await c.req
      .parseBody({ all: true })
      .catch(() => reject('validation', 'The multipart form could not be read.', 400));
    if (!(body.photo instanceof File) || typeof body.record !== 'string')
      reject('validation', 'Attach one photo and one JSON record.');
    let record: unknown;
    try {
      record = JSON.parse(body.record);
    } catch {
      reject('validation', 'The reference record must be valid JSON.', 400);
    }
    const input = parse(referenceSchema, record);
    if (input.source === 'irev') {
      const host = new URL(input.sourceUrl).hostname;
      if (host !== 'inecelectionresults.ng' && !host.endsWith('.inecelectionresults.ng'))
        reject('validation', 'Use the original IReV URL for an IReV reference.');
    }
    const image = await processPhoto(body.photo);
    let stored: string | undefined;
    try {
      const row = await deps.db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`reference:${input.electionId}:${input.pollingUnitId}`}))`,
        );
        const [election] = await tx
          .select()
          .from(elections)
          .where(eq(elections.id, input.electionId));
        const [unit] = await tx
          .select()
          .from(pollingUnits)
          .where(eq(pollingUnits.id, input.pollingUnitId));
        if (!election || !unit)
          reject('not_found', 'Choose an election and unit from this dataset.', 404);
        if ((election.fictional || unit.dataset === 'sample') !== (input.source === 'sample'))
          reject(
            'validation',
            'Fictional elections and sample units require a labelled sample reference.',
          );
        const [existing] = await tx
          .select()
          .from(referenceRecords)
          .where(
            and(
              eq(referenceRecords.electionId, input.electionId),
              eq(referenceRecords.pollingUnitId, input.pollingUnitId),
              eq(referenceRecords.imageSha256, image.sha256),
            ),
          );
        if (existing)
          reject('conflict', 'This image is already attached to this unit and election.', 409);
        if (deps.rateLimit !== false) {
          const limit = await takeRequest(`reference:${user.id}`, REFERENCE_LIMIT, tx);
          if (!limit.allowed) {
            c.header('Retry-After', String(limit.retryAfter));
            reject('rate_limited', 'At most sixty reference records per hour are allowed.', 429);
          }
        }
        const id = randomUUID();
        stored = await storePhoto(deps.uploadDir, `reference-${id}`, image);
        const [created] = await tx
          .insert(referenceRecords)
          .values({
            ...input,
            id,
            retrievedAt: new Date(input.retrievedAt),
            imagePath: stored,
            imageSha256: image.sha256,
            transcribedBy: user.id,
            dataset: input.source === 'sample' ? 'sample' : 'manual',
          })
          .returning();
        if (!created) throw new Error('Reference insert did not return a row.');
        await recordAudit(tx, {
          actorId: user.id,
          action: 'reference.created',
          entityType: 'reference',
          entityId: id,
          metadata: { source: input.source, sourceUrl: input.sourceUrl, sha256: image.sha256 },
        });
        await recomputeSheetMatch(tx, input.electionId, input.pollingUnitId);
        return created;
      });
      return c.json(presentReference(row), 201);
    } catch (error) {
      if (stored) await unlink(stored).catch(() => undefined);
      throw error;
    }
  });

  app.patch('/v1/references/:id/verify', async (c) => {
    const user = requireRole(c, ['reviewer', 'admin']);
    const id = parse(identifierSchema, c.req.param('id'));
    const row = await deps.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(referenceRecords)
        .where(eq(referenceRecords.id, id))
        .for('update');
      if (!current) reject('not_found', 'That reference does not exist.', 404);
      if (current.transcribedBy === user.id)
        reject('two_person_rule', 'A different reviewer must verify this reference.', 403);
      if (current.verifiedBy) return current;
      const [updated] = await tx
        .update(referenceRecords)
        .set({ verifiedBy: user.id, verifiedAt: new Date() })
        .where(eq(referenceRecords.id, id))
        .returning();
      if (!updated) throw new Error('Reference verification did not return a row.');
      await recordAudit(tx, {
        actorId: user.id,
        action: 'reference.verified',
        entityType: 'reference',
        entityId: id,
        metadata: { sha256: current.imageSha256 },
      });
      await recomputeSheetMatch(tx, current.electionId, current.pollingUnitId);
      return updated;
    });
    return c.json(presentReference(row));
  });

  app.get('/v1/references/:id/photo', async (c) => {
    requireRole(c, ['reviewer', 'admin']);
    const id = parse(identifierSchema, c.req.param('id'));
    const [row] = await deps.db.select().from(referenceRecords).where(eq(referenceRecords.id, id));
    if (!row) reject('not_found', 'That reference does not exist.', 404);
    const photo = await readStoredPhoto(deps.uploadDir, row.imagePath);
    c.header('Content-Type', photo.mime);
    return c.body(new Uint8Array(photo.bytes));
  });
}
