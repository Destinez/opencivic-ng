import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyVotes } from '@opencivic/shared';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { migrateDatabase } from './migrate';
import { discrepancyFlags, submissions } from './schema';
import { seedDatabase } from './seed';
import { recomputeSheetMatch } from './sheetmatch';
import { openTestDatabase } from './testing';

it('persists flags once and retires resolved flags without deleting evidence history', async () => {
  const handle = await openTestDatabase();
  const uploadDir = await mkdtemp(join(tmpdir(), 'opencivic-match-'));
  try {
    await migrateDatabase(handle.exec);
    await seedDatabase(handle.db, { uploadDir });
    const unit = 'sample-ward-lagos-ikeja-gra-pu-3';
    await handle.db.insert(submissions).values({
      id: 'match-sheet',
      electionId: 'election-sample-poll',
      pollingUnitId: unit,
      observerId: 'user-ada',
      accreditedVoters: 120,
      rejectedBallots: 2,
      partyVotes: { ...emptyVotes(), APC: 112 },
      consistencyWarnings: [],
      status: 'pending',
    });
    const first = await recomputeSheetMatch(handle.db, 'election-sample-poll', unit);
    expect(
      first.some(
        (flag) =>
          flag.rule === 'party_score_mismatch' && flag.observed === 112 && flag.expected === 142,
      ),
    ).toBe(true);
    const again = await recomputeSheetMatch(handle.db, 'election-sample-poll', unit);
    expect(again.map((flag) => flag.id).sort()).toEqual(first.map((flag) => flag.id).sort());
    expect(await handle.db.select().from(discrepancyFlags)).toHaveLength(first.length);
    await handle.db
      .update(submissions)
      .set({ partyVotes: { ...emptyVotes(), APC: 142 } })
      .where(eq(submissions.id, 'match-sheet'));
    const resolved = await recomputeSheetMatch(handle.db, 'election-sample-poll', unit);
    expect(resolved.some((flag) => flag.rule === 'party_score_mismatch')).toBe(false);
    expect((await handle.db.select().from(discrepancyFlags)).some((flag) => !flag.active)).toBe(
      true,
    );
  } finally {
    await handle.close();
    await rm(uploadDir, { recursive: true, force: true });
  }
});
