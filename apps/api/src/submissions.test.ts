import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { auditEvents, buildSampleGeography, discrepancyFlags, submissions } from '@opencivic/db';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { processPhoto } from './photos';
import { SAMPLE_UNIT, submissionBody, testApp } from './test-utils';

describe('submission retries and photos', () => {
  it('returns one submission and one audit event for five concurrent retries', async () => {
    const fixture = await testApp();
    try {
      const cookie = await fixture.login();
      const body = submissionBody();
      const wrongOwner = await fixture.app.request('/v1/submissions', {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json',
          'x-observer-id': 'another-observer',
        },
        body: JSON.stringify(body),
      });
      expect(wrongOwner.status).toBe(403);
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          fixture.app.request('/v1/submissions', {
            method: 'POST',
            headers: { cookie, 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
        ),
      );
      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 200, 200, 200, 201,
      ]);
      const rows = await Promise.all(
        responses.map(
          (response) =>
            response.json() as Promise<{
              id: string;
              official: boolean;
              disclaimer: string;
              clientId: string;
              requestId: string;
            }>,
        ),
      );
      expect(new Set(rows.map((row) => row.id)).size).toBe(1);
      expect(
        rows.every(
          (row) =>
            !row.official && row.disclaimer && row.requestId && row.clientId === body.clientId,
        ),
      ).toBe(true);
      expect(
        await fixture.db.select().from(submissions).where(eq(submissions.clientId, body.clientId)),
      ).toHaveLength(1);
      expect(
        await fixture.db
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.entityId, rows[0]?.id ?? ''),
              eq(auditEvents.action, 'submission.created'),
            ),
          ),
      ).toHaveLength(1);
      const changed = await fixture.app.request('/v1/submissions', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, accreditedVoters: 121 }),
      });
      expect(changed.status).toBe(409);
    } finally {
      await fixture.close();
    }
  });

  it('sends figures first, strips GPS metadata, and detects a reused photo on another unit', async () => {
    const fixture = await testApp();
    try {
      const cookie = await fixture.login();
      const source = await sharp({
        create: { width: 200, height: 150, channels: 3, background: '#f3efe2' },
      })
        .jpeg()
        .withExif({
          IFD0: { Artist: 'Sample private photographer' },
          IFD3: {
            GPSLatitudeRef: 'N',
            GPSLatitude: '6/1 36/1 0/1',
            GPSLongitudeRef: 'E',
            GPSLongitude: '3/1 20/1 0/1',
          },
        })
        .toBuffer();
      expect((await sharp(source).metadata()).exif).toBeTruthy();
      const create = async (unit: string) => {
        const response = await fixture.app.request('/v1/submissions', {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify(submissionBody({ pollingUnitId: unit })),
        });
        expect(response.status).toBe(201);
        return (await response.json()) as { id: string; photoSha256: string | null };
      };
      const first = await create(SAMPLE_UNIT);
      expect(first.photoSha256).toBeNull();
      const upload = async (id: string) => {
        const form = new FormData();
        form.set('photo', new File([new Uint8Array(source)], 'sample.jpg', { type: 'image/jpeg' }));
        return fixture.app.request(`/v1/submissions/${id}/photo`, {
          method: 'POST',
          headers: { cookie },
          body: form,
        });
      };
      expect((await upload(first.id)).status).toBe(200);
      expect((await upload(first.id)).status).toBe(200);
      const [stored] = await fixture.db
        .select()
        .from(submissions)
        .where(eq(submissions.id, first.id));
      const bytes = await readFile(stored?.photoPath ?? '');
      const metadata = await sharp(bytes).metadata();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.iptc).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(stored?.photoSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(stored?.photoPhash).toMatch(/^[a-f0-9]{16}$/);
      expect(stored?.photoBytes).toBe(bytes.length);
      expect(
        await fixture.db
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.entityId, first.id),
              eq(auditEvents.action, 'submission.photo_attached'),
            ),
          ),
      ).toHaveLength(1);
      const second = await create('sample-ward-lagos-ikeja-gra-pu-2');
      expect((await upload(second.id)).status).toBe(200);
      expect(
        await fixture.db
          .select()
          .from(discrepancyFlags)
          .where(
            and(
              eq(discrepancyFlags.submissionId, second.id),
              eq(discrepancyFlags.rule, 'duplicate_image'),
            ),
          ),
      ).toHaveLength(1);
      expect((await fixture.app.request(`/v1/submissions/${first.id}/photo`)).status).toBe(401);
      expect(
        (
          await fixture.app.request(`/v1/submissions/${first.id}/photo`, {
            headers: { cookie: await fixture.login('desk') },
          })
        ).status,
      ).toBe(403);
    } finally {
      await fixture.close();
    }
  });

  it('requires retry identity, a plausible capture time, registered-voter limits, and observer role', async () => {
    const fixture = await testApp();
    try {
      const cookie = await fixture.login();
      const send = (body: unknown, session = cookie) =>
        fixture.app.request('/v1/submissions', {
          method: 'POST',
          headers: { cookie: session, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      for (const overrides of [
        { clientId: undefined },
        { capturedAt: undefined },
        { capturedAt: '2000-01-01T00:00:00Z' },
        { accreditedVoters: 200_000 },
      ])
        expect((await send(submissionBody(overrides))).status).toBe(422);
      for (const role of ['reviewer', 'desk', 'admin'] as const)
        expect((await send(submissionBody(), await fixture.login(role))).status).toBe(403);
      await expect(
        processPhoto(new File(['not an image'], 'image.png', { type: 'image/png' })),
      ).rejects.toMatchObject({ status: 415 });
      await expect(
        processPhoto(new File([new Uint8Array(2_000_001)], 'image.jpg', { type: 'image/jpeg' })),
      ).rejects.toMatchObject({ status: 413 });
    } finally {
      await fixture.close();
    }
  });

  it('allows three reports per unit while letting an earlier retry through', async () => {
    const fixture = await testApp();
    try {
      const cookie = await fixture.login();
      const send = (body: unknown) =>
        fixture.app.request('/v1/submissions', {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      const first = submissionBody();
      expect((await send(first)).status).toBe(201);
      expect((await send(submissionBody())).status).toBe(201);
      expect((await send(submissionBody())).status).toBe(201);
      expect((await send(submissionBody())).status).toBe(429);
      expect((await send(first)).status).toBe(200);
    } finally {
      await fixture.close();
    }
  });

  it('enforces the hourly observer quota without charging retries', async () => {
    const fixture = await testApp(true);
    try {
      const cookie = await fixture.login();
      const send = (body: unknown) =>
        fixture.app.request('/v1/submissions', {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      const units = buildSampleGeography().units.slice(0, 11);
      const first = submissionBody({ pollingUnitId: units[0]?.id });
      expect((await send(first)).status).toBe(201);
      for (const unit of units.slice(1, 10))
        expect((await send(submissionBody({ pollingUnitId: unit.id }))).status).toBe(201);
      const limited = await send(submissionBody({ pollingUnitId: units[10]?.id }));
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
      expect((await send(first)).status).toBe(200);
    } finally {
      await fixture.close();
    }
  });
});
