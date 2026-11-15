import { unlink } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import {
  type AppDb,
  auditEvents,
  caseComments,
  discrepancyCases,
  fileDeletions,
  observerProfiles,
  privacyConsents,
  referenceRecords,
  sessions,
  submissionReviews,
  submissionSignals,
  submissions,
  users,
} from '@opencivic/db';
import { RESULTS_DISCLAIMER } from '@opencivic/shared';
import { and, asc, eq, isNull, lt, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { ZipFile } from 'yazl';
import { z } from 'zod';
import type { AppDeps, AppEnv } from './app';
import { parse, readJson, requireRole } from './http';
import { readStoredPhoto } from './photos';
import { recordAudit } from './queries';

export async function drainFileDeletions(deps: Pick<AppDeps, 'db' | 'uploadDir'>) {
  const pending = await deps.db
    .select()
    .from(fileDeletions)
    .orderBy(asc(fileDeletions.createdAt))
    .limit(1000);
  let deleted = 0;
  for (const row of pending) {
    const path = resolve(row.path);
    if (!path.startsWith(`${resolve(deps.uploadDir)}${sep}`))
      throw new Error('Photo deletion is outside the configured store.');
    const referenced = await deps.db.execute(
      sql`SELECT 1 FROM submissions WHERE photo_path = ${row.path} UNION ALL SELECT 1 FROM reference_records WHERE image_path = ${row.path} LIMIT 1`,
    );
    if (referenced.rows.length) continue;
    try {
      await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') continue;
    }
    await deps.db.delete(fileDeletions).where(eq(fileDeletions.path, row.path));
    deleted++;
  }
  return deleted;
}

async function removeUnpublished(db: AppDb, observerId: string, uploadDir: string) {
  // Publication takes the same case lock before it snapshots evidence.
  await db.execute(sql`SELECT id FROM discrepancy_cases WHERE id IN
    (SELECT i.case_id FROM case_items i JOIN discrepancy_flags f ON f.id = i.flag_id JOIN submissions s ON s.id = f.submission_id WHERE s.observer_id = ${observerId}) ORDER BY id FOR UPDATE`);
  await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.observerId, observerId))
    .for('update');
  const records =
    await db.execute(sql`SELECT s.id, s.photo_path AS path FROM submissions s WHERE s.observer_id = ${observerId}
    AND NOT EXISTS (SELECT 1 FROM case_items i JOIN discrepancy_cases c ON c.id = i.case_id WHERE i.snapshot->'observation'->>'id' = s.id AND c.published_at IS NOT NULL)`);
  for (const record of records.rows as Array<{ id: string; path: string | null }>) {
    const cases = await db.execute(
      sql`DELETE FROM case_items i USING discrepancy_flags f WHERE i.flag_id = f.id AND f.submission_id = ${record.id} RETURNING i.case_id AS id`,
    );
    for (const item of cases.rows as Array<{ id: string }>) {
      await db
        .update(discrepancyCases)
        .set({ status: 'dismissed', updatedAt: new Date() })
        .where(and(eq(discrepancyCases.id, item.id), isNull(discrepancyCases.publishedAt)));
      await recordAudit(db, {
        actorId: null,
        action: 'case.dismissed',
        entityType: 'case',
        entityId: item.id,
        metadata: {
          status: 'dismissed',
          note: 'Unpublished evidence was removed following a privacy request.',
        },
      });
      const packs = await db.execute(
        sql`DELETE FROM evidence_packs WHERE case_id = ${item.id} RETURNING version`,
      );
      for (const pack of packs.rows) {
        await db
          .insert(fileDeletions)
          .values({ path: join(uploadDir, 'evidence', `${item.id}-v${pack.version}.zip`) })
          .onConflictDoNothing();
        await recordAudit(db, {
          actorId: null,
          action: 'evidence_pack.withdrawn',
          entityType: 'evidence_pack',
          entityId: `${item.id}:${pack.version}`,
        });
      }
    }
    await db.delete(submissions).where(eq(submissions.id, record.id));
    if (record.path)
      await db.insert(fileDeletions).values({ path: record.path }).onConflictDoNothing();
  }
  await db.delete(submissionSignals).where(eq(submissionSignals.observerId, observerId));
  return records.rows.length;
}

export async function deleteAccount(deps: AppDeps, userId: string) {
  const removed = await deps.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`observer:${userId}`}))`);
    const count = await removeUnpublished(tx, userId, deps.uploadDir);
    await tx
      .update(submissions)
      .set({ observerId: null, clientId: null })
      .where(eq(submissions.observerId, userId));
    await tx.delete(observerProfiles).where(eq(observerProfiles.userId, userId));
    await tx.delete(caseComments).where(eq(caseComments.authorId, userId));
    await tx
      .update(privacyConsents)
      .set({ withdrawnAt: new Date() })
      .where(eq(privacyConsents.userId, userId));
    await tx
      .update(users)
      .set({
        name: 'Deleted account',
        email: `deleted-${userId}@users.invalid`,
        passwordHash: 'deleted',
        deletedAt: new Date(),
      })
      .where(eq(users.id, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await recordAudit(tx, {
      actorId: userId,
      action: 'account.deleted',
      entityType: 'user',
      entityId: userId,
      metadata: { unpublishedRemoved: count },
    });
    return count;
  });
  await drainFileDeletions(deps);
  return removed;
}

export async function runRetention(deps: Pick<AppDeps, 'db' | 'uploadDir'>, now = new Date()) {
  const counts = await deps.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(741210)`);
    await tx.execute(sql`SELECT id FROM discrepancy_cases ORDER BY id FOR UPDATE`);
    const expired = await tx.execute(sql`
      SELECT s.id, s.photo_path AS path, 'observer' AS kind FROM submissions s JOIN elections e ON e.id = s.election_id
      WHERE s.photo_path IS NOT NULL AND e.held_on::date + 180 < ${now.toISOString()}::timestamptz
        AND NOT EXISTS (SELECT 1 FROM case_items i JOIN discrepancy_cases c ON c.id = i.case_id
          WHERE c.published_at IS NOT NULL AND i.snapshot->'observation'->>'id' = s.id)
      UNION ALL
      SELECT r.id, r.image_path, 'reference' FROM reference_records r JOIN elections e ON e.id = r.election_id
      WHERE r.image_path IS NOT NULL AND e.held_on::date + 180 < ${now.toISOString()}::timestamptz
        AND NOT EXISTS (SELECT 1 FROM case_items i JOIN discrepancy_cases c ON c.id = i.case_id
          WHERE c.published_at IS NOT NULL AND i.snapshot->'reference'->>'id' = r.id)
    `);
    for (const row of expired.rows as Array<{ id: string; path: string; kind: string }>) {
      await tx.insert(fileDeletions).values({ path: row.path }).onConflictDoNothing();
      if (row.kind === 'observer')
        await tx
          .update(submissions)
          .set({ photoPath: null, photoBytes: null })
          .where(eq(submissions.id, row.id));
      else
        await tx
          .update(referenceRecords)
          .set({ imagePath: null })
          .where(eq(referenceRecords.id, row.id));
    }
    const packs =
      await tx.execute(sql`DELETE FROM evidence_packs p USING discrepancy_cases c, elections e
      WHERE p.case_id = c.id AND c.election_id = e.id AND c.published_at IS NULL
        AND e.held_on::date + 180 < ${now.toISOString()}::timestamptz RETURNING p.case_id AS id, p.version`);
    for (const pack of packs.rows)
      await tx
        .insert(fileDeletions)
        .values({ path: join(deps.uploadDir, 'evidence', `${pack.id}-v${pack.version}.zip`) })
        .onConflictDoNothing();
    if (expired.rows.length)
      await recordAudit(tx, {
        actorId: null,
        action: 'privacy.retention',
        entityType: 'retention',
        entityId: now.toISOString(),
        metadata: { photosExpired: expired.rows.length },
      });
    return expired.rows.length;
  });
  const signals = await deps.db
    .delete(submissionSignals)
    .where(lt(submissionSignals.createdAt, new Date(now.getTime() - 30 * 86400000)))
    .returning();
  const deleted = await drainFileDeletions(deps);
  return { photosExpired: counts, signalsDeleted: signals.length, filesDeleted: deleted };
}

export function mountPrivacyRoutes(app: Hono<AppEnv>, deps: AppDeps) {
  app.get('/v1/me/export', async (c) => {
    const user = requireRole(c, ['observer', 'reviewer', 'desk', 'admin']);
    const [account] = await deps.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        consentAt: users.consentAt,
        ageConfirmedAt: users.ageConfirmedAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, user.id));
    const sheets = await deps.db
      .select()
      .from(submissions)
      .where(eq(submissions.observerId, user.id))
      .orderBy(submissions.id);
    const references = await deps.db
      .select()
      .from(referenceRecords)
      .where(eq(referenceRecords.transcribedBy, user.id))
      .orderBy(referenceRecords.id);
    const profile = await deps.db
      .select()
      .from(observerProfiles)
      .where(eq(observerProfiles.userId, user.id));
    const consents = await deps.db
      .select()
      .from(privacyConsents)
      .where(eq(privacyConsents.userId, user.id));
    const reviews = await deps.db
      .select()
      .from(submissionReviews)
      .where(eq(submissionReviews.reviewerId, user.id));
    const comments = await deps.db
      .select()
      .from(caseComments)
      .where(eq(caseComments.authorId, user.id));
    const events = await deps.db.select().from(auditEvents).where(eq(auditEvents.actorId, user.id));
    const zip = new ZipFile();
    const options = { mtime: new Date('2000-01-01T00:00:00Z'), mode: 0o100600 };
    const files: Array<{ path: string; recordId: string }> = [];
    for (const record of [
      ...sheets.map((sheet) => ({ id: sheet.id, path: sheet.photoPath, kind: 'observer' })),
      ...references.map((ref) => ({ id: ref.id, path: ref.imagePath, kind: 'reference' })),
    ]) {
      if (!record.path) continue;
      const photo = await readStoredPhoto(deps.uploadDir, record.path);
      const extension =
        photo.mime === 'image/png' ? 'png' : photo.mime === 'image/webp' ? 'webp' : 'jpg';
      const path = `photos/${record.kind}-${record.id}.${extension}`;
      zip.addFile(resolve(record.path), path, options);
      files.push({ path, recordId: record.id });
    }
    const data = {
      official: false,
      disclaimer: RESULTS_DISCLAIMER,
      account,
      profile,
      consents,
      submissions: sheets.map(({ photoPath, ...row }) => row),
      references: references.map(({ imagePath, ...row }) => row),
      reviews,
      comments,
      audit: events,
      photos: files,
    };
    zip.addBuffer(Buffer.from(`${JSON.stringify(data, null, 2)}\n`), 'account.json', options);
    zip.on('error', (error: Error) => zip.outputStream.emit('error', error));
    zip.end();
    c.header('Content-Type', 'application/zip');
    c.header('Content-Disposition', 'attachment; filename="opencivic-account.zip"');
    return c.body(Readable.toWeb(zip.outputStream as Readable) as ReadableStream<Uint8Array>);
  });
  app.post('/v1/me/consent', async (c) => {
    const user = requireRole(c, ['observer', 'reviewer', 'desk', 'admin']);
    const input = parse(
      z.object({ purpose: z.literal('observation_evidence'), granted: z.boolean() }).strict(),
      await readJson(c),
    );
    await deps.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`observer:${user.id}`}))`);
      await tx
        .insert(privacyConsents)
        .values({
          userId: user.id,
          purpose: input.purpose,
          grantedAt: new Date(),
          withdrawnAt: input.granted ? null : new Date(),
        })
        .onConflictDoUpdate({
          target: [privacyConsents.userId, privacyConsents.purpose],
          set: input.granted
            ? { grantedAt: new Date(), withdrawnAt: null }
            : { withdrawnAt: new Date() },
        });
      if (!input.granted) await removeUnpublished(tx, user.id, deps.uploadDir);
      await recordAudit(tx, {
        actorId: user.id,
        action: input.granted ? 'consent.granted' : 'consent.withdrawn',
        entityType: 'user',
        entityId: user.id,
        metadata: input,
      });
    });
    await drainFileDeletions(deps);
    return c.json({ purpose: input.purpose, granted: input.granted });
  });
}
