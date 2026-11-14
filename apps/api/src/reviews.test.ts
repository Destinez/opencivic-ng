import {
  DEMO_ACCOUNTS,
  ELECTION_IDS,
  auditEvents,
  observerProfiles,
  referenceRecords,
  submissionReviews,
  submissions,
} from '@opencivic/db';
import { emptyVotes } from '@opencivic/shared';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleSheetPng } from '../../../packages/db/src/placeholder-png';
import { SAMPLE_UNIT, submissionBody, testApp } from './test-utils';

let setup: Awaited<ReturnType<typeof testApp>>;
let observer: string;
let reviewer: string;
let second: string;
const send = (path: string, cookie: string, body?: unknown, method = 'POST') =>
  setup.app.request(path, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const claim = (id: string, cookie = reviewer) => send(`/v1/review/submissions/${id}/claim`, cookie);
const decide = (id: string, cookie = reviewer, decision = 'approved') =>
  send(`/v1/review/submissions/${id}`, cookie, {
    decision,
    reasonCode: decision === 'approved' ? 'checked' : 'unreadable',
    note: 'Checked the source sheet and figures.',
  });
async function create() {
  const result = await send('/v1/submissions', observer, submissionBody());
  expect(result.status).toBe(201);
  return ((await result.json()) as { id: string }).id;
}

beforeEach(async () => {
  setup = await testApp();
  observer = await setup.login();
  reviewer = await setup.login('reviewer');
  second = await setup.login('reviewer2');
});
afterEach(async () => {
  await setup.close();
});

describe('review claims and independent decisions', () => {
  it('serializes competing claims and releases expired claims with an audit event', async () => {
    const id = await create();
    expect((await decide(id)).status).toBe(409);
    const claims = await Promise.all([claim(id), claim(id, second)]);
    expect(claims.map((response) => response.status).sort()).toEqual([200, 409]);
    const owner = claims[0].status === 200 ? reviewer : second;
    const other = owner === reviewer ? second : reviewer;
    const first = (await (
      claims.find((response) => response.status === 200) as Response
    ).json()) as { claimedUntil: string };
    expect(await (await claim(id, owner)).json()).toMatchObject({
      claimedUntil: first.claimedUntil,
    });
    await setup.db
      .update(submissions)
      .set({ claimedUntil: new Date(Date.now() - 1000) })
      .where(eq(submissions.id, id));
    expect((await decide(id, owner)).status).toBe(409);
    expect((await claim(id, other)).status).toBe(200);
    const events = await setup.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, 'submission.claim_expired')));
    expect(events).toHaveLength(1);
  });

  it('requires two different approvals for L0 and keeps the first approval off the tally', async () => {
    await setup.db
      .update(observerProfiles)
      .set({ trustLevel: 0 })
      .where(eq(observerProfiles.userId, DEMO_ACCOUNTS.observer.id));
    const id = await create();
    expect((await claim(id)).status).toBe(200);
    expect(await (await decide(id)).json()).toMatchObject({
      status: 'pending',
      approvals: 1,
      approvalsRequired: 2,
    });
    expect((await claim(id)).status).toBe(403);
    expect((await claim(id, second)).status).toBe(200);
    expect(await (await decide(id, second)).json()).toMatchObject({
      status: 'approved',
      approvals: 2,
    });
    expect(
      await setup.db.select().from(submissionReviews).where(eq(submissionReviews.submissionId, id)),
    ).toHaveLength(2);
    expect((await claim(id, await setup.login('admin'))).status).toBe(409);
  });

  it('requires reasons and lets a different reviewer check flagged or rejected sheets', async () => {
    for (const decision of ['flagged', 'rejected']) {
      const id = await create();
      expect((await claim(id)).status).toBe(200);
      expect((await send(`/v1/review/submissions/${id}`, reviewer, { decision })).status).toBe(422);
      expect(await (await decide(id, reviewer, decision)).json()).toMatchObject({
        status: decision,
      });
      expect((await claim(id)).status).toBe(403);
      expect((await claim(id, second)).status).toBe(200);
      expect(await (await decide(id, second)).json()).toMatchObject({ status: 'approved' });
    }
  });

  it('blocks observers, desk accounts, and self-claims even after a role change', async () => {
    const id = await create();
    const desk = await setup.login('desk');
    for (const cookie of [observer, desk]) {
      expect((await claim(id, cookie)).status).toBe(403);
      expect((await decide(id, cookie)).status).toBe(403);
      expect(
        (await setup.app.request(`/v1/review/submissions/${id}`, { headers: { cookie } })).status,
      ).toBe(403);
      expect((await send('/v1/references', cookie)).status).toBe(403);
    }
    await setup.db
      .update(submissions)
      .set({ observerId: DEMO_ACCOUNTS.reviewer.id })
      .where(eq(submissions.id, id));
    expect((await claim(id)).status).toBe(403);
    expect((await decide(id)).status).toBe(403);
  });

  it('supersedes only older approved sheets from the same observer and unit', async () => {
    const older = await create();
    await setup.db
      .update(submissions)
      .set({ receivedAt: new Date('2026-01-01') })
      .where(eq(submissions.id, older));
    await claim(older);
    expect((await decide(older)).status).toBe(200);
    const newer = await create();
    await claim(newer);
    expect((await decide(newer)).status).toBe(200);
    const rows = await setup.db
      .select()
      .from(submissions)
      .where(eq(submissions.pollingUnitId, SAMPLE_UNIT));
    expect(rows.find((row) => row.id === older)?.status).toBe('superseded');
    expect(rows.find((row) => row.id === newer)?.status).toBe('approved');
  });

  it('rolls back a decision if the audit event cannot be written', async () => {
    const id = await create();
    await claim(id);
    await setup.exec(
      "CREATE FUNCTION block_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'submission.approved' THEN RAISE EXCEPTION 'test audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION block_review_audit();",
    );
    const output = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await decide(id)).status).toBe(500);
    } finally {
      output.mockRestore();
    }
    expect(
      await setup.db.select().from(submissionReviews).where(eq(submissionReviews.submissionId, id)),
    ).toHaveLength(0);
    const [row] = await setup.db.select().from(submissions).where(eq(submissions.id, id));
    expect(row.status).toBe('in_review');
  });

  it('lets an observer withdraw before review and prevents review after withdrawal', async () => {
    const id = await create();
    expect((await send(`/v1/submissions/${id}/withdraw`, observer)).status).toBe(200);
    expect((await claim(id)).status).toBe(409);
    const next = await create();
    await claim(next);
    expect((await send(`/v1/submissions/${next}/withdraw`, observer)).status).toBe(409);
  });
});

it('stores a labelled reference, computes differences, and requires an independent verifier', async () => {
  const id = await create();
  const form = new FormData();
  form.set(
    'record',
    JSON.stringify({
      electionId: ELECTION_IDS.sample,
      pollingUnitId: SAMPLE_UNIT,
      source: 'sample',
      sourceUrl: 'https://example.com/sample-reference',
      retrievedAt: '2026-11-14T12:00:00Z',
      accreditedVoters: 120,
      rejectedBallots: 2,
      partyVotes: { ...emptyVotes(), APC: 142 },
    }),
  );
  form.set('photo', new File([sampleSheetPng()], 'sample.png', { type: 'image/png' }));
  const response = await setup.app.request('/v1/references', {
    method: 'POST',
    headers: { cookie: reviewer },
    body: form,
  });
  expect(response.status).toBe(201);
  const reference = (await response.json()) as { id: string; imageSha256: string };
  expect(reference).toMatchObject({ dataset: 'sample', official: false });
  expect(reference.imageSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(reference)).not.toContain('imagePath');
  expect(
    (await send(`/v1/references/${reference.id}/verify`, reviewer, undefined, 'PATCH')).status,
  ).toBe(403);
  expect(
    (await send(`/v1/references/${reference.id}/verify`, second, undefined, 'PATCH')).status,
  ).toBe(200);
  expect(
    (await send(`/v1/references/${reference.id}/verify`, second, undefined, 'PATCH')).status,
  ).toBe(200);
  expect((await setup.app.request(`/v1/references/${reference.id}/photo`)).status).toBe(401);
  expect(
    (
      await setup.app.request(`/v1/references/${reference.id}/photo`, {
        headers: { cookie: await setup.login('desk') },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await setup.app.request(`/v1/references/${reference.id}/photo`, {
        headers: { cookie: second },
      })
    ).status,
  ).toBe(200);
  const detail = (await (
    await setup.app.request(`/v1/review/submissions/${id}`, { headers: { cookie: reviewer } })
  ).json()) as { flags: unknown[] };
  expect(detail.flags).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        rule: 'party_score_mismatch',
        field: 'partyVotes.APC',
        observed: 112,
        expected: 142,
        severity: 'critical',
      }),
    ]),
  );
  const [stored] = await setup.db
    .select()
    .from(referenceRecords)
    .where(eq(referenceRecords.id, reference.id));
  expect(stored.verifiedBy).toBe(DEMO_ACCOUNTS.reviewer2.id);
  expect(
    await setup.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.entityId, reference.id), eq(auditEvents.action, 'reference.verified')),
      ),
  ).toHaveLength(1);
});
