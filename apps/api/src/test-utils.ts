import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEMO_ACCOUNTS,
  ELECTION_IDS,
  migrateDatabase,
  openTestDatabase,
  seedDatabase,
} from '@opencivic/db';
import { emptyVotes } from '@opencivic/shared';
import { expect } from 'vitest';
import { createApp } from './app';

export const SAMPLE_UNIT = 'sample-ward-lagos-ikeja-gra-pu-3';
export function submissionBody(overrides: Record<string, unknown> = {}) {
  return {
    clientId: randomUUID(),
    capturedAt: '2027-02-20T12:00:00Z',
    electionId: ELECTION_IDS.sample,
    pollingUnitId: SAMPLE_UNIT,
    accreditedVoters: 120,
    rejectedBallots: 2,
    partyVotes: { ...emptyVotes(), APC: 112 },
    declaration: true,
    ...overrides,
  };
}

export async function testApp(rateLimit = false) {
  const handle = await openTestDatabase();
  const uploadDir = await mkdtemp(join(tmpdir(), 'opencivic-api-'));
  await migrateDatabase(handle.exec);
  await seedDatabase(handle.db, { uploadDir });
  const deps = {
    db: handle.db,
    uploadDir,
    webOrigins: ['http://localhost:3000'],
    cookieSecure: false,
    rateLimit,
  };
  const app = createApp(deps);
  const login = async (role: keyof typeof DEMO_ACCOUNTS = 'observer') => {
    const account = DEMO_ACCOUNTS[role];
    const response = await app.request('/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: account.email, password: account.password }),
    });
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) throw new Error('Missing session cookie.');
    return cookie;
  };
  return {
    ...handle,
    app,
    deps,
    uploadDir,
    login,
    close: async () => {
      await handle.close();
      await rm(uploadDir, { recursive: true, force: true });
    },
  };
}
