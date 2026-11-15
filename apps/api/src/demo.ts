import { readFile } from 'node:fs/promises';
import {
  DEMO_ACCOUNTS,
  ELECTION_IDS,
  discrepancyCases,
  referenceRecords,
  seedDatabase,
  submissions,
} from '@opencivic/db';
import { emptyVotes } from '@opencivic/shared';
import { and, eq } from 'drizzle-orm';
import { type AppDeps, createApp } from './app';

const unit = 'sample-ward-lagos-ikeja-anifowoshe-pu-1';
const clientId = '20270220-0000-4000-8000-000000000001';
export async function seedSheetMatchDemo(deps: AppDeps) {
  await seedDatabase(deps.db, { uploadDir: deps.uploadDir });
  const app = createApp({ ...deps, rateLimit: false });
  async function call(path: string, cookie: string, body?: unknown, method = 'POST') {
    const response = await app.request(path, {
      method,
      headers: {
        cookie,
        ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error(`Demo step ${path} failed (${response.status}): ${await response.text()}`);
    return response.json() as Promise<Record<string, unknown>>;
  }
  async function login(role: 'observer' | 'reviewer' | 'reviewer2') {
    const account = DEMO_ACCOUNTS[role];
    const prefix = role === 'reviewer2' ? 'REVIEWER2' : role.toUpperCase();
    const response = await app.request('/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: process.env[`SEED_${prefix}_EMAIL`] ?? account.email,
        password: process.env[`SEED_${prefix}_PASSWORD`] ?? account.password,
      }),
    });
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    if (!cookie || !response.ok)
      throw new Error(
        'Demo accounts must be active. Use a fresh demo database if you deleted them.',
      );
    return cookie;
  }
  const observer = await login('observer');
  const reviewer = await login('reviewer');
  const second = await login('reviewer2');
  const [existing] = await deps.db
    .select()
    .from(discrepancyCases)
    .where(
      and(
        eq(discrepancyCases.electionId, ELECTION_IDS.sample),
        eq(discrepancyCases.pollingUnitId, unit),
      ),
    );
  if (existing?.publishedAt) return { caseId: existing.id, status: existing.status };
  const receipt = await call('/v1/submissions', observer, {
    clientId,
    capturedAt: '2027-02-20T12:00:00Z',
    electionId: ELECTION_IDS.sample,
    pollingUnitId: unit,
    accreditedVoters: 120,
    rejectedBallots: 2,
    partyVotes: { ...emptyVotes(), APC: 112 },
    declaredTotalVotes: 114,
    declaration: true,
  });
  const sheetId = String(receipt.id);
  const [sheet] = await deps.db.select().from(submissions).where(eq(submissions.id, sheetId));
  if (!sheet.photoPath) {
    const form = new FormData();
    form.set(
      'photo',
      new File(
        [
          await readFile(
            new URL('../../../packages/db/fixtures/demo-observer.png', import.meta.url),
          ),
        ],
        'sample-observer.png',
        { type: 'image/png' },
      ),
    );
    await call(`/v1/submissions/${sheetId}/photo`, observer, form);
  }
  let [reference] = await deps.db
    .select()
    .from(referenceRecords)
    .where(
      and(
        eq(referenceRecords.pollingUnitId, unit),
        eq(referenceRecords.electionId, ELECTION_IDS.sample),
      ),
    );
  if (!reference) {
    const form = new FormData();
    form.set(
      'photo',
      new File(
        [
          await readFile(
            new URL('../../../packages/db/fixtures/demo-reference.png', import.meta.url),
          ),
        ],
        'sample-reference.png',
        { type: 'image/png' },
      ),
    );
    form.set(
      'record',
      JSON.stringify({
        electionId: ELECTION_IDS.sample,
        pollingUnitId: unit,
        source: 'sample',
        sourceUrl: 'https://example.com/sample-reference/anifowoshe',
        retrievedAt: '2027-02-20T15:00:00Z',
        accreditedVoters: 120,
        rejectedBallots: 2,
        partyVotes: { ...emptyVotes(), APC: 142 },
        declaredTotalVotes: 144,
      }),
    );
    const created = await call('/v1/references', reviewer, form);
    [reference] = await deps.db
      .select()
      .from(referenceRecords)
      .where(eq(referenceRecords.id, String(created.id)));
  }
  if (!reference.verifiedBy)
    await call(`/v1/references/${reference.id}/verify`, second, undefined, 'PATCH');
  if (sheet.status === 'pending' || sheet.status === 'in_review') {
    await call(`/v1/review/submissions/${sheetId}/claim`, reviewer);
    await call(`/v1/review/submissions/${sheetId}`, reviewer, {
      decision: 'flagged',
      reasonCode: 'document_mismatch',
      note: 'The fictional documents show APC 112 and 142; the reference also exceeds accreditation.',
    });
  }
  let caseId = existing?.id;
  if (!caseId) {
    const detail = await call(`/v1/review/submissions/${sheetId}`, reviewer, undefined, 'GET');
    const flags = detail.flags as Array<{ id: string; rule: string; severity: string }>;
    const opened = await call('/v1/cases', reviewer, {
      flagIds: flags
        .filter((flag) => flag.rule !== 'duplicate_image' && flag.severity !== 'info')
        .map((flag) => flag.id),
      summary:
        'Fictional documents differ by thirty APC votes; the reference total exceeds accredited voters.',
    });
    caseId = String(opened.id);
  }
  const [caseRow] = await deps.db
    .select()
    .from(discrepancyCases)
    .where(eq(discrepancyCases.id, caseId));
  if (caseRow.status === 'open')
    await call(`/v1/cases/${caseId}/transition`, reviewer, {
      to: 'under_investigation',
      note: 'Checking the two fictional sheets and their provenance.',
    });
  await call(`/v1/cases/${caseId}/transition`, second, {
    to: 'confirmed',
    note: 'Independently checked the fictional document differences and verified transcription.',
  });
  const pack = await app.request(`/v1/cases/${caseId}/evidence-pack`);
  if (!pack.ok) throw new Error(`Demo evidence pack failed: ${pack.status}`);
  await pack.arrayBuffer();
  return { caseId, status: 'published' };
}
