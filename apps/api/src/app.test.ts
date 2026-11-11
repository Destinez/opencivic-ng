import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEMO_ACCOUNTS,
  ELECTION_IDS,
  ELECTION_SLUGS,
  migrateDatabase,
  openDatabase,
  seedDatabase,
} from '@opencivic/db';
import { emptyVotes } from '@opencivic/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AppDeps, createApp } from './app';

const uploadDir = mkdtempSync(join(tmpdir(), 'opencivic-'));
const handle = await openDatabase('pglite');
await migrateDatabase(handle.exec);
await seedDatabase(handle.db, { uploadDir });

const app = createApp({
  db: handle.db,
  uploadDir,
  webOrigins: ['http://localhost:3000'],
  cookieSecure: false,
  rateLimit: false,
} satisfies AppDeps);

async function login(email: string, password: string) {
  const response = await app.request('/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('missing session cookie');
  return cookie;
}

describe.sequential('OpenCivic API', () => {
  beforeAll(() => {
    expect(handle.db).toBeTruthy();
  });

  afterAll(async () => {
    await handle.close();
  });

  it('labels sample polling units as unofficial sample data', async () => {
    const response = await app.request('/v1/polling-units?q=Ikeja%20GRA');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      disclaimer: string;
      official: boolean;
      data: Array<{ code: string; dataset: string; official: boolean; datasetNotice: string }>;
    };
    expect(body.official).toBe(false);
    expect(body.disclaimer.toLowerCase()).toContain('not an official');
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((unit) => unit.dataset === 'sample' && unit.official === false)).toBe(
      true,
    );
    expect(body.data[0]?.code.startsWith('SAMPLE/')).toBe(true);
    expect(body.data[0]?.datasetNotice.toLowerCase()).toContain('not an official');
  });

  it('rolls approved observations up without pending, flagged, or superseded sheets', async () => {
    const response = await app.request(
      `/v1/aggregates?election=${ELECTION_SLUGS.sample}&level=state`,
    );
    const body = (await response.json()) as {
      disclaimer: string;
      official: boolean;
      rows: Array<{
        name: string;
        pollingUnitsReporting: number;
        pollingUnitsTotal: number;
        accreditedVoters: number;
        votes: { APC: number };
      }>;
    };
    expect(body.official).toBe(false);
    expect(body.disclaimer.toLowerCase()).toContain('not an inec result');
    const lagos = body.rows.find((row) => row.name === 'Lagos');
    const edo = body.rows.find((row) => row.name === 'Edo');
    expect(lagos).toMatchObject({
      pollingUnitsReporting: 3,
      pollingUnitsTotal: 18,
      accreditedVoters: 1580,
    });
    expect(lagos?.votes.APC).toBe(430);
    expect(edo).toMatchObject({
      pollingUnitsReporting: 3,
      pollingUnitsTotal: 18,
      accreditedVoters: 1080,
    });
  });

  it('serves sourced guidance and an unverified PVC block', async () => {
    const response = await app.request(`/v1/elections/${ELECTION_SLUGS.general}`);
    const body = (await response.json()) as {
      data: {
        acceptsSubmissions: boolean;
        fictional: boolean;
        dates: Array<{ occursOn: string | null; label: string }>;
        guidance: Array<{ topic: string; unverified: boolean; sources: Array<{ url: string }> }>;
      };
    };
    expect(body.data.fictional).toBe(false);
    expect(body.data.acceptsSubmissions).toBe(false);
    expect(body.data.dates.some((date) => date.occursOn === '2027-01-16')).toBe(true);
    const pvc = body.data.guidance.find((block) => block.topic === 'pvc');
    expect(pvc?.unverified).toBe(true);
    expect(pvc?.sources.some((source) => source.url.includes('inecnigeria.org'))).toBe(true);
  });

  it('documents the public routes in OpenAPI', async () => {
    const response = await app.request('/v1/openapi.json');
    const body = (await response.json()) as {
      paths: Record<string, unknown>;
      info: { description: string };
    };
    expect(body.paths['/v1/polling-units']).toBeTruthy();
    expect(body.paths['/v1/elections']).toBeTruthy();
    expect(body.paths['/v1/aggregates']).toBeTruthy();
    expect(body.info.description.toLowerCase()).toContain('not an official');
    const docs = await app.request('/docs');
    expect(docs.status).toBe(200);
    expect(docs.headers.get('content-type')).toContain('text/html');
  });

  it('signs an observer in, rejects a closed election, and lets a reviewer approve a new sheet', async () => {
    const observer = await login(DEMO_ACCOUNTS.observer.email, DEMO_ACCOUNTS.observer.password);
    const closed = await app.request('/v1/submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: observer },
      body: JSON.stringify({
        electionId: ELECTION_IDS.general,
        pollingUnitId: 'sample-ward-lagos-ikeja-gra-pu-3',
        accreditedVoters: 10,
        rejectedBallots: 0,
        partyVotes: { ...emptyVotes(), APC: 4 },
        declaration: true,
      }),
    });
    expect(closed.status).toBe(409);

    const created = await app.request('/v1/submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: observer },
      body: JSON.stringify({
        electionId: ELECTION_IDS.sample,
        pollingUnitId: 'sample-ward-lagos-ikeja-gra-pu-3',
        accreditedVoters: 10,
        rejectedBallots: 1,
        partyVotes: { ...emptyVotes(), LP: 4 },
        declaration: true,
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { id: string; status: string };
    expect(createdBody.status).toBe('pending');

    const forbidden = await app.request(`/v1/review/submissions/${createdBody.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: observer },
      body: JSON.stringify({ decision: 'approved', note: '' }),
    });
    expect(forbidden.status).toBe(403);

    const reviewer = await login(DEMO_ACCOUNTS.reviewer.email, DEMO_ACCOUNTS.reviewer.password);
    const approved = await app.request(`/v1/review/submissions/${createdBody.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: reviewer },
      body: JSON.stringify({ decision: 'approved', note: 'Checked against the described sheet.' }),
    });
    expect(approved.status).toBe(200);
    const again = await app.request(`/v1/review/submissions/${createdBody.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: reviewer },
      body: JSON.stringify({ decision: 'flagged', note: 'Too late to change it.' }),
    });
    expect(again.status).toBe(409);

    const totals = await app.request(
      `/v1/aggregates?election=${ELECTION_SLUGS.sample}&level=lga&parentId=sample-state-lagos`,
    );
    const body = (await totals.json()) as {
      rows: Array<{ name: string; accreditedVoters: number; pollingUnitsReporting: number }>;
    };
    const ikeja = body.rows.find((row) => row.name === 'Ikeja');
    expect(ikeja).toMatchObject({ accreditedVoters: 1590, pollingUnitsReporting: 4 });
  });

  it('refuses a review of your own observation and a short flag note', async () => {
    const reviewer = await login(DEMO_ACCOUNTS.reviewer.email, DEMO_ACCOUNTS.reviewer.password);
    const created = await app.request('/v1/submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: reviewer },
      body: JSON.stringify({
        electionId: ELECTION_IDS.sample,
        pollingUnitId: 'sample-ward-edo-egor-ugbowo-pu-1',
        accreditedVoters: 20,
        rejectedBallots: 0,
        partyVotes: emptyVotes(),
        declaration: true,
      }),
    });
    const body = (await created.json()) as { id: string };
    const own = await app.request(`/v1/review/submissions/${body.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: reviewer },
      body: JSON.stringify({ decision: 'approved' }),
    });
    expect(own.status).toBe(403);

    const observer = await login(DEMO_ACCOUNTS.observer.email, DEMO_ACCOUNTS.observer.password);
    const pending = await app.request('/v1/submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: observer },
      body: JSON.stringify({
        electionId: ELECTION_IDS.sample,
        pollingUnitId: 'sample-ward-edo-egor-ugbowo-pu-2',
        accreditedVoters: 8,
        rejectedBallots: 0,
        partyVotes: { ...emptyVotes(), APC: 3 },
        declaration: true,
      }),
    });
    const pendingBody = (await pending.json()) as { id: string };
    const short = await app.request(`/v1/review/submissions/${pendingBody.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: reviewer },
      body: JSON.stringify({ decision: 'flagged', note: 'no' }),
    });
    expect(short.status).toBe(422);
  });

  it('stores a sheet photo privately and keeps the audit log append-only', async () => {
    const observer = await login(DEMO_ACCOUNTS.observer.email, DEMO_ACCOUNTS.observer.password);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const form = new FormData();
    form.set('electionId', ELECTION_IDS.sample);
    form.set('pollingUnitId', 'sample-ward-edo-ikpoba-idogbo-pu-1');
    form.set('accreditedVoters', '15');
    form.set('rejectedBallots', '0');
    form.set('partyVotes', JSON.stringify({ ...emptyVotes(), PDP: 6 }));
    form.set('declaration', 'true');
    form.set('photo', new File([png], 'sheet.png', { type: 'image/png' }));
    const created = await app.request('/v1/submissions', {
      method: 'POST',
      headers: { cookie: observer },
      body: form,
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { id: string };
    const anonymous = await app.request(`/v1/submissions/${createdBody.id}/photo`);
    expect(anonymous.status).toBe(401);
    const photo = await app.request(`/v1/submissions/${createdBody.id}/photo`, {
      headers: { cookie: observer },
    });
    expect(photo.status).toBe(200);
    expect(photo.headers.get('content-type')).toContain('image/png');

    await expect(handle.exec("UPDATE audit_events SET action = 'tamper'")).rejects.toThrow(
      /append-only/,
    );
  });

  it('removes personal data from a deleted account without editing the audit log', async () => {
    const registered = await app.request('/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Teni Ade',
        email: 'teni.ade@example.com',
        password: 'a-long-password',
        ageConfirmed: true,
        consent: true,
      }),
    });
    expect(registered.status).toBe(201);
    const cookie = registered.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) throw new Error('missing session cookie');
    const removed = await app.request('/v1/auth/me', { method: 'DELETE', headers: { cookie } });
    expect(removed.status).toBe(200);
    const admin = await login(DEMO_ACCOUNTS.admin.email, DEMO_ACCOUNTS.admin.password);
    const audit = await app.request('/v1/admin/audit?limit=200', { headers: { cookie: admin } });
    const text = await audit.text();
    expect(text).not.toContain('teni.ade@example.com');
    expect(text).not.toContain('@');
    const reviewer = await app.request('/v1/admin/audit', {
      headers: {
        cookie: await login(DEMO_ACCOUNTS.reviewer.email, DEMO_ACCOUNTS.reviewer.password),
      },
    });
    expect(reviewer.status).toBe(403);
  });
});
