import { PARTY_CODES, type PartyVotes } from './parties';

export type Severity = 'info' | 'warn' | 'critical';
export type Sheet = {
  id: string;
  pollingUnitId: string;
  accreditedVoters: number;
  rejectedBallots: number;
  partyVotes: Partial<PartyVotes>;
  declaredTotalVotes?: number | null;
  observerId?: string | null;
  approved?: boolean;
  trustLevel?: number;
  photoSha256?: string | null;
  photoPhash?: string | null;
};
export type SheetFlag = {
  rule:
    | 'party_score_mismatch'
    | 'accredited_mismatch'
    | 'overvote'
    | 'arith_inconsistent'
    | 'observer_conflict'
    | 'registered_exceeded'
    | 'duplicate_image';
  field: string;
  observed: number;
  expected: number;
  severity: Severity;
  referenceId: string | null;
};

const parties = [...PARTY_CODES, 'others'] as const;
export function sheetTotal(sheet: Pick<Sheet, 'partyVotes' | 'rejectedBallots'>) {
  return parties.reduce(
    (sum, party) => sum + (sheet.partyVotes[party] ?? 0),
    sheet.rejectedBallots,
  );
}

export function perceptualDistance(left: string, right: string): number {
  if (![left, right].every((value) => /^[a-f0-9]{16}$/i.test(value)))
    return Number.POSITIVE_INFINITY;
  let bits = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let distance = 0;
  while (bits) {
    distance += 1;
    bits &= bits - 1n;
  }
  return distance;
}

export function sheetMatch({
  submission,
  reference,
  peers = [],
  registeredVoters,
}: {
  submission: Sheet | null;
  reference?: Sheet | null;
  peers?: Sheet[];
  registeredVoters?: number | null;
}): SheetFlag[] {
  if (!submission) return [];
  if (reference && reference.pollingUnitId !== submission.pollingUnitId) {
    throw new Error('Reference must describe the same polling unit.');
  }
  const flags: SheetFlag[] = [];
  const add = (
    rule: SheetFlag['rule'],
    field: string,
    observed: number,
    expected: number,
    severity: Severity,
    referenceId: string | null = null,
  ) => {
    flags.push({ rule, field, observed, expected, severity, referenceId });
  };

  for (const [label, sheet] of [
    ['observer', submission],
    ['reference', reference],
  ] as const) {
    if (!sheet) continue;
    const referenceId = label === 'reference' ? sheet.id : null;
    const total = sheetTotal(sheet);
    if (total > sheet.accreditedVoters)
      add(
        'overvote',
        `${label}.totalVotes`,
        total,
        sheet.accreditedVoters,
        'critical',
        referenceId,
      );
    if (sheet.declaredTotalVotes != null && sheet.declaredTotalVotes !== total) {
      add(
        'arith_inconsistent',
        `${label}.declaredTotalVotes`,
        sheet.declaredTotalVotes,
        total,
        'warn',
        referenceId,
      );
    }
    if (registeredVoters != null && sheet.accreditedVoters > registeredVoters) {
      add(
        'registered_exceeded',
        `${label}.accreditedVoters`,
        sheet.accreditedVoters,
        registeredVoters,
        'critical',
        referenceId,
      );
    }
  }

  if (reference) {
    for (const party of parties) {
      const observed = submission.partyVotes[party] ?? 0;
      const expected = reference.partyVotes[party] ?? 0;
      const delta = Math.abs(observed - expected);
      if (delta > 0)
        add(
          'party_score_mismatch',
          `partyVotes.${party}`,
          observed,
          expected,
          delta >= 10 || delta * 100 >= expected * 5 ? 'critical' : 'warn',
          reference.id,
        );
    }
    if (submission.accreditedVoters !== reference.accreditedVoters) {
      add(
        'accredited_mismatch',
        'accreditedVoters',
        submission.accreditedVoters,
        reference.accreditedVoters,
        'warn',
        reference.id,
      );
    }
    if (submission.rejectedBallots !== reference.rejectedBallots) {
      add(
        'arith_inconsistent',
        'rejectedBallots',
        submission.rejectedBallots,
        reference.rejectedBallots,
        'warn',
        reference.id,
      );
    }
  }

  for (const peer of [...peers].sort((a, b) => a.id.localeCompare(b.id))) {
    if (peer.id === submission.id) continue;
    if (peer.pollingUnitId !== submission.pollingUnitId) {
      const exact = Boolean(submission.photoSha256 && submission.photoSha256 === peer.photoSha256);
      const distance =
        submission.photoPhash && peer.photoPhash
          ? perceptualDistance(submission.photoPhash, peer.photoPhash)
          : Number.POSITIVE_INFINITY;
      if (exact || distance <= 6)
        add('duplicate_image', `image.${peer.id}`, exact ? 0 : distance, 6, 'critical');
      continue;
    }
    if (
      !submission.approved ||
      !peer.approved ||
      !submission.observerId ||
      !peer.observerId ||
      submission.observerId === peer.observerId
    )
      continue;
    const severity =
      Math.max(submission.trustLevel ?? 0, peer.trustLevel ?? 0) >= 2 ? 'critical' : 'warn';
    const fields: Array<[string, number, number]> = [
      ['accreditedVoters', submission.accreditedVoters, peer.accreditedVoters],
      ['rejectedBallots', submission.rejectedBallots, peer.rejectedBallots],
      ...parties.map((party): [string, number, number] => [
        `partyVotes.${party}`,
        submission.partyVotes[party] ?? 0,
        peer.partyVotes[party] ?? 0,
      ]),
    ];
    for (const [field, observed, expected] of fields) {
      if (observed !== expected)
        add('observer_conflict', `${peer.id}.${field}`, observed, expected, severity);
    }
  }
  return flags.sort((a, b) =>
    `${a.rule}:${a.field}:${a.referenceId ?? ''}`.localeCompare(
      `${b.rule}:${b.field}:${b.referenceId ?? ''}`,
    ),
  );
}
