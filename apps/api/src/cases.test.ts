import {
  DEMO_ACCOUNTS,
  auditEvents,
  caseItems,
  discrepancyCases,
  discrepancyFlags,
  observerProfiles,
  users,
  verifyAuditChain,
} from '@opencivic/db';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prepareCase } from './case-test-utils';
import { testApp } from './test-utils';

let setup: Awaited<ReturnType<typeof testApp>>;
let fixture: Awaited<ReturnType<typeof prepareCase>>;
beforeEach(async () => {
  setup = await testApp();
  fixture = await prepareCase(setup);
});
afterEach(async () => {
  await setup.close();
});

it('keeps drafts private, prevents duplicate active cases and enforces the transition order', async () => {
  const id = await fixture.open();
  expect((await setup.app.request(`/v1/cases/${id}`)).status).toBe(404);
  const desk = await setup.login('desk');
  expect((await setup.app.request(`/v1/cases/${id}`, { headers: { cookie: desk } })).status).toBe(
    404,
  );
  expect((await fixture.send('/v1/cases', fixture.observer, fixture.input)).status).toBe(403);
  expect((await fixture.send('/v1/cases', fixture.reviewer, fixture.input)).status).toBe(409);
  expect((await fixture.transition(id, 'confirmed', fixture.second)).status).toBe(409);
  expect((await fixture.transition(id, 'under_investigation')).status).toBe(200);
  expect((await setup.app.request(`/v1/cases/${id}`, { headers: { cookie: desk } })).status).toBe(
    200,
  );
  expect((await fixture.transition(id, 'confirmed', desk)).status).toBe(403);
  expect(
    (
      await fixture.send(`/v1/cases/${id}/comments`, desk, {
        body: 'Checking this case for the newsroom.',
      })
    ).status,
  ).toBe(201);
  expect((await fixture.transition(id, 'explained')).status).toBe(200);
  expect((await fixture.transition(id, 'confirmed', fixture.second)).status).toBe(409);
  expect((await setup.app.request(`/v1/cases/${id}`)).status).toBe(404);
});

it('requires independent reference verification and a case confirmer other than its opener', async () => {
  const id = await fixture.open();
  await fixture.transition(id, 'under_investigation');
  expect((await fixture.transition(id, 'confirmed')).status).toBe(403);
  expect((await fixture.transition(id, 'confirmed', fixture.second)).status).toBe(403);
  await fixture.verify();
  expect(await (await fixture.transition(id, 'confirmed', fixture.second)).json()).toMatchObject({
    status: 'published',
  });
  const response = await setup.app.request(`/v1/cases/${id}`);
  expect(response.status).toBe(200);
  const text = await response.text();
  for (const privateValue of [
    DEMO_ACCOUNTS.observer.id,
    DEMO_ACCOUNTS.observer.name,
    DEMO_ACCOUNTS.observer.email,
    'imagePath',
    'photoPath',
  ])
    expect(text).not.toContain(privateValue);
  const data = JSON.parse(text);
  expect(data).toMatchObject({ status: 'published', official: false });
  expect(data.evidence[0].observation.observer).toMatch(/^obs_[a-f0-9]+$/);
  expect(data.history.map((event: { action: string }) => event.action)).toEqual([
    'case.opened',
    'case.under_investigation',
    'case.confirmed',
    'case.published',
  ]);
  expect(data.history.at(-1).hash).toMatch(/^[a-f0-9]{64}$/);
});

it('requires two admins to retract and retains the original published facts and evidence', async () => {
  const id = await fixture.publish();
  expect((await fixture.transition(id, 'retracted', fixture.second)).status).toBe(403);
  const admin = await setup.login('admin');
  expect(
    await (
      await fixture.transition(id, 'retracted', admin, 'The source transcription was corrected.')
    ).json(),
  ).toMatchObject({ status: 'published', retractionPending: true });
  expect((await fixture.transition(id, 'retracted', admin)).status).toBe(403);
  await setup.db
    .update(users)
    .set({ role: 'admin' })
    .where(eq(users.id, DEMO_ACCOUNTS.reviewer2.id));
  expect(
    await (
      await fixture.transition(
        id,
        'retracted',
        fixture.second,
        'Independently checked the corrected transcription.',
      )
    ).json(),
  ).toMatchObject({ status: 'retracted' });
  const published = await setup.app.request(`/v1/cases/${id}`);
  expect(await published.json()).toMatchObject({
    status: 'retracted',
    retractionNote: expect.stringContaining('corrected'),
  });
  await expect(
    setup.db.delete(discrepancyCases).where(eq(discrepancyCases.id, id)),
  ).rejects.toThrow();
  await expect(
    setup.db
      .update(discrepancyCases)
      .set({ summary: 'Changed published facts' })
      .where(eq(discrepancyCases.id, id)),
  ).rejects.toThrow();
  await expect(setup.db.delete(caseItems).where(eq(caseItems.caseId, id))).rejects.toThrow();
  await expect(
    setup.db.update(caseItems).set({ snapshot: {} }).where(eq(caseItems.caseId, id)),
  ).rejects.toThrow();
  expect((await verifyAuditChain(setup.db)).verified).toBe(true);
});

it('rolls back both confirmation and publication if their audit write fails', async () => {
  const id = await fixture.open();
  await fixture.transition(id, 'under_investigation');
  await fixture.verify();
  await setup.exec(
    "CREATE FUNCTION block_publication_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'case.published' THEN RAISE EXCEPTION 'test audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_publication_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION block_publication_audit();",
  );
  const output = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect((await fixture.transition(id, 'confirmed', fixture.second)).status).toBe(500);
  } finally {
    output.mockRestore();
  }
  const [row] = await setup.db.select().from(discrepancyCases).where(eq(discrepancyCases.id, id));
  expect(row).toMatchObject({
    status: 'under_investigation',
    publishedAt: null,
    confirmedBy: null,
  });
  expect(
    await setup.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, 'case.confirmed'))),
  ).toHaveLength(0);
});

it('does not let an L0 observation support a case alone or publish resolved flags', async () => {
  await setup.db
    .update(observerProfiles)
    .set({ trustLevel: 0 })
    .where(eq(observerProfiles.userId, DEMO_ACCOUNTS.observer.id));
  const failed = await fixture.send('/v1/cases', fixture.reviewer, fixture.input);
  expect(failed.status).toBe(409);
  expect(await failed.json()).toMatchObject({ error: { code: 'trust_required' } });
  await setup.db
    .update(observerProfiles)
    .set({ trustLevel: 1 })
    .where(eq(observerProfiles.userId, DEMO_ACCOUNTS.observer.id));
  const id = await fixture.open();
  await fixture.transition(id, 'under_investigation');
  await fixture.verify();
  await setup.db
    .update(discrepancyFlags)
    .set({ active: false })
    .where(eq(discrepancyFlags.id, fixture.flagIds[0]));
  expect((await fixture.transition(id, 'confirmed', fixture.second)).status).toBe(409);
});

it('verifies the full audit chain and rejects attempts to alter it', async () => {
  await fixture.publish();
  const verified = await verifyAuditChain(setup.db);
  expect(verified.events).toBeGreaterThan(20);
  expect(verified.lastHash).toMatch(/^[a-f0-9]{64}$/);
  await expect(setup.exec("UPDATE audit_events SET action = 'altered'")).rejects.toThrow(
    /append-only/,
  );
  await expect(setup.exec('TRUNCATE audit_events')).rejects.toThrow(/append-only/);
  expect((await verifyAuditChain(setup.db)).lastHash).toBe(verified.lastHash);
});
