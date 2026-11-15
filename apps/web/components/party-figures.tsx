import { formatNumber } from '@/lib/format';
import { PARTIES, type PartyVotes } from '@opencivic/shared/parties';

export function PartyFigures({
  votes,
  accredited,
  rejected,
}: {
  votes: PartyVotes;
  accredited: number;
  rejected: number;
}) {
  const entries = [
    ...PARTIES.map((party) => ({
      code: party.code,
      name: party.name,
      value: votes[party.code] ?? 0,
    })),
    { code: 'others', name: 'Other parties, combined', value: votes.others ?? 0 },
  ];
  const max = Math.max(1, ...entries.map((entry) => entry.value));
  return (
    <div className="nums">
      <p>
        Accredited voters in these reports: <strong>{formatNumber(accredited)}</strong>
      </p>
      <p>
        Rejected ballots in these reports: <strong>{formatNumber(rejected)}</strong>
      </p>
      <table>
        <caption className="sr-only">
          Votes by party, alphabetical by code. Bar length repeats the number and does not declare a
          winner.
        </caption>
        <thead className="sr-only">
          <tr>
            <th>Party</th>
            <th>Votes</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.code}>
              <td colSpan={2}>
                <div className="vote-row">
                  <span>
                    {entry.name} <span className="sr-only">({entry.code})</span>
                  </span>
                  <strong>{formatNumber(entry.value)}</strong>
                  <span className="vote-bar" aria-hidden="true">
                    <span style={{ width: `${(entry.value / max) * 100}%` }} />
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
