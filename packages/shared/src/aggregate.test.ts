import { describe, expect, it } from 'vitest';
import {
  type ApprovedObservation,
  type UnitLocation,
  rollup,
  selectLatestPerPollingUnit,
} from './aggregate';
import { emptyVotes } from './parties';

function votes(partial: Partial<ReturnType<typeof emptyVotes>>) {
  return { ...emptyVotes(), ...partial };
}

const locations: UnitLocation[] = [
  {
    pollingUnitId: 'pu-1',
    stateId: 'lagos',
    stateName: 'Lagos',
    lgaId: 'ikeja',
    lgaName: 'Ikeja',
    wardId: 'gra',
    wardName: 'Ikeja GRA',
  },
  {
    pollingUnitId: 'pu-2',
    stateId: 'lagos',
    stateName: 'Lagos',
    lgaId: 'ikeja',
    lgaName: 'Ikeja',
    wardId: 'gra',
    wardName: 'Ikeja GRA',
  },
  {
    pollingUnitId: 'pu-3',
    stateId: 'edo',
    stateName: 'Edo',
    lgaId: 'oredo',
    lgaName: 'Oredo',
    wardId: 'ogbe',
    wardName: 'Ogbe',
  },
];

describe('selectLatestPerPollingUnit', () => {
  it('keeps the newest approved observation for a unit', () => {
    const rows: ApprovedObservation[] = [
      {
        pollingUnitId: 'pu-1',
        createdAt: '2027-02-20T10:00:00.000Z',
        accreditedVoters: 1,
        rejectedBallots: 0,
        votes: votes({ APC: 1 }),
      },
      {
        pollingUnitId: 'pu-1',
        createdAt: '2027-02-20T18:00:00.000Z',
        accreditedVoters: 40,
        rejectedBallots: 2,
        votes: votes({ PDP: 20 }),
      },
    ];
    const latest = selectLatestPerPollingUnit(rows);
    expect(latest).toHaveLength(1);
    expect(latest[0]?.accreditedVoters).toBe(40);
    expect(latest[0]?.votes.PDP).toBe(20);
  });
});

describe('rollup', () => {
  it('sums newest observations and still lists places with no report', () => {
    const approved: ApprovedObservation[] = [
      {
        pollingUnitId: 'pu-1',
        createdAt: '2027-02-20T10:00:00.000Z',
        accreditedVoters: 5,
        rejectedBallots: 0,
        votes: votes({ APC: 5 }),
      },
      {
        pollingUnitId: 'pu-1',
        createdAt: '2027-02-20T12:00:00.000Z',
        accreditedVoters: 30,
        rejectedBallots: 1,
        votes: votes({ APC: 10, PDP: 12 }),
      },
    ];
    const states = rollup({ locations, approved, level: 'state' });
    const lagos = states.find((row) => row.id === 'lagos');
    const edo = states.find((row) => row.id === 'edo');
    expect(lagos).toMatchObject({
      pollingUnitsTotal: 2,
      pollingUnitsReporting: 1,
      accreditedVoters: 30,
      rejectedBallots: 1,
    });
    expect(lagos?.votes.APC).toBe(10);
    expect(lagos?.votes.PDP).toBe(12);
    expect(edo).toMatchObject({
      pollingUnitsTotal: 1,
      pollingUnitsReporting: 0,
      accreditedVoters: 0,
    });
  });

  it('filters local governments by state', () => {
    const rows = rollup({ locations, approved: [], level: 'lga', parentId: 'lagos' });
    expect(rows.map((row) => row.name)).toEqual(['Ikeja']);
  });
});
