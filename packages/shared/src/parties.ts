/** Alphabetical by code. This is a data-entry list, not a ballot and not a ranking. */
export const PARTIES = [
  { code: 'ADC', name: 'African Democratic Congress' },
  { code: 'APC', name: 'All Progressives Congress' },
  { code: 'APGA', name: 'All Progressives Grand Alliance' },
  { code: 'LP', name: 'Labour Party' },
  { code: 'NNPP', name: 'New Nigeria Peoples Party' },
  { code: 'PDP', name: 'Peoples Democratic Party' },
  { code: 'SDP', name: 'Social Democratic Party' },
  { code: 'YPP', name: 'Young Progressives Party' },
] as const;

export type PartyCode = (typeof PARTIES)[number]['code'];

export const PARTY_CODES = PARTIES.map((party) => party.code);

export type PartyVotes = Record<PartyCode, number> & { others: number };

export function emptyVotes(): PartyVotes {
  return {
    ADC: 0,
    APC: 0,
    APGA: 0,
    LP: 0,
    NNPP: 0,
    PDP: 0,
    SDP: 0,
    YPP: 0,
    others: 0,
  };
}

export const VOTE_KEYS = [...PARTY_CODES, 'others'] as const;

export function sumVotes(rows: PartyVotes[]): PartyVotes {
  const total = emptyVotes();
  for (const row of rows) {
    for (const key of VOTE_KEYS) {
      total[key] += row[key] ?? 0;
    }
  }
  return total;
}
