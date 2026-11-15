import { ApiError, apiGet } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { ElectionDetail } from '@/lib/types';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

type Params = { slug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  try {
    const payload = await apiGet<{ data: ElectionDetail }>(
      `/v1/elections/${encodeURIComponent(slug)}`,
    );
    return { title: payload.data.name };
  } catch {
    return { title: 'Election' };
  }
}

export default async function ElectionPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  try {
    const payload = await apiGet<{ data: ElectionDetail }>(
      `/v1/elections/${encodeURIComponent(slug)}`,
    );
    const election = payload.data;
    return (
      <article>
        <p className="kicker">
          {election.fictional ? 'Demonstration' : 'From INEC’s public pages'}
        </p>
        <h1>{election.name}</h1>
        <p>
          {election.fictional ? (
            <span className="badge fictional">Fictional demonstration. Not an INEC election.</span>
          ) : null}
          <span className="badge">{election.notice}</span>
        </p>
        <p className="lede">{election.summary}</p>
        <section>
          <h2>Key dates</h2>
          <ol className="place-list">
            {election.dates.map((date) => (
              <li key={date.id} className="card">
                <h3>{date.label}</h3>
                <p>{formatDate(date.occursOn)}</p>
                {date.unverified ? (
                  <p>
                    <span className="badge unverified">Unverified</span>
                  </p>
                ) : null}
                <p>{date.detail}</p>
                <Sources links={date.sources} />
              </li>
            ))}
          </ol>
        </section>
        {election.guidance.map((block) => (
          <section key={block.id} className="card" style={{ marginTop: 14 }}>
            <h2>{block.title}</h2>
            {block.unverified ? (
              <p>
                <span className="badge unverified">Unverified</span>
              </p>
            ) : null}
            <p>{block.body}</p>
            <ul>
              {block.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
            <Sources links={block.sources} />
          </section>
        ))}
      </article>
    );
  } catch (error) {
    if (error instanceof ApiError && error.message.includes('404')) notFound();
    const message = error instanceof ApiError ? error.message : 'The data service is unavailable.';
    return (
      <>
        <h1>Election</h1>
        <p className="alert" role="alert">
          {message}
        </p>
      </>
    );
  }
}

function Sources({ links }: { links: Array<{ label: string; url: string }> }) {
  if (links.length === 0) return null;
  return (
    <p>
      Sources:{' '}
      {links.map((link, index) => (
        <span key={link.url}>
          {index > 0 ? ', ' : null}
          <a href={link.url}>{link.label}</a>
        </span>
      ))}
    </p>
  );
}
