import { describe, expect, it } from 'vitest';
import { emptyVotes } from './parties';
import { type Sheet, perceptualDistance, sheetMatch } from './sheetmatch';

const sheet = (overrides: Partial<Sheet> = {}): Sheet => ({
  id: 'sheet-a',
  pollingUnitId: 'pu-one',
  accreditedVoters: 1000,
  rejectedBallots: 0,
  partyVotes: emptyVotes(),
  observerId: 'observer-a',
  ...overrides,
});
const reference = (votes: number) => sheet({ id: 'reference', partyVotes: { APC: votes } });

describe('Sheet Match rules', () => {
  it('handles no sheet, zero figures, absent party fields, and matching sheets', () => {
    expect(sheetMatch({ submission: null })).toEqual([]);
    expect(
      sheetMatch({
        submission: sheet({ accreditedVoters: 0, partyVotes: {} }),
        reference: sheet({ id: 'reference', accreditedVoters: 0 }),
      }),
    ).toEqual([]);
    expect(sheetMatch({ submission: sheet(), reference: reference(0) })).toEqual([]);
  });
  it.each([
    [201, 200, 'warn'],
    [210, 200, 'critical'],
    [209, 200, 'warn'],
    [21, 20, 'critical'],
    [20, 21, 'warn'],
    [1, 0, 'critical'],
    [0, 1, 'critical'],
  ])('classifies party scores %s and %s as %s', (observed, expected, severity) => {
    const flags = sheetMatch({
      submission: sheet({ partyVotes: { APC: Number(observed) } }),
      reference: reference(Number(expected)),
    });
    expect(flags.find((flag) => flag.rule === 'party_score_mismatch')).toMatchObject({
      field: 'partyVotes.APC',
      observed,
      expected,
      severity,
    });
  });
  it('checks accredited and rejected figures, arithmetic, overvotes, and the register on both sheets', () => {
    const flags = sheetMatch({
      submission: sheet({
        accreditedVoters: 4,
        rejectedBallots: 1,
        partyVotes: { APC: 5 },
        declaredTotalVotes: 7,
      }),
      reference: sheet({
        id: 'reference',
        accreditedVoters: 3,
        partyVotes: { APC: 4 },
        declaredTotalVotes: 5,
      }),
      registeredVoters: 2,
    });
    expect(flags.filter((flag) => flag.rule === 'overvote')).toHaveLength(2);
    expect(flags.filter((flag) => flag.rule === 'registered_exceeded')).toHaveLength(2);
    expect(flags.filter((flag) => flag.rule === 'arith_inconsistent')).toHaveLength(3);
    expect(flags.find((flag) => flag.rule === 'accredited_mismatch')).toMatchObject({
      observed: 4,
      expected: 3,
      severity: 'warn',
    });
    expect(sheetMatch({ submission: sheet(), registeredVoters: null })).toEqual([]);
  });
  it('requires different approved observers for conflicts and escalates trusted evidence', () => {
    const submission = sheet({ approved: true });
    const peer = sheet({
      id: 'peer',
      observerId: 'observer-b',
      approved: true,
      partyVotes: { APC: 2 },
    });
    expect(sheetMatch({ submission, peers: [peer] })[0]).toMatchObject({
      rule: 'observer_conflict',
      severity: 'warn',
    });
    expect(sheetMatch({ submission, peers: [{ ...peer, trustLevel: 2 }] })[0]?.severity).toBe(
      'critical',
    );
    expect(sheetMatch({ submission, peers: [{ ...peer, approved: false }] })).toEqual([]);
    expect(sheetMatch({ submission, peers: [{ ...peer, observerId: 'observer-a' }] })).toEqual([]);
  });
  it('finds exact and perceptual duplicates only across different polling units', () => {
    const submission = sheet({ photoSha256: 'a'.repeat(64), photoPhash: '0000000000000000' });
    const peer = sheet({ id: 'peer', pollingUnitId: 'pu-two', photoSha256: 'a'.repeat(64) });
    expect(sheetMatch({ submission, peers: [peer] })[0]?.rule).toBe('duplicate_image');
    expect(sheetMatch({ submission, peers: [{ ...peer, pollingUnitId: 'pu-one' }] })).toEqual([]);
    expect(
      sheetMatch({
        submission,
        peers: [{ ...peer, photoSha256: null, photoPhash: '000000000000003f' }],
      })[0]?.observed,
    ).toBe(6);
    expect(
      sheetMatch({
        submission,
        peers: [{ ...peer, photoSha256: null, photoPhash: '000000000000007f' }],
      }),
    ).toEqual([]);
    expect(perceptualDistance('bad', 'bad')).toBe(Number.POSITIVE_INFINITY);
  });
  it('is deterministic, does not mutate input, and refuses the wrong reference unit', () => {
    const input = Object.freeze(sheet());
    const peers = [sheet({ id: 'b' }), sheet({ id: 'c' })];
    expect(sheetMatch({ submission: input, peers })).toEqual(
      sheetMatch({ submission: input, peers: [...peers].reverse() }),
    );
    expect(() =>
      sheetMatch({ submission: input, reference: sheet({ pollingUnitId: 'other' }) }),
    ).toThrow(/same polling unit/);
  });
});
