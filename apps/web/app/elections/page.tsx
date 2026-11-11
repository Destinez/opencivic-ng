import { ApiError, apiGet } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { ElectionSummary } from '@/lib/types';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Elections' };

export default async function ElectionsPage() {
  try {
    const payload = await apiGet<{ data: ElectionSummary[] }>('/v1/elections');
    return (
      <>
        <p className="kicker">Guidance</p>
        <h1>Elections</h1>
        <p className="lede">
          Dates that came from INEC are linked. The demonstration poll is fictional and is the only
          election that accepts observations in this demo.
        </p>
        <div className="grid-2">
          {payload.data.map((election) => (
            <article className="card" key={election.id}>
              <p>
                {election.fictional ? <span className="badge fictional">Fictional</span> : null}
                {!election.acceptsSubmissions ? (
                  <span className="badge">Information only</span>
                ) : null}
              </p>
              <h2>
                <Link href={`/elections/${election.slug}`}>{election.name}</Link>
              </h2>
              <p>{election.heldOn ? formatDate(election.heldOn) : 'No single date'}</p>
              <p>{election.summary}</p>
            </article>
          ))}
        </div>
      </>
    );
  } catch (error) {
    const message = error instanceof ApiError ? error.message : 'The data service is unavailable.';
    return (
      <>
        <h1>Elections</h1>
        <p className="alert" role="alert">
          {message}
        </p>
      </>
    );
  }
}
