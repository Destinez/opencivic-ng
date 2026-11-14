import { PARTY_CODES, type PartyVotes } from '@opencivic/shared/parties';

type Figures = { accreditedVoters: number; rejectedBallots: number; partyVotes: PartyVotes };
export function SheetComparison({
  observed,
  reference,
  observerImage,
  referenceImage,
}: { observed: Figures; reference?: Figures; observerImage?: string; referenceImage?: string }) {
  const fields = reference
    ? [
        {
          name: 'Accredited voters',
          observed: observed.accreditedVoters,
          expected: reference.accreditedVoters,
        },
        {
          name: 'Rejected ballots',
          observed: observed.rejectedBallots,
          expected: reference.rejectedBallots,
        },
        ...[...PARTY_CODES, 'others' as const].map((party) => ({
          name: party,
          observed: observed.partyVotes[party],
          expected: reference.partyVotes[party],
        })),
      ]
    : [];
  return (
    <>
      <div className="grid-2 sheet-images">
        <figure>
          <figcaption>Observer sheet</figcaption>
          {observerImage ? (
            <img src={observerImage} alt="Result sheet supplied by the observer" />
          ) : (
            <p>No photo has arrived.</p>
          )}
        </figure>
        <figure>
          <figcaption>Reference sheet</figcaption>
          {referenceImage ? (
            <img
              src={referenceImage}
              alt="Reference result sheet; check the source and dataset notice below"
            />
          ) : (
            <p>No reference attached.</p>
          )}
        </figure>
      </div>
      {reference && (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The scrollable table must be reachable with a keyboard.
        <section className="table-scroll" tabIndex={0} aria-label="Field comparison">
          <table className="data-table">
            <caption>Figures on each document</caption>
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Observer</th>
                <th scope="col">Reference</th>
                <th scope="col">Check</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => (
                <tr key={field.name}>
                  <th scope="row">{field.name}</th>
                  <td>{field.observed}</td>
                  <td>{field.expected}</td>
                  <td>
                    {field.observed === field.expected
                      ? 'Matches'
                      : `⚠ Differs by ${Math.abs(field.observed - field.expected)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
