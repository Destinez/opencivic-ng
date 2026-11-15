import { type PartyVotes, emptyVotes, sumVotes } from './parties';

export type GeoLevel = 'state' | 'lga' | 'ward';

/** An approved observation. Callers must not pass pending or flagged rows. */
export type ApprovedObservation = {
  pollingUnitId: string;
  createdAt: string;
  accreditedVoters: number;
  rejectedBallots: number;
  votes: PartyVotes;
};

export type UnitLocation = {
  pollingUnitId: string;
  stateId: string;
  stateName: string;
  lgaId: string;
  lgaName: string;
  wardId: string;
  wardName: string;
};

export type AggregateRow = {
  id: string;
  name: string;
  parentId: string | null;
  pollingUnitsTotal: number;
  pollingUnitsReporting: number;
  accreditedVoters: number;
  rejectedBallots: number;
  votes: PartyVotes;
};

export function selectLatestPerPollingUnit(rows: ApprovedObservation[]): ApprovedObservation[] {
  const latest = new Map<string, ApprovedObservation>();
  for (const row of rows) {
    const current = latest.get(row.pollingUnitId);
    if (!current || row.createdAt > current.createdAt) latest.set(row.pollingUnitId, row);
  }
  return [...latest.values()];
}

function groupKey(
  location: UnitLocation,
  level: GeoLevel,
): { id: string; name: string; parentId: string | null } {
  if (level === 'state') return { id: location.stateId, name: location.stateName, parentId: null };
  if (level === 'lga') {
    return { id: location.lgaId, name: location.lgaName, parentId: location.stateId };
  }
  return { id: location.wardId, name: location.wardName, parentId: location.lgaId };
}

function matchesParent(
  location: UnitLocation,
  level: GeoLevel,
  parentId: string | undefined,
): boolean {
  if (level === 'state') return true;
  if (!parentId) return false;
  if (level === 'lga') return location.stateId === parentId;
  return location.lgaId === parentId;
}

/**
 * Coverage is against the loaded dataset, not against every polling unit in Nigeria.
 * When several approved observations exist for one unit, the newest one is used.
 */
export function rollup(args: {
  locations: UnitLocation[];
  approved: ApprovedObservation[];
  level: GeoLevel;
  parentId?: string;
}): AggregateRow[] {
  const latest = new Map(
    selectLatestPerPollingUnit(args.approved).map((row) => [row.pollingUnitId, row]),
  );
  const groups = new Map<string, AggregateRow & { unitIds: string[] }>();

  for (const location of args.locations) {
    if (!matchesParent(location, args.level, args.parentId)) continue;
    const key = groupKey(location, args.level);
    const group = groups.get(key.id) ?? {
      ...key,
      pollingUnitsTotal: 0,
      pollingUnitsReporting: 0,
      accreditedVoters: 0,
      rejectedBallots: 0,
      votes: emptyVotes(),
      unitIds: [],
    };
    group.pollingUnitsTotal += 1;
    group.unitIds.push(location.pollingUnitId);
    groups.set(key.id, group);
  }

  const rows: AggregateRow[] = [];
  for (const group of groups.values()) {
    const observations = group.unitIds
      .map((id) => latest.get(id))
      .filter((row): row is ApprovedObservation => Boolean(row));
    rows.push({
      id: group.id,
      name: group.name,
      parentId: group.parentId,
      pollingUnitsTotal: group.pollingUnitsTotal,
      pollingUnitsReporting: observations.length,
      accreditedVoters: observations.reduce((sum, row) => sum + row.accreditedVoters, 0),
      rejectedBallots: observations.reduce((sum, row) => sum + row.rejectedBallots, 0),
      votes: sumVotes(observations.map((row) => row.votes)),
    });
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
