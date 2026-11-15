import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  type AppDb,
  discrepancyCases,
  evidencePacks,
  referenceRecords,
  submissions,
} from '@opencivic/db';
import { PRODUCT_DISCLAIMER, RESULTS_DISCLAIMER } from '@opencivic/shared';
import { desc, eq, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { ZipFile } from 'yazl';
import { z } from 'zod';
import type { AppDeps, AppEnv, SessionUser } from './app';
import type { CaseEvidence } from './case-evidence';
import { caseDocument, findReadableCase } from './cases';
import { parse, reject } from './http';
import { readStoredPhoto } from './photos';
import { recordAudit } from './queries';
import { identifierSchema } from './request-validation';

const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const asJson = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const disclaimer = `${PRODUCT_DISCLAIMER}\n${RESULTS_DISCLAIMER}\nSample documents are fictional and unofficial. INEC alone declares election results.\n`;

async function imageForEvidence(
  db: AppDb,
  directory: string,
  item: CaseEvidence,
  kind: 'observer' | 'reference',
) {
  const record = kind === 'observer' ? item.observation : item.reference;
  if (!record) reject('not_found', 'This evidence has no reference image.', 404);
  const expected = kind === 'observer' ? item.observation.photoSha256 : item.reference?.imageSha256;
  const [row] =
    kind === 'observer'
      ? await db
          .select({ path: submissions.photoPath })
          .from(submissions)
          .where(eq(submissions.id, record.id))
      : await db
          .select({ path: referenceRecords.imagePath })
          .from(referenceRecords)
          .where(eq(referenceRecords.id, record.id));
  if (!row?.path) reject('not_found', 'This evidence image is no longer stored.', 404);
  const photo = await readStoredPhoto(directory, row.path);
  if (!expected || digest(photo.bytes) !== expected)
    reject(
      'evidence_changed',
      'The stored image does not match the case hash. Ask a reviewer to check it.',
      409,
    );
  const extension =
    photo.mime === 'image/png' ? 'png' : photo.mime === 'image/webp' ? 'webp' : 'jpg';
  return {
    ...photo,
    path: row.path,
    name: `images/${kind}-${record.id}.${extension}`,
    sha256: expected,
  };
}

async function fileDigest(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function buildEvidencePack(deps: AppDeps, id: string, user: SessionUser | null) {
  let createdPath: string | undefined;
  let temporaryPath: string | undefined;
  try {
    return await deps.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`evidence:${id}`}))`);
      await tx
        .select({ id: discrepancyCases.id })
        .from(discrepancyCases)
        .where(eq(discrepancyCases.id, id))
        .for('share');
      const row = await findReadableCase(tx, id, user);
      const document = {
        ...(await caseDocument(tx, row)),
        official: false,
        disclaimer: RESULTS_DISCLAIMER,
      };
      const documentBytes = asJson(document);
      const documentSha256 = digest(documentBytes);
      const [last] = await tx
        .select()
        .from(evidencePacks)
        .where(eq(evidencePacks.caseId, id))
        .orderBy(desc(evidencePacks.version))
        .limit(1);
      const reuse = last?.manifest.documentSha256 === documentSha256;
      const version = reuse ? last.version : (last?.version ?? 0) + 1;
      const directory = join(deps.uploadDir, 'evidence');
      await mkdir(directory, { recursive: true });
      const path = join(directory, `${id}-v${version}.zip`);
      if (reuse && (await fileDigest(path).catch(() => null)) === last.sha256)
        return { path, version, sha256: last.sha256, bytes: (await stat(path)).size };
      const files = new Map<
        string,
        { bytes?: Buffer; path?: string; sha256: string; size: number }
      >();
      const add = (name: string, bytes: Buffer) =>
        files.set(name, { bytes, sha256: digest(bytes), size: bytes.length });
      add('case.json', documentBytes);
      add(
        'audit.json',
        asJson({
          official: false,
          disclaimer: RESULTS_DISCLAIMER,
          note: 'Actors are pseudonymous. Chain hashes anchor the original private audit rows; the operator verifies the complete chain with audit:verify.',
          events: document.history,
        }),
      );
      add(
        'provenance.json',
        asJson({
          official: false,
          disclaimer: RESULTS_DISCLAIMER,
          records: document.evidence.map((item) => {
            const evidence = item as CaseEvidence;
            return {
              observation: evidence.observation,
              reference: evidence.reference,
              reviews: evidence.reviews,
            };
          }),
        }),
      );
      add('DISCLAIMER.txt', Buffer.from(disclaimer));
      for (const item of document.evidence as CaseEvidence[]) {
        for (const kind of ['observer', 'reference'] as const) {
          if (kind === 'reference' && !item.reference) continue;
          const key = `${kind}:${kind === 'observer' ? item.observation.id : item.reference?.id}`;
          if ([...files.keys()].some((name) => name.startsWith(`images/${key.replace(':', '-')}.`)))
            continue;
          const photo = await imageForEvidence(tx, deps.uploadDir, item, kind);
          files.set(photo.name, {
            bytes: photo.bytes,
            sha256: photo.sha256,
            size: photo.bytes.length,
          });
        }
      }
      const createdAt = reuse ? last.createdAt : new Date();
      const manifest = {
        caseId: id,
        version,
        official: false,
        disclaimer: RESULTS_DISCLAIMER,
        createdAt: createdAt.toISOString(),
        documentSha256,
        files: [...files].map(([path, file]) => ({ path, sha256: file.sha256, bytes: file.size })),
      };
      add('manifest.json', asJson(manifest));
      add(
        'SHA256SUMS',
        Buffer.from([...files].map(([name, file]) => `${file.sha256}  ${name}\n`).join('')),
      );
      const zip = new ZipFile();
      const options = { mtime: new Date('2000-01-01T00:00:00Z'), mode: 0o100600 };
      for (const [name, file] of files) {
        if (file.path) zip.addFile(file.path, name, { ...options, compress: false });
        else if (file.bytes) zip.addBuffer(file.bytes, name, options);
      }
      temporaryPath = `${path}.${randomUUID()}.tmp`;
      const hash = createHash('sha256');
      zip.outputStream.on('data', (chunk: Buffer) => hash.update(chunk));
      zip.on('error', (error: Error) => zip.outputStream.emit('error', error));
      const written = pipeline(
        zip.outputStream,
        createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }),
      );
      zip.end();
      await written;
      const sha256 = hash.digest('hex');
      await rename(temporaryPath, path);
      temporaryPath = undefined;
      createdPath = path;
      if (!reuse) {
        await tx.insert(evidencePacks).values({ caseId: id, version, manifest, sha256, createdAt });
        await recordAudit(tx, {
          actorId: user?.id ?? null,
          action: 'evidence_pack.created',
          entityType: 'evidence_pack',
          entityId: `${id}:${version}`,
          metadata: { sha256, version },
        });
      } else if (sha256 !== last.sha256)
        reject('evidence_changed', 'The rebuilt archive differs from its saved hash.', 409);
      return { path, version, sha256, bytes: (await stat(path)).size };
    });
  } catch (error) {
    if (temporaryPath) await unlink(temporaryPath).catch(() => undefined);
    if (createdPath) await unlink(createdPath).catch(() => undefined);
    throw error;
  }
}

export function mountEvidenceRoutes(app: Hono<AppEnv>, deps: AppDeps) {
  app.get('/v1/cases/:id/evidence-pack', async (c) => {
    const id = parse(identifierSchema, c.req.param('id'));
    const pack = await buildEvidencePack(deps, id, c.get('user'));
    c.header('Content-Type', 'application/zip');
    c.header('Content-Disposition', `attachment; filename="case-${id}-v${pack.version}.zip"`);
    c.header('Content-Length', String(pack.bytes));
    c.header('X-Content-SHA256', pack.sha256);
    return c.body(Readable.toWeb(createReadStream(pack.path)) as ReadableStream<Uint8Array>);
  });
  app.get('/v1/cases/:id/images/:kind/:recordId', async (c) => {
    const id = parse(identifierSchema, c.req.param('id'));
    const kind = parse(z.enum(['observer', 'reference']), c.req.param('kind'));
    const recordId = parse(identifierSchema, c.req.param('recordId'));
    const row = await findReadableCase(deps.db, id, c.get('user'));
    const document = await caseDocument(deps.db, row);
    const item = (document.evidence as CaseEvidence[]).find(
      (item) => (kind === 'observer' ? item.observation.id : item.reference?.id) === recordId,
    );
    if (!item) reject('not_found', 'This image is not attached to the case.', 404);
    const photo = await imageForEvidence(deps.db, deps.uploadDir, item, kind);
    c.header('Content-Type', photo.mime);
    c.header('X-Content-SHA256', photo.sha256);
    return c.body(new Uint8Array(photo.bytes));
  });
}
