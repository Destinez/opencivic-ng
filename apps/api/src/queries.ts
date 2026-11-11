import type { AppDb } from '@opencivic/db';
import {
  auditEvents,
  electionDates,
  elections,
  guidanceBlocks,
  lgas,
  pollingUnits,
  sessions,
  states,
  submissions,
  users,
  wards,
} from '@opencivic/db';
import {
  type AggregateRow,
  type CoordinateKind,
  DATASET_DISCLAIMER,
  type DatasetKind,
  type GeoLevel,
  RESULTS_DISCLAIMER,
  coordinateNotice,
  datasetNotice,
  normalizeVotes,
  rollup,
} from '@opencivic/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function datasetFields(dataset: string) {
  const kind = (dataset === 'imported' ? 'imported' : 'sample') as DatasetKind;
  return {
    dataset: kind,
    datasetNotice: datasetNotice(kind),
    official: false as const,
  };
}

export async function listStates(db: AppDb) {
  const rows = await db.select().from(states).orderBy(asc(states.name));
  const counts = await db
    .select({
      stateId: lgas.stateId,
      total: sql<number>`cast(count(${pollingUnits.id}) as int)`,
    })
    .from(pollingUnits)
    .innerJoin(wards, eq(wards.id, pollingUnits.wardId))
    .innerJoin(lgas, eq(lgas.id, wards.lgaId))
    .groupBy(lgas.stateId);
  const countByState = new Map(counts.map((row) => [row.stateId, Number(row.total)]));
  return {
    disclaimer: DATASET_DISCLAIMER,
    official: false as const,
    data: rows.map((state) => ({
      id: state.id,
      name: state.name,
      code: state.code,
      latitude: state.latitude,
      longitude: state.longitude,
      pollingUnitCount: countByState.get(state.id) ?? 0,
      ...datasetFields(state.dataset),
    })),
  };
}

export async function listLgas(db: AppDb, stateId: string) {
  const state = await db.select().from(states).where(eq(states.id, stateId));
  const parent = state[0];
  if (!parent) return null;
  const rows = await db
    .select()
    .from(lgas)
    .where(eq(lgas.stateId, stateId))
    .orderBy(asc(lgas.name));
  const counts = await db
    .select({
      lgaId: wards.lgaId,
      total: sql<number>`cast(count(${pollingUnits.id}) as int)`,
    })
    .from(pollingUnits)
    .innerJoin(wards, eq(wards.id, pollingUnits.wardId))
    .groupBy(wards.lgaId);
  const countByLga = new Map(counts.map((row) => [row.lgaId, Number(row.total)]));
  return {
    disclaimer: DATASET_DISCLAIMER,
    official: false as const,
    state: { id: parent.id, name: parent.name, ...datasetFields(parent.dataset) },
    data: rows.map((lga) => ({
      id: lga.id,
      name: lga.name,
      code: lga.code,
      latitude: lga.latitude,
      longitude: lga.longitude,
      pollingUnitCount: countByLga.get(lga.id) ?? 0,
      ...datasetFields(lga.dataset),
    })),
  };
}

export async function listWards(db: AppDb, lgaId: string) {
  const rows = await db
    .select({
      ward: wards,
      lga: lgas,
      state: states,
    })
    .from(wards)
    .innerJoin(lgas, eq(lgas.id, wards.lgaId))
    .innerJoin(states, eq(states.id, lgas.stateId))
    .where(eq(wards.lgaId, lgaId))
    .orderBy(asc(wards.name));
  const first = rows[0];
  if (!first) {
    const lga = await db.select().from(lgas).where(eq(lgas.id, lgaId));
    if (!lga[0]) return null;
  }
  const counts = await db
    .select({
      wardId: pollingUnits.wardId,
      total: sql<number>`cast(count(${pollingUnits.id}) as int)`,
    })
    .from(pollingUnits)
    .groupBy(pollingUnits.wardId);
  const countByWard = new Map(counts.map((row) => [row.wardId, Number(row.total)]));
  const lga = first?.lga ?? (await db.select().from(lgas).where(eq(lgas.id, lgaId)))[0];
  if (!lga) return null;
  const stateRow =
    first?.state ?? (await db.select().from(states).where(eq(states.id, lga.stateId)))[0];
  return {
    disclaimer: DATASET_DISCLAIMER,
    official: false as const,
    lga: { id: lga.id, name: lga.name, stateId: lga.stateId, ...datasetFields(lga.dataset) },
    state: stateRow
      ? { id: stateRow.id, name: stateRow.name, ...datasetFields(stateRow.dataset) }
      : null,
    data: rows.map(({ ward }) => ({
      id: ward.id,
      name: ward.name,
      code: ward.code,
      latitude: ward.latitude,
      longitude: ward.longitude,
      pollingUnitCount: countByWard.get(ward.id) ?? 0,
      ...datasetFields(ward.dataset),
    })),
  };
}

const unitSelection = {
  id: pollingUnits.id,
  name: pollingUnits.name,
  code: pollingUnits.code,
  address: pollingUnits.address,
  dataset: pollingUnits.dataset,
  coordinateKind: pollingUnits.coordinateKind,
  latitude: pollingUnits.latitude,
  longitude: pollingUnits.longitude,
  registeredVoters: pollingUnits.registeredVoters,
  wardId: wards.id,
  wardName: wards.name,
  lgaId: lgas.id,
  lgaName: lgas.name,
  stateId: states.id,
  stateName: states.name,
};

function presentUnit(row: {
  id: string;
  name: string;
  code: string;
  address: string;
  dataset: string;
  coordinateKind: string;
  latitude: number | null;
  longitude: number | null;
  registeredVoters: number | null;
  wardId: string;
  wardName: string;
  lgaId: string;
  lgaName: string;
  stateId: string;
  stateName: string;
}) {
  const coordinateKind = (
    row.coordinateKind === 'imported' || row.coordinateKind === 'missing'
      ? row.coordinateKind
      : 'sample-approximate'
  ) as CoordinateKind;
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    registeredVoters: row.registeredVoters,
    coordinateKind,
    coordinateNotice: coordinateNotice(coordinateKind),
    ward: { id: row.wardId, name: row.wardName },
    lga: { id: row.lgaId, name: row.lgaName },
    state: { id: row.stateId, name: row.stateName },
    ...datasetFields(row.dataset),
  };
}

export async function searchPollingUnits(
  db: AppDb,
  filters: {
    q?: string;
    stateId?: string;
    lgaId?: string;
    wardId?: string;
    limit: number;
    offset: number;
  },
) {
  const conditions = [];
  if (filters.stateId) conditions.push(eq(states.id, filters.stateId));
  if (filters.lgaId) conditions.push(eq(lgas.id, filters.lgaId));
  if (filters.wardId) conditions.push(eq(wards.id, filters.wardId));
  if (filters.q) {
    const pattern = `%${escapeLike(filters.q)}%`;
    conditions.push(
      sql`(
        ${pollingUnits.name} ILIKE ${pattern} ESCAPE '\\'
        OR ${pollingUnits.code} ILIKE ${pattern} ESCAPE '\\'
        OR ${pollingUnits.address} ILIKE ${pattern} ESCAPE '\\'
        OR ${wards.name} ILIKE ${pattern} ESCAPE '\\'
        OR ${lgas.name} ILIKE ${pattern} ESCAPE '\\'
        OR ${states.name} ILIKE ${pattern} ESCAPE '\\'
      )`,
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const base = db
    .select(unitSelection)
    .from(pollingUnits)
    .innerJoin(wards, eq(wards.id, pollingUnits.wardId))
    .innerJoin(lgas, eq(lgas.id, wards.lgaId))
    .innerJoin(states, eq(states.id, lgas.stateId))
    .where(where);
  const rows = await base
    .orderBy(asc(states.name), asc(lgas.name), asc(wards.name), asc(pollingUnits.name))
    .limit(filters.limit)
    .offset(filters.offset);
  const totalRows = await db
    .select({ total: sql<number>`cast(count(*) as int)` })
    .from(pollingUnits)
    .innerJoin(wards, eq(wards.id, pollingUnits.wardId))
    .innerJoin(lgas, eq(lgas.id, wards.lgaId))
    .innerJoin(states, eq(states.id, lgas.stateId))
    .where(where);
  return {
    disclaimer: DATASET_DISCLAIMER,
    official: false as const,
    limit: filters.limit,
    offset: filters.offset,
    total: Number(totalRows[0]?.total ?? 0),
    data: rows.map(presentUnit),
  };
}

export async function getPollingUnit(db: AppDb, id: string) {
  const rows = await db
    .select(unitSelection)
    .from(pollingUnits)
    .innerJoin(wards, eq(wards.id, pollingUnits.wardId))
    .innerJoin(lgas, eq(lgas.id, wards.lgaId))
    .innerJoin(states, eq(states.id, lgas.stateId))
    .where(eq(pollingUnits.id, id));
  const row = rows[0];
  if (!row) return null;
  return { disclaimer: DATASET_DISCLAIMER, official: false as const, data: presentUnit(row) };
}

function electionNotice(fictional: boolean): string {
  return fictional
    ? 'Fictional demonstration. Not an INEC election.'
    : 'Informational. Confirm dates and rules on INEC’s website. This service does not declare a winner.';
}

export async function listElections(db: AppDb) {
  const rows = await db
    .select()
    .from(elections)
    .orderBy(asc(elections.heldOn), asc(elections.name));
  return {
    disclaimer: RESULTS_DISCLAIMER,
    official: false as const,
    data: rows.map((election) => ({
      id: election.id,
      slug: election.slug,
      name: election.name,
      kind: election.kind,
      summary: election.summary,
      fictional: election.fictional,
      acceptsSubmissions: election.acceptsSubmissions,
      heldOn: election.heldOn,
      notice: electionNotice(election.fictional),
      official: false as const,
    })),
  };
}

export async function getElection(db: AppDb, slug: string) {
  const rows = await db.select().from(elections).where(eq(elections.slug, slug));
  const election = rows[0];
  if (!election) return null;
  const dates = await db
    .select()
    .from(electionDates)
    .where(eq(electionDates.electionId, election.id))
    .orderBy(asc(electionDates.sortOrder));
  const guidance = await db
    .select()
    .from(guidanceBlocks)
    .where(eq(guidanceBlocks.electionId, election.id))
    .orderBy(asc(guidanceBlocks.sortOrder));
  return {
    disclaimer: RESULTS_DISCLAIMER,
    official: false as const,
    data: {
      id: election.id,
      slug: election.slug,
      name: election.name,
      kind: election.kind,
      summary: election.summary,
      fictional: election.fictional,
      acceptsSubmissions: election.acceptsSubmissions,
      heldOn: election.heldOn,
      notice: electionNotice(election.fictional),
      official: false as const,
      dates: dates.map((date) => ({
        id: date.id,
        label: date.label,
        occursOn: date.occursOn,
        detail: date.detail,
        unverified: date.unverified,
        sources: date.sources,
      })),
      guidance: guidance.map((block) => ({
        id: block.id,
        topic: block.topic,
        title: block.title,
        body: block.body,
        bullets: block.bullets,
        unverified: block.unverified,
        sources: block.sources,
      })),
    },
  };
}

export async function aggregateElection(
  db: AppDb,
  slug: string,
  level: GeoLevel,
  parentId?: string,
): Promise<
  | { missing: true }
  | {
      missing: false;
      election: {
        id: string;
        slug: string;
        name: string;
        fictional: boolean;
        acceptsSubmissions: boolean;
        notice: string;
      };
      rows: AggregateRow[];
    }
> {
  const found = await db.select().from(elections).where(eq(elections.slug, slug));
  const election = found[0];
  if (!election) return { missing: true };
  const locations = await db
    .select({
      pollingUnitId: pollingUnits.id,
      stateId: states.id,
      stateName: states.name,
      lgaId: lgas.id,
      lgaName: lgas.name,
      wardId: wards.id,
      wardName: wards.name,
    })
    .from(pollingUnits)
    .innerJoin(wards, eq(wards.id, pollingUnits.wardId))
    .innerJoin(lgas, eq(lgas.id, wards.lgaId))
    .innerJoin(states, eq(states.id, lgas.stateId));
  const approved = await db
    .select()
    .from(submissions)
    .where(and(eq(submissions.electionId, election.id), eq(submissions.status, 'approved')));
  const rows = rollup({
    locations,
    approved: approved.map((row) => ({
      pollingUnitId: row.pollingUnitId,
      createdAt: row.createdAt.toISOString(),
      accreditedVoters: row.accreditedVoters,
      rejectedBallots: row.rejectedBallots,
      votes: normalizeVotes(row.partyVotes),
    })),
    level,
    parentId,
  });
  return {
    missing: false,
    election: {
      id: election.id,
      slug: election.slug,
      name: election.name,
      fictional: election.fictional,
      acceptsSubmissions: election.acceptsSubmissions,
      notice: electionNotice(election.fictional),
    },
    rows,
  };
}

export async function recordAudit(
  db: AppDb,
  event: {
    actorId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
    occurredAt?: Date;
  },
) {
  await db.insert(auditEvents).values({
    occurredAt: event.occurredAt ?? new Date(),
    actorId: event.actorId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    metadata: event.metadata ?? {},
  });
}

export async function findUserByEmail(db: AppDb, email: string) {
  const rows = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  return rows[0] ?? null;
}

export async function findUserBySession(db: AppDb, tokenHash: string) {
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, tokenHash));
  return rows[0] ?? null;
}

export type QueueStatus = 'pending' | 'approved' | 'flagged';

export async function listSubmissions(
  db: AppDb,
  filters: { status?: QueueStatus; observerId?: string },
) {
  const conditions = [];
  if (filters.status) conditions.push(eq(submissions.status, filters.status));
  if (filters.observerId) conditions.push(eq(submissions.observerId, filters.observerId));
  const rows = await db
    .select({
      submission: submissions,
      unitName: pollingUnits.name,
      unitCode: pollingUnits.code,
      dataset: pollingUnits.dataset,
      wardName: wards.name,
      lgaName: lgas.name,
      stateName: states.name,
      observerName: users.name,
    })
    .from(submissions)
    .innerJoin(pollingUnits, eq(pollingUnits.id, submissions.pollingUnitId))
    .innerJoin(wards, eq(wards.id, pollingUnits.wardId))
    .innerJoin(lgas, eq(lgas.id, wards.lgaId))
    .innerJoin(states, eq(states.id, lgas.stateId))
    .leftJoin(users, eq(users.id, submissions.observerId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(submissions.createdAt));
  return rows.map((row) => ({
    id: row.submission.id,
    status: row.submission.status,
    createdAt: row.submission.createdAt.toISOString(),
    accreditedVoters: row.submission.accreditedVoters,
    rejectedBallots: row.submission.rejectedBallots,
    partyVotes: normalizeVotes(row.submission.partyVotes),
    warnings: row.submission.consistencyWarnings,
    decisionNote: row.submission.decisionNote,
    hasPhoto: Boolean(row.submission.photoPath),
    photoPlaceholder: row.submission.photoPlaceholder,
    official: false as const,
    pollingUnit: {
      id: row.submission.pollingUnitId,
      name: row.unitName,
      code: row.unitCode,
      wardName: row.wardName,
      lgaName: row.lgaName,
      stateName: row.stateName,
      ...datasetFields(row.dataset),
    },
    observer: row.submission.observerId
      ? { id: row.submission.observerId, name: row.observerName ?? 'Deleted account' }
      : null,
  }));
}

export async function getSubmissionRow(db: AppDb, id: string) {
  const rows = await db.select().from(submissions).where(eq(submissions.id, id));
  return rows[0] ?? null;
}

export async function countActiveAdmins(db: AppDb) {
  const rows = await db
    .select({ total: sql<number>`cast(count(*) as int)` })
    .from(users)
    .where(and(eq(users.role, 'admin'), sql`${users.deletedAt} is null`));
  return Number(rows[0]?.total ?? 0);
}

export async function listUsers(db: AppDb) {
  const rows = await db.select().from(users).orderBy(asc(users.name));
  return rows
    .filter((user) => !user.deletedAt)
    .map((user) => ({ id: user.id, name: user.name, email: user.email, role: user.role }));
}

export async function listAudit(db: AppDb, limit: number) {
  const rows = await db
    .select()
    .from(auditEvents)
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    actorId: row.actorId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: row.metadata,
  }));
}
