import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { consistencyWarnings } from '@opencivic/shared';
import { eq, inArray } from 'drizzle-orm';
import type { AppDb } from './client';
import { contentDates, contentElections, contentGuidance } from './content';
import { hashPassword } from './password';
import { sampleSheetPng } from './placeholder-png';
import { DEMO_ACCOUNTS, DEMO_SUBMISSIONS, ELECTION_IDS, buildSampleGeography } from './sample-data';
import {
  auditEvents,
  electionDates,
  elections,
  guidanceBlocks,
  lgas,
  pollingUnits,
  states,
  submissions,
  users,
  wards,
} from './schema';

type SeedEnv = {
  SEED_OBSERVER_EMAIL?: string;
  SEED_OBSERVER_PASSWORD?: string;
  SEED_REVIEWER_EMAIL?: string;
  SEED_REVIEWER_PASSWORD?: string;
  SEED_ADMIN_EMAIL?: string;
  SEED_ADMIN_PASSWORD?: string;
};

function account(env: SeedEnv) {
  return {
    observer: {
      ...DEMO_ACCOUNTS.observer,
      email: env.SEED_OBSERVER_EMAIL || DEMO_ACCOUNTS.observer.email,
      password: env.SEED_OBSERVER_PASSWORD || DEMO_ACCOUNTS.observer.password,
    },
    reviewer: {
      ...DEMO_ACCOUNTS.reviewer,
      email: env.SEED_REVIEWER_EMAIL || DEMO_ACCOUNTS.reviewer.email,
      password: env.SEED_REVIEWER_PASSWORD || DEMO_ACCOUNTS.reviewer.password,
    },
    admin: {
      ...DEMO_ACCOUNTS.admin,
      email: env.SEED_ADMIN_EMAIL || DEMO_ACCOUNTS.admin.email,
      password: env.SEED_ADMIN_PASSWORD || DEMO_ACCOUNTS.admin.password,
    },
  };
}

export async function seedDatabase(
  db: AppDb,
  options: { uploadDir: string; env?: SeedEnv } = { uploadDir: './.data/uploads' },
): Promise<void> {
  const env = options.env ?? process.env;
  const people = account(env);
  const geo = buildSampleGeography();
  const now = new Date('2026-11-01T00:00:00.000Z');

  await db.transaction(async (tx) => {
    for (const state of geo.states) {
      await tx.insert(states).values(state).onConflictDoUpdate({ target: states.id, set: state });
    }
    for (const lga of geo.lgas) {
      await tx.insert(lgas).values(lga).onConflictDoUpdate({ target: lgas.id, set: lga });
    }
    for (const ward of geo.wards) {
      await tx.insert(wards).values(ward).onConflictDoUpdate({ target: wards.id, set: ward });
    }
    for (const unit of geo.units) {
      await tx
        .insert(pollingUnits)
        .values(unit)
        .onConflictDoUpdate({ target: pollingUnits.id, set: unit });
    }

    for (const election of contentElections) {
      await tx
        .insert(elections)
        .values(election)
        .onConflictDoUpdate({ target: elections.id, set: election });
    }

    const electionIds = contentElections.map((election) => election.id);
    await tx.delete(guidanceBlocks).where(inArray(guidanceBlocks.electionId, electionIds));
    await tx.delete(electionDates).where(inArray(electionDates.electionId, electionIds));
    if (contentDates.length > 0) await tx.insert(electionDates).values(contentDates);
    if (contentGuidance.length > 0) await tx.insert(guidanceBlocks).values(contentGuidance);

    for (const person of [people.observer, people.reviewer, people.admin]) {
      const passwordHash = await hashPassword(person.password);
      const row = {
        id: person.id,
        email: person.email.toLowerCase(),
        name: person.name,
        passwordHash,
        role: person.role,
        consentAt: now,
        ageConfirmedAt: now,
        deletedAt: null,
      };
      await tx
        .insert(users)
        .values(row)
        .onConflictDoUpdate({
          target: users.id,
          set: {
            email: row.email,
            name: row.name,
            passwordHash: row.passwordHash,
            role: row.role,
            deletedAt: null,
          },
        });
    }
  });

  mkdirSync(options.uploadDir, { recursive: true });
  const placeholderPath = join(options.uploadDir, 'sample-sheet-placeholder.png');
  writeFileSync(placeholderPath, sampleSheetPng());

  for (const submission of DEMO_SUBMISSIONS) {
    const warnings = consistencyWarnings({
      accreditedVoters: submission.accreditedVoters,
      rejectedBallots: submission.rejectedBallots,
      partyVotes: submission.partyVotes,
    });
    const photoPath = submission.photoPlaceholder ? placeholderPath : null;
    const inserted = await db
      .insert(submissions)
      .values({
        id: submission.id,
        electionId: ELECTION_IDS.sample,
        pollingUnitId: submission.pollingUnitId,
        observerId: people.observer.id,
        accreditedVoters: submission.accreditedVoters,
        rejectedBallots: submission.rejectedBallots,
        partyVotes: submission.partyVotes,
        consistencyWarnings: warnings,
        photoPath,
        photoPlaceholder: submission.photoPlaceholder,
        status: submission.status,
        decisionNote: submission.note,
        decidedBy: submission.status === 'pending' ? null : people.reviewer.id,
        decidedAt: submission.decidedAt ? new Date(submission.decidedAt) : null,
        createdAt: new Date(submission.createdAt),
      })
      .onConflictDoNothing()
      .returning({ id: submissions.id });

    if (inserted.length === 0) continue;

    await db.insert(auditEvents).values({
      occurredAt: new Date(submission.createdAt),
      actorId: people.observer.id,
      action: 'submission.created',
      entityType: 'submission',
      entityId: submission.id,
      metadata: {
        electionId: ELECTION_IDS.sample,
        pollingUnitId: submission.pollingUnitId,
        warnings,
      },
    });
    if (submission.status !== 'pending' && submission.decidedAt) {
      await db.insert(auditEvents).values({
        occurredAt: new Date(submission.decidedAt),
        actorId: people.reviewer.id,
        action: submission.status === 'approved' ? 'submission.approved' : 'submission.flagged',
        entityType: 'submission',
        entityId: submission.id,
        metadata: { note: submission.note },
      });
    }
  }
}

export async function clearSampleData(db: AppDb): Promise<{ pollingUnits: number }> {
  const sampleUnits = await db
    .select({ id: pollingUnits.id })
    .from(pollingUnits)
    .where(eq(pollingUnits.dataset, 'sample'));
  const ids = sampleUnits.map((unit) => unit.id);
  if (ids.length > 0) {
    await db.delete(submissions).where(inArray(submissions.pollingUnitId, ids));
    await db.delete(pollingUnits).where(inArray(pollingUnits.id, ids));
  }
  await db.delete(wards).where(eq(wards.dataset, 'sample'));
  await db.delete(lgas).where(eq(lgas.dataset, 'sample'));
  await db.delete(states).where(eq(states.dataset, 'sample'));
  return { pollingUnits: ids.length };
}
