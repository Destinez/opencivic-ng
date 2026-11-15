import { PartyFigures } from '@/components/party-figures';
import { ApiError, apiGet } from '@/lib/api';
import type { AggregateRow, ElectionSummary } from '@/lib/types';
import { RESULTS_DISCLAIMER } from '@opencivic/shared/labels';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Unofficial tallies' };

type Search = { election?: string; level?: string; parentId?: string };

export default async function ResultsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const election = params.election || 'sample-demonstration-poll';
  const level = params.level === 'lga' || params.level === 'ward' ? params.level : 'state';
  const parentId = params.parentId;

  try {
    const elections = await apiGet<{ data: ElectionSummary[] }>('/v1/elections');
    const query = new URLSearchParams({ election, level });
    if (parentId && level !== 'state') query.set('parentId', parentId);
    const aggregate = await apiGet<{
      disclaimer: string;
      coverageNote: string;
      election: { name: string; fictional: boolean; acceptsSubmissions: boolean; notice: string };
      rows: AggregateRow[];
    }>(`/v1/aggregates?${query.toString()}`);
    const current = elections.data.find((item) => item.slug === election);

    return (
      <>
        <p className="kicker">Crowdsourced</p>
        <h1>Unofficial observer tally</h1>
        <p className="lede">{RESULTS_DISCLAIMER}</p>
        <p>{aggregate.election.notice}</p>
        {!aggregate.election.acceptsSubmissions ? (
          <p className="card">
            OpenCivic is not collecting observations for this election. The public numbers stay at
            zero unless a deployment turns collection on. The demonstration poll is separate.
          </p>
        ) : null}
        <div className="actions">
          {elections.data.map((item) => (
            <Link
              key={item.slug}
              className={item.slug === election ? 'button' : 'button secondary'}
              href={`/results?election=${item.slug}`}
              aria-current={item.slug === election ? 'page' : undefined}
            >
              {item.name}
            </Link>
          ))}
        </div>
        <div className="actions">
          <Link
            className={level === 'state' ? 'button' : 'button secondary'}
            href={`/results?election=${election}&level=state`}
          >
            States
          </Link>
          {level !== 'state' ? (
            <Link className="button secondary" href={`/results?election=${election}&level=state`}>
              Back to states
            </Link>
          ) : null}
        </div>
        <p>{aggregate.coverageNote}</p>
        {current?.fictional ? (
          <p>
            <span className="badge fictional">Fictional demonstration</span>
          </p>
        ) : null}
        <div className="grid-2">
          {aggregate.rows.map((row) => (
            <article className="card" key={row.id}>
              <h2>{row.name}</h2>
              <p>
                <strong>
                  {row.pollingUnitsReporting} of {row.pollingUnitsTotal}
                </strong>{' '}
                polling units in this database have an approved unofficial report.
              </p>
              {level === 'state' ? (
                <p>
                  <Link href={`/results?election=${election}&level=lga&parentId=${row.id}`}>
                    Local governments in {row.name}
                  </Link>
                </p>
              ) : null}
              {level === 'lga' ? (
                <p>
                  <Link href={`/results?election=${election}&level=ward&parentId=${row.id}`}>
                    Wards in {row.name}
                  </Link>
                </p>
              ) : null}
              <PartyFigures
                votes={row.votes}
                accredited={row.accreditedVoters}
                rejected={row.rejectedBallots}
              />
            </article>
          ))}
        </div>
      </>
    );
  } catch (error) {
    const message = error instanceof ApiError ? error.message : 'The data service is unavailable.';
    return (
      <>
        <h1>Unofficial observer tally</h1>
        <p className="alert" role="alert">
          {message}
        </p>
      </>
    );
  }
}
