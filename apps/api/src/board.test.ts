import { createHash } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEMO_ACCOUNTS, ELECTION_IDS, evidencePacks, submissions, users } from '@opencivic/db';
import { emptyVotes } from '@opencivic/shared';
import { eq } from 'drizzle-orm';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { prepareCase } from './case-test-utils';
import { SAMPLE_UNIT, testApp } from './test-utils';

let setup: Awaited<ReturnType<typeof testApp>>;
let fixture: Awaited<ReturnType<typeof prepareCase>>;
beforeEach(async () => {
  setup = await testApp();
  fixture = await prepareCase(setup);
});
afterEach(async () => {
  await setup.close();
});
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

it('keeps draft counts private while letting desk accounts filter non-draft cases', async () => {
  const id = await fixture.open();
  const path = `/v1/polling-units/${SAMPLE_UNIT}/sheetmatch?election=sample-demonstration-poll`;
  expect(await (await setup.app.request(path)).json()).toMatchObject({
    counts: { published: 0, flags: 0 },
    official: false,
  });
  expect((await setup.app.request('/v1/cases?status=all')).status).toBe(403);
  const desk = await setup.login('desk');
  expect(
    await (await setup.app.request('/v1/cases?status=all', { headers: { cookie: desk } })).json(),
  ).toMatchObject({ data: [] });
  await fixture.transition(id, 'under_investigation');
  const response = await setup.app.request(
    '/v1/cases?status=all&state=sample-state-lagos&lga=sample-lga-lagos-ikeja&severity=critical',
    { headers: { cookie: desk } },
  );
  const data = (await response.json()) as { data: Array<{ id: string }> };
  expect(data.data.map((row) => row.id)).toEqual([id]);
  expect(JSON.stringify(data)).not.toContain(DEMO_ACCOUNTS.observer.id);
  expect(
    (await setup.app.request('/v1/cases?status=open', { headers: { cookie: desk } })).status,
  ).toBe(403);
  expect((await setup.app.request(`/v1/cases/${id}/evidence-pack`)).status).toBe(404);
  expect(
    (await setup.app.request(`/v1/cases/${id}/evidence-pack`, { headers: { cookie: desk } }))
      .status,
  ).toBe(200);
});

it('paginates without skipping timestamp ties and binds tokens to validated filters', async () => {
  const published = await fixture.publish();
  await setup.exec(`INSERT INTO discrepancy_cases(id, election_id, polling_unit_id, status, severity, opened_by, confirmed_by, published_at, summary, created_at)
    VALUES ('page-high', 'election-sample-poll', 'sample-ward-lagos-ikeja-gra-pu-1', 'published', 'warn', 'user-chidi', 'user-zainab', now(), 'Fictional pagination example.', '2028-01-01T00:00:00.123456Z'),
    ('page-low', 'election-sample-poll', 'sample-ward-lagos-ikeja-gra-pu-2', 'published', 'warn', 'user-chidi', 'user-zainab', now(), 'Fictional pagination example.', '2028-01-01T00:00:00.123455Z');`);
  const path = '/v1/cases?election=sample-demonstration-poll&limit=1';
  const first = (await (await setup.app.request(path)).json()) as {
    data: Array<{ id: string }>;
    nextPageToken: string;
  };
  expect(first.data[0].id).toBe('page-high');
  const second = (await (
    await setup.app.request(`${path}&page_token=${first.nextPageToken}`)
  ).json()) as typeof first;
  expect(second.data[0].id).toBe('page-low');
  const third = (await (
    await setup.app.request(`${path}&page_token=${second.nextPageToken}`)
  ).json()) as typeof first;
  expect(third.data[0].id).toBe(published);
  expect(third.nextPageToken).toBeNull();
  expect(
    (await setup.app.request(`${path}&severity=critical&page_token=${first.nextPageToken}`)).status,
  ).toBe(422);
  for (const invalid of [
    'limit=51',
    'limit=0',
    'limit=1.5',
    'state=x&state=y',
    'unknown=1',
    'page_token=not-valid-json',
  ])
    expect((await setup.app.request(`/v1/cases?${invalid}`)).status).toBe(422);
  expect(
    await (
      await setup.app.request(
        `/v1/polling-units/${SAMPLE_UNIT}/sheetmatch?election=${ELECTION_IDS.sample}`,
      )
    ).json(),
  ).toMatchObject({ counts: { published: 1, retracted: 0, flags: 2 } });
});

it('streams a complete, reusable evidence archive whose file and archive hashes verify', async () => {
  const id = await fixture.publish();
  const response = await setup.app.request(`/v1/cases/${id}/evidence-pack`);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('application/zip');
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(response.headers.get('x-content-sha256')).toBe(hash(bytes));
  const files = unzipSync(bytes);
  expect(Object.keys(files)).toEqual(
    expect.arrayContaining([
      'case.json',
      'audit.json',
      'provenance.json',
      'manifest.json',
      'SHA256SUMS',
      'DISCLAIMER.txt',
    ]),
  );
  expect(Object.keys(files).filter((name) => name.startsWith('images/'))).toHaveLength(2);
  const manifest = JSON.parse(strFromU8(files['manifest.json']));
  for (const file of manifest.files) {
    expect(hash(files[file.path])).toBe(file.sha256);
    expect(files[file.path].byteLength).toBe(file.bytes);
  }
  for (const line of strFromU8(files.SHA256SUMS).trim().split('\n')) {
    const [expected, name] = line.split('  ');
    expect(hash(files[name])).toBe(expected);
  }
  const caseText = strFromU8(files['case.json']);
  expect(JSON.parse(caseText)).toMatchObject({ official: false, status: 'published' });
  for (const privateValue of [
    DEMO_ACCOUNTS.observer.id,
    DEMO_ACCOUNTS.observer.name,
    DEMO_ACCOUNTS.observer.email,
    setup.uploadDir,
  ])
    expect(caseText).not.toContain(privateValue);
  expect(strFromU8(files['DISCLAIMER.txt'])).toContain('fictional and unofficial');
  const second = await setup.app.request(`/v1/cases/${id}/evidence-pack`);
  expect(hash(new Uint8Array(await second.arrayBuffer()))).toBe(hash(bytes));
  expect(
    await setup.db.select().from(evidencePacks).where(eq(evidencePacks.caseId, id)),
  ).toHaveLength(1);
  await unlink(join(setup.uploadDir, 'evidence', `${id}-v1.zip`));
  const rebuilt = await setup.app.request(`/v1/cases/${id}/evidence-pack`);
  expect(hash(new Uint8Array(await rebuilt.arrayBuffer()))).toBe(hash(bytes));
  const image = await setup.app.request(`/v1/cases/${id}/images/observer/${fixture.sheetId}`);
  expect(image.status).toBe(200);
  expect(image.headers.get('x-content-sha256')).toBe(
    hash(new Uint8Array(await image.arrayBuffer())),
  );
  expect((await setup.app.request(`/v1/cases/${id}/images/observer/unrelated-id`)).status).toBe(
    404,
  );
});

it('issues a new evidence version when a case is retracted', async () => {
  const id = await fixture.publish();
  const initial = await setup.app.request(`/v1/cases/${id}/evidence-pack`);
  const initialHash = initial.headers.get('x-content-sha256');
  await initial.arrayBuffer();
  const admin = await setup.login('admin');
  await fixture.transition(id, 'retracted', admin, 'The reference transcription was corrected.');
  await setup.db
    .update(users)
    .set({ role: 'admin' })
    .where(eq(users.id, DEMO_ACCOUNTS.reviewer2.id));
  await fixture.transition(
    id,
    'retracted',
    fixture.second,
    'Independently confirmed the correction.',
  );
  const response = await setup.app.request(`/v1/cases/${id}/evidence-pack`);
  expect(response.headers.get('x-content-sha256')).not.toBe(initialHash);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  expect(JSON.parse(strFromU8(files['manifest.json'])).version).toBe(2);
  expect(JSON.parse(strFromU8(files['case.json']))).toMatchObject({
    status: 'retracted',
    retractionNote: expect.stringContaining('corrected'),
  });
  expect(
    await setup.db.select().from(evidencePacks).where(eq(evidencePacks.caseId, id)),
  ).toHaveLength(2);
});

it('refuses to package or display an image that no longer matches its case hash', async () => {
  const id = await fixture.publish();
  const [sheet] = await setup.db
    .select()
    .from(submissions)
    .where(eq(submissions.id, fixture.sheetId));
  await writeFile(sheet.photoPath as string, 'altered photo');
  expect(
    (await setup.app.request(`/v1/cases/${id}/images/observer/${fixture.sheetId}`)).status,
  ).toBe(409);
  expect((await setup.app.request(`/v1/cases/${id}/evidence-pack`)).status).toBe(409);
  expect(
    await setup.db.select().from(evidencePacks).where(eq(evidencePacks.caseId, id)),
  ).toHaveLength(0);
});

it('rolls up the newest server receipt and supports totals above a single-sheet limit', async () => {
  for (const row of [
    {
      id: 'rollup-old',
      receivedAt: new Date('2026-01-01'),
      capturedAt: new Date('2028-01-01'),
      votes: 1,
    },
    {
      id: 'rollup-new',
      receivedAt: new Date('2026-02-01'),
      capturedAt: new Date('2025-01-01'),
      votes: 200_000,
    },
  ])
    await setup.db.insert(submissions).values({
      id: row.id,
      electionId: ELECTION_IDS.sample,
      pollingUnitId: SAMPLE_UNIT,
      observerId: DEMO_ACCOUNTS.observer.id,
      accreditedVoters: row.votes,
      rejectedBallots: 0,
      partyVotes: { ...emptyVotes(), APC: row.votes },
      status: 'approved',
      consistencyWarnings: [],
      receivedAt: row.receivedAt,
      capturedAt: row.capturedAt,
    });
  const response = await setup.app.request(
    '/v1/aggregates?election=sample-demonstration-poll&level=state',
  );
  const result = (await response.json()) as {
    rows: Array<{ name: string; votes: { APC: number } }>;
  };
  expect(result.rows.find((row) => row.name === 'Lagos')?.votes.APC).toBe(200430);
});
