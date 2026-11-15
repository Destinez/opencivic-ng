import { createHash } from 'node:crypto';
import { type Sheet, sheetMatch } from '@opencivic/shared';
import { and, desc, eq, notInArray, sql } from 'drizzle-orm';
import type { AppDb } from './client';
import {
  discrepancyFlags,
  observerProfiles,
  pollingUnits,
  referenceRecords,
  submissions,
} from './schema';

export async function recomputeSheetMatch(db: AppDb, electionId: string, pollingUnitId: string) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`sheetmatch:${electionId}:${pollingUnitId}`}))`,
    );
    const [unit] = await tx.select().from(pollingUnits).where(eq(pollingUnits.id, pollingUnitId));
    if (!unit) return [];
    const rows = await tx
      .select({ sheet: submissions, trust: observerProfiles.trustLevel })
      .from(submissions)
      .leftJoin(observerProfiles, eq(observerProfiles.userId, submissions.observerId))
      .where(
        and(
          eq(submissions.electionId, electionId),
          notInArray(submissions.status, ['withdrawn', 'rejected', 'superseded']),
        ),
      );
    const [reference] = await tx
      .select()
      .from(referenceRecords)
      .where(
        and(
          eq(referenceRecords.electionId, electionId),
          eq(referenceRecords.pollingUnitId, pollingUnitId),
        ),
      )
      .orderBy(desc(referenceRecords.createdAt), desc(referenceRecords.id))
      .limit(1);
    const peers: Sheet[] = rows.map(({ sheet, trust }) => ({
      ...sheet,
      approved: sheet.status === 'approved',
      trustLevel: trust ?? 0,
    }));
    await tx
      .update(discrepancyFlags)
      .set({ active: false })
      .where(
        and(
          eq(discrepancyFlags.electionId, electionId),
          eq(discrepancyFlags.pollingUnitId, pollingUnitId),
        ),
      );
    for (const submission of peers.filter((sheet) => sheet.pollingUnitId === pollingUnitId)) {
      for (const flag of sheetMatch({
        submission,
        reference,
        peers,
        registeredVoters: unit.registeredVoters,
      })) {
        const key = `${submission.id}:${flag.referenceId ?? ''}:${flag.rule}:${flag.field}`;
        const values = {
          ...flag,
          active: true,
          electionId,
          pollingUnitId,
          submissionId: submission.id,
        };
        await tx
          .insert(discrepancyFlags)
          .values({
            id: `flag_${createHash('sha256').update(key).digest('hex').slice(0, 32)}`,
            ...values,
          })
          .onConflictDoUpdate({
            target: [
              discrepancyFlags.submissionId,
              discrepancyFlags.referenceId,
              discrepancyFlags.rule,
              discrepancyFlags.field,
            ],
            set: values,
          });
      }
    }
    return tx
      .select()
      .from(discrepancyFlags)
      .where(
        and(
          eq(discrepancyFlags.electionId, electionId),
          eq(discrepancyFlags.pollingUnitId, pollingUnitId),
          eq(discrepancyFlags.active, true),
        ),
      );
  });
}
