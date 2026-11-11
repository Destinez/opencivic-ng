import { describe, expect, it } from 'vitest';
import { emptyVotes } from './parties';
import { consistencyWarnings, parseSubmissionBody, submissionSchema } from './validation';

describe('submission validation', () => {
  it('rejects a missing declaration and negative figures', () => {
    const parsed = submissionSchema.safeParse({
      electionId: 'sample',
      pollingUnitId: 'pu-1',
      accreditedVoters: -1,
      rejectedBallots: 0,
      partyVotes: emptyVotes(),
      declaration: false,
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts integer strings from a multipart form', () => {
    const parsed = parseSubmissionBody({
      electionId: 'sample',
      pollingUnitId: 'pu-1',
      accreditedVoters: '12',
      rejectedBallots: '1',
      partyVotes: JSON.stringify({ ...emptyVotes(), APC: 4 }),
      declaration: 'true',
    });
    expect(parsed.accreditedVoters).toBe(12);
    expect(parsed.partyVotes.APC).toBe(4);
  });

  it('warns when the sheet does not add up, and still returns the warning instead of throwing', () => {
    const warnings = consistencyWarnings({
      accreditedVoters: 10,
      rejectedBallots: 2,
      partyVotes: { ...emptyVotes(), APC: 20 },
    });
    expect(warnings[0]).toMatch(/more than accredited/);
  });
});
