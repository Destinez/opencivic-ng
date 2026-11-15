import { randomUUID } from 'node:crypto';
import {
  DEMO_ACCOUNTS,
  ELECTION_IDS,
  observerProfiles,
  submissionReviews,
  submissionSignals,
  submissions,
  users,
} from '@opencivic/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { submissionBody, testApp } from './test-utils';
import { refreshTrust } from './trust';
let setup: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  setup = await testApp();
});
afterEach(async () => {
  await setup.close();
});
const post = (path: string, cookie: string, body: unknown) =>
  setup.app.request(path, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
it('promotes only after three approved sheets without a rejection and never counts the same approval twice', async () => {
  const id = 'trust-observer';
  await setup.db.insert(users).values({
    ...DEMO_ACCOUNTS.observer,
    id,
    email: 'trust@example.com',
    role: 'observer',
    passwordHash: 'unused',
    consentAt: new Date(),
    ageConfirmedAt: new Date(),
  });
  for (let i = 0; i < 3; i++)
    await setup.db.insert(submissions).values({
      ...submissionBody(),
      id: `trust-${i}`,
      observerId: id,
      capturedAt: new Date(),
      status: i === 0 ? 'superseded' : 'approved',
      consistencyWarnings: [],
    });
  await setup.db.transaction((tx) => refreshTrust(tx, id));
  await setup.db.transaction((tx) => refreshTrust(tx, id));
  expect(
    (await setup.db.select().from(observerProfiles).where(eq(observerProfiles.userId, id)))[0],
  ).toMatchObject({ trustLevel: 1, approvedCount: 3, rejectedCount: 0 });
  await setup.db.insert(submissionReviews).values({
    submissionId: 'trust-0',
    reviewerId: DEMO_ACCOUNTS.reviewer.id,
    decision: 'rejected',
    reasonCode: 'fabrication',
    note: 'The document is fabricated.',
  });
  await setup.db.transaction((tx) => refreshTrust(tx, id, true));
  expect(
    (await setup.db.select().from(observerProfiles).where(eq(observerProfiles.userId, id)))[0],
  ).toMatchObject({ trustLevel: 0, frozen: true, rejectedCount: 1 });
});
it('freezes fabrication rejections through the review route and requires an admin to restore submissions', async () => {
  const observer = await setup.login();
  const reviewer = await setup.login('reviewer');
  const admin = await setup.login('admin');
  const sheet = await post('/v1/submissions', observer, submissionBody());
  const { id } = (await sheet.json()) as { id: string };
  expect((await post(`/v1/review/submissions/${id}/claim`, reviewer, {})).status).toBe(200);
  expect(
    (
      await post(`/v1/review/submissions/${id}`, reviewer, {
        decision: 'rejected',
        reasonCode: 'fabrication',
        note: 'The image was fabricated.',
      })
    ).status,
  ).toBe(200);
  expect((await post('/v1/submissions', observer, submissionBody())).status).toBe(403);
  const path = `/v1/admin/observers/${DEMO_ACCOUNTS.observer.id}/trust`;
  const input = {
    trustLevel: 2,
    accreditationRef: 'SAMPLE/accreditation',
    frozen: false,
    note: 'Checked accreditation independently.',
  };
  expect((await post(path, reviewer, input)).status).toBe(403);
  expect((await post(path, admin, { ...input, accreditationRef: null })).status).toBe(422);
  expect((await post(path, admin, input)).status).toBe(200);
  expect((await post('/v1/submissions', observer, submissionBody())).status).toBe(201);
  expect(
    (await setup.app.request('/v1/admin/observers', { headers: { cookie: admin } })).status,
  ).toBe(200);
});
it('groups hashed connection and device signals across units without exposing them to desk or public readers', async () => {
  const observer = await setup.login();
  const admin = await setup.login('admin');
  const device = randomUUID();
  for (let i = 0; i < 5; i++) {
    const response = await setup.app.request('/v1/submissions', {
      method: 'POST',
      headers: { cookie: observer, 'content-type': 'application/json', 'x-device-id': device },
      body: JSON.stringify(
        submissionBody({ pollingUnitId: `sample-ward-lagos-ikeja-anifowoshe-pu-${(i % 3) + 1}` }),
      ),
    });
    expect(response.status).toBe(201);
  }
  const signals = await setup.db.select().from(submissionSignals);
  expect(signals).toHaveLength(5);
  expect(JSON.stringify(signals)).not.toContain(device);
  expect(signals[0].ipHash).toMatch(/^[a-f0-9]{64}$/);
  const abuse = (await (
    await setup.app.request('/v1/admin/abuse', { headers: { cookie: admin } })
  ).json()) as { signals: unknown[] };
  expect(abuse.signals).toHaveLength(2);
  expect(
    (await setup.app.request('/v1/admin/abuse', { headers: { cookie: await setup.login('desk') } }))
      .status,
  ).toBe(403);
  expect((await setup.app.request('/v1/admin/observers')).status).toBe(401);
  await setup.exec("UPDATE submission_signals SET created_at = now() - interval '31 days'");
  expect(
    await (await setup.app.request('/v1/admin/abuse', { headers: { cookie: admin } })).json(),
  ).toMatchObject({ signals: [] });
});
it('audits election config and rolls trust changes back when audit writes fail', async () => {
  const admin = await setup.login('admin');
  expect(
    (
      await post(`/v1/admin/elections/${ELECTION_IDS.sample}/config`, admin, {
        acceptsSubmissions: false,
        note: 'Close the fictional sample poll.',
      })
    ).status,
  ).toBe(200);
  expect((await post('/v1/submissions', await setup.login(), submissionBody())).status).toBe(409);
  await setup.exec(
    "CREATE FUNCTION deny_trust_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'observer.trust_changed' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER deny_trust BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_trust_audit();",
  );
  expect(
    (
      await post(`/v1/admin/observers/${DEMO_ACCOUNTS.observer.id}/trust`, admin, {
        trustLevel: 3,
        accreditationRef: 'SAMPLE/coordinator',
        frozen: false,
        note: 'Verify coordinator accreditation.',
      })
    ).status,
  ).toBe(500);
  expect(
    (
      await setup.db
        .select()
        .from(observerProfiles)
        .where(eq(observerProfiles.userId, DEMO_ACCOUNTS.observer.id))
    )[0].trustLevel,
  ).toBe(1);
});
