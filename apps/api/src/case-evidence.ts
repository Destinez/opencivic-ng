import { createHash } from 'node:crypto';
import {
  type AppDb,
  discrepancyFlags,
  observerProfiles,
  referenceRecords,
  submissionReviews,
  submissions,
} from '@opencivic/db';
import { and, eq, inArray } from 'drizzle-orm';
import { reject } from './http';

export function pseudonym(id: string | null, prefix = 'obs') {
  return `${prefix}_${createHash('sha256')
    .update(id ?? 'deleted')
    .digest('hex')
    .slice(0, 12)}`;
}

export async function gatherEvidence(db: AppDb, ids: string[], publishing = false) {
  const rows = await db
    .select({
      flag: discrepancyFlags,
      sheet: submissions,
      reference: referenceRecords,
      trust: observerProfiles.trustLevel,
    })
    .from(discrepancyFlags)
    .innerJoin(submissions, eq(submissions.id, discrepancyFlags.submissionId))
    .leftJoin(referenceRecords, eq(referenceRecords.id, discrepancyFlags.referenceId))
    .leftJoin(observerProfiles, eq(observerProfiles.userId, submissions.observerId))
    .where(and(inArray(discrepancyFlags.id, ids), eq(discrepancyFlags.active, true)));
  if (rows.length !== ids.length || !rows[0])
    reject('conflict', 'Choose current discrepancy flags.', 409);
  const first = rows[0];
  if (
    rows.some(
      ({ flag }) =>
        flag.electionId !== first.flag.electionId ||
        flag.pollingUnitId !== first.flag.pollingUnitId ||
        flag.rule === 'duplicate_image' ||
        flag.severity === 'info',
    )
  )
    reject(
      'validation',
      'A case must concern discrepancy flags for one unit and election. Duplicate-image signals belong in the abuse review.',
    );
  const observers = new Set(rows.map(({ sheet }) => sheet.observerId));
  const reviews = await db
    .select()
    .from(submissionReviews)
    .where(
      inArray(submissionReviews.submissionId, [...new Set(rows.map(({ sheet }) => sheet.id))]),
    );
  for (const { sheet, reference, trust } of rows) {
    if (!['approved', 'flagged'].includes(sheet.status) || !sheet.photoPath || !sheet.photoSha256)
      reject(
        'conflict',
        'Each observation needs a reviewed sheet photo before it can support a case.',
        409,
      );
    const decisions = reviews.filter((review) => review.submissionId === sheet.id);
    if (!decisions.some((review) => ['approved', 'flagged'].includes(review.decision)))
      reject('conflict', 'Review the observation before opening a case.', 409);
    if (
      (trust ?? 0) === 0 &&
      (observers.size < 2 ||
        decisions.filter((review) => review.decision === 'approved').length < 2)
    )
      reject(
        'trust_required',
        'An L0 observation needs two approvals and corroboration from another observer.',
        409,
      );
    if (reference && !reference.imagePath)
      reject('conflict', 'The reference photo has expired and cannot support a case.', 409);
    if (publishing && reference && !reference.verifiedBy)
      reject(
        'two_person_rule',
        'Verify each reference independently before confirming the case.',
        403,
      );
  }
  return rows.map(({ flag, sheet, reference, trust }) => ({
    flagId: flag.id,
    electionId: flag.electionId,
    pollingUnitId: flag.pollingUnitId,
    snapshot: {
      flag: {
        id: flag.id,
        rule: flag.rule,
        field: flag.field,
        observed: flag.observed,
        expected: flag.expected,
        severity: flag.severity,
      },
      observation: {
        id: sheet.id,
        observer: pseudonym(sheet.observerId),
        trustLevel: trust ?? 0,
        accreditedVoters: sheet.accreditedVoters,
        rejectedBallots: sheet.rejectedBallots,
        partyVotes: sheet.partyVotes,
        photoSha256: sheet.photoSha256,
        capturedAt: sheet.capturedAt?.toISOString() ?? null,
        receivedAt: sheet.receivedAt.toISOString(),
      },
      reference: reference
        ? {
            id: reference.id,
            source: reference.source,
            sourceUrl: reference.sourceUrl,
            retrievedAt: reference.retrievedAt.toISOString(),
            imageSha256: reference.imageSha256,
            accreditedVoters: reference.accreditedVoters,
            rejectedBallots: reference.rejectedBallots,
            partyVotes: reference.partyVotes,
            transcribedBy: pseudonym(reference.transcribedBy, 'reviewer'),
            verifiedBy: reference.verifiedBy ? pseudonym(reference.verifiedBy, 'reviewer') : null,
            verifiedAt: reference.verifiedAt?.toISOString() ?? null,
            dataset: reference.dataset,
          }
        : null,
      reviews: reviews
        .filter((review) => review.submissionId === sheet.id)
        .map((review) => ({
          reviewer: pseudonym(review.reviewerId, 'reviewer'),
          decision: review.decision,
          reasonCode: review.reasonCode,
          reviewedAt: review.createdAt.toISOString(),
        })),
    },
  }));
}

export type CaseEvidence = Awaited<ReturnType<typeof gatherEvidence>>[number]['snapshot'];
