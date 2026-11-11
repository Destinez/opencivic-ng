import { z } from 'zod';
import { PARTY_CODES, type PartyVotes, emptyVotes } from './parties';

const count = z.number().int().nonnegative().max(200_000);

export const partyVotesSchema = z.object({
  ADC: count,
  APC: count,
  APGA: count,
  LP: count,
  NNPP: count,
  PDP: count,
  SDP: count,
  YPP: count,
  others: count,
});

export const submissionSchema = z.object({
  electionId: z.string().trim().min(1).max(80),
  pollingUnitId: z.string().trim().min(1).max(160),
  accreditedVoters: count,
  rejectedBallots: count,
  partyVotes: partyVotesSchema,
  declaration: z.boolean().refine((value) => value, {
    message: 'You need to accept the declaration.',
  }),
});

export type SubmissionInput = z.infer<typeof submissionSchema>;

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(160),
  password: z.string().min(10).max(200),
  ageConfirmed: z.boolean().refine((value) => value, {
    message: 'You need to confirm that you are 18 or older.',
  }),
  consent: z.boolean().refine((value) => value, {
    message: 'You need to consent to the account being stored.',
  }),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(160),
  password: z.string().min(1).max(200),
});

export const decisionSchema = z.object({
  decision: z.enum(['approved', 'flagged']),
  note: z.string().trim().max(500).optional().default(''),
});

export const roleChangeSchema = z.object({
  role: z.enum(['observer', 'reviewer', 'admin']),
});

export function consistencyWarnings(input: {
  accreditedVoters: number;
  rejectedBallots: number;
  partyVotes: PartyVotes;
}): string[] {
  const warnings: string[] = [];
  const accounted =
    PARTY_CODES.reduce((sum, code) => sum + input.partyVotes[code], 0) +
    input.partyVotes.others +
    input.rejectedBallots;
  if (accounted > input.accreditedVoters) {
    warnings.push(
      'Party votes, other votes, and rejected ballots add up to more than accredited voters.',
    );
  }
  if (accounted === 0 && input.accreditedVoters === 0) {
    warnings.push('All figures are zero.');
  }
  return warnings;
}

export function normalizeVotes(value: unknown): PartyVotes {
  const base = emptyVotes();
  if (!value || typeof value !== 'object') return base;
  const parsed = partyVotesSchema.safeParse({ ...base, ...value });
  return parsed.success ? parsed.data : base;
}

function asInt(value: unknown): unknown {
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return value;
}

export function parseSubmissionBody(input: Record<string, unknown>) {
  let votes: unknown = input.partyVotes;
  if (typeof votes === 'string') {
    votes = JSON.parse(votes) as unknown;
  }
  let declaration: unknown = input.declaration;
  if (declaration === 'true') declaration = true;
  if (declaration === 'false') declaration = false;
  return submissionSchema.parse({
    electionId: input.electionId,
    pollingUnitId: input.pollingUnitId,
    accreditedVoters: asInt(input.accreditedVoters),
    rejectedBallots: asInt(input.rejectedBallots),
    partyVotes: votes,
    declaration,
  });
}
