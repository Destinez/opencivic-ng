import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEMO_ACCOUNTS,
  privacyConsents,
  referenceRecords,
  submissionSignals,
  submissions,
} from '@opencivic/db';
import { hasContactDetails } from '@opencivic/shared/privacy';
import { eq } from 'drizzle-orm';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { prepareCase } from './case-test-utils';
import { runRetention } from './privacy';
import { submissionBody, testApp } from './test-utils';
let setup: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  setup = await testApp();
});
afterEach(async () => {
  await setup.close();
});
const post = (path: string, cookie: string, data: unknown) =>
  setup.app.request(path, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
it('exports only the account records and photos, without passwords, sessions or storage paths', async () => {
  expect((await setup.app.request('/v1/me/export')).status).toBe(401);
  const response = await setup.app.request('/v1/me/export', {
    headers: { cookie: await setup.login() },
  });
  expect(response.status).toBe(200);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const text = strFromU8(files['account.json']);
  const data = JSON.parse(text);
  expect(data).toMatchObject({ official: false, account: { email: DEMO_ACCOUNTS.observer.email } });
  expect(Object.keys(files).some((name) => name.startsWith('photos/'))).toBe(true);
  for (const privateText of [
    'passwordHash',
    'tokenHash',
    'photoPath',
    'imagePath',
    setup.uploadDir,
    DEMO_ACCOUNTS.admin.email,
  ])
    expect(text).not.toContain(privateText);
});
it('deletes unpublished observations and archives while keeping published evidence de-identified and downloadable', async () => {
  const fixture = await prepareCase(setup);
  const caseId = await fixture.publish();
  const [retained] = await setup.db
    .select()
    .from(submissions)
    .where(eq(submissions.id, fixture.sheetId));
  const response = await post(
    '/v1/submissions',
    fixture.observer,
    submissionBody({ pollingUnitId: 'sample-ward-lagos-ikeja-anifowoshe-pu-1' }),
  );
  const { id } = (await response.json()) as { id: string };
  expect(
    (
      await setup.app.request('/v1/auth/me', {
        method: 'DELETE',
        headers: { cookie: fixture.observer },
      })
    ).status,
  ).toBe(200);
  expect(await setup.db.select().from(submissions).where(eq(submissions.id, id))).toHaveLength(0);
  expect(
    (await setup.db.select().from(submissions).where(eq(submissions.id, fixture.sheetId)))[0],
  ).toMatchObject({ observerId: null, clientId: null, photoPath: retained.photoPath });
  expect(
    (await setup.app.request('/v1/auth/me', { headers: { cookie: fixture.observer } })).status,
  ).toBe(401);
  expect((await setup.app.request(`/v1/cases/${caseId}/evidence-pack`)).status).toBe(200);
  expect((await readFile(retained.photoPath as string)).length).toBeGreaterThan(0);
});
it('removes draft case evidence and its cached archive on a privacy deletion', async () => {
  const fixture = await prepareCase(setup);
  const id = await fixture.open();
  const response = await setup.app.request(`/v1/cases/${id}/evidence-pack`, {
    headers: { cookie: fixture.reviewer },
  });
  expect(response.status).toBe(200);
  await response.arrayBuffer();
  const archive = join(setup.uploadDir, 'evidence', `${id}-v1.zip`);
  expect((await stat(archive)).size).toBeGreaterThan(0);
  expect(
    (
      await setup.app.request('/v1/auth/me', {
        method: 'DELETE',
        headers: { cookie: fixture.observer },
      })
    ).status,
  ).toBe(200);
  await expect(stat(archive)).rejects.toMatchObject({ code: 'ENOENT' });
  const document = await (
    await setup.app.request(`/v1/cases/${id}`, { headers: { cookie: fixture.reviewer } })
  ).json();
  expect(document).toMatchObject({ status: 'dismissed', evidence: [] });
});
it('withdraws purpose-specific consent, blocks new sheets and allows an explicit restoration', async () => {
  const cookie = await setup.login();
  expect(
    (await post('/v1/me/consent', cookie, { purpose: 'observation_evidence', granted: false }))
      .status,
  ).toBe(200);
  expect((await post('/v1/submissions', cookie, submissionBody())).status).toBe(403);
  expect(
    (
      await setup.db
        .select()
        .from(privacyConsents)
        .where(eq(privacyConsents.userId, DEMO_ACCOUNTS.observer.id))
    )[0].withdrawnAt,
  ).toBeInstanceOf(Date);
  expect(
    (await post('/v1/me/consent', cookie, { purpose: 'observation_evidence', granted: true }))
      .status,
  ).toBe(200);
  expect((await post('/v1/submissions', cookie, submissionBody())).status).toBe(201);
});
it('purges expired raw photos, private archives and thirty-day signals but retains published observer/reference images', async () => {
  const fixture = await prepareCase(setup);
  const id = await fixture.publish();
  const [published] = await setup.db
    .select()
    .from(submissions)
    .where(eq(submissions.id, fixture.sheetId));
  const [reference] = await setup.db
    .select()
    .from(referenceRecords)
    .where(eq(referenceRecords.id, 'sample-reference-ikeja-gra'));
  const response = await post(
    '/v1/submissions',
    fixture.observer,
    submissionBody({ pollingUnitId: 'sample-ward-lagos-ikeja-anifowoshe-pu-1' }),
  );
  const { id: rawId } = (await response.json()) as { id: string };
  const form = new FormData();
  form.set(
    'photo',
    new File([await readFile(published.photoPath as string)], 'raw.jpg', { type: 'image/jpeg' }),
  );
  expect(
    (
      await setup.app.request(`/v1/submissions/${rawId}/photo`, {
        method: 'POST',
        headers: { cookie: fixture.observer },
        body: form,
      })
    ).status,
  ).toBe(200);
  const [raw] = await setup.db.select().from(submissions).where(eq(submissions.id, rawId));
  await setup.db.update(submissionSignals).set({ createdAt: new Date('2027-01-01') });
  const before = await runRetention(setup.deps, new Date('2027-03-01'));
  expect(before.photosExpired).toBe(0);
  const result = await runRetention(setup.deps, new Date('2028-01-01'));
  expect(result.photosExpired).toBeGreaterThan(0);
  await expect(stat(raw.photoPath as string)).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await stat(published.photoPath as string)).size).toBeGreaterThan(0);
  expect((await stat(reference.imagePath as string)).size).toBeGreaterThan(0);
  expect(await setup.db.select().from(submissionSignals)).toHaveLength(0);
  expect((await setup.app.request(`/v1/cases/${id}/evidence-pack`)).status).toBe(200);
  expect((await runRetention(setup.deps, new Date('2028-01-01'))).photosExpired).toBe(0);
});
it('detects contact details in notes while allowing document figures', async () => {
  expect(hasContactDetails('Call +234 803 123 4567')).toBe(true);
  expect(hasContactDetails('person@example.com')).toBe(true);
  expect(hasContactDetails('APC 112 differs from 142 by 30.')).toBe(false);
  const fixture = await prepareCase(setup);
  expect(
    (
      await post('/v1/cases', fixture.reviewer, {
        flagIds: fixture.flagIds,
        summary: 'Contact person@example.com about the sheet.',
      })
    ).status,
  ).toBe(422);
});
