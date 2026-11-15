'use client';

import { message as translatedMessage } from '@/lib/i18n/messages';

import { ContactWarning } from '@/components/contact-warning';

import { SheetComparison } from '@/components/sheet-comparison';
import { formatWhen } from '@/lib/format';
import { jsonRequest, request } from '@/lib/request';
import type { CaseRecord } from '@/lib/types';
import { useCallback, useEffect, useState } from 'react';

export function CaseView({ id }: { id: string }) {
  const [data, setData] = useState<CaseRecord>();
  const [note, setNote] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setData(await request<CaseRecord>(`/v1/cases/${id}`)), [id]);
  useEffect(() => {
    void load().catch((cause: Error) => setError(cause.message));
  }, [load]);
  async function change(path: string, body: unknown, message: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await request(path, jsonRequest(body));
      await load();
      setMessage(message);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const references = [
    ...new Map(
      data?.evidence
        .filter((item) => item.reference)
        .map((item) => [item.reference?.id, item.reference]) ?? [],
    ).values(),
  ];
  return (
    <>
      {error && (
        <p className="alert" role="alert" id="case-error">
          {error}
        </p>
      )}
      <output aria-live="polite">{message || (!data && !error ? 'Loading case…' : '')}</output>
      {data && (
        <>
          <section className="card">
            <h2>{data.pollingUnit.name}</h2>
            <p className="badge sample">{data.pollingUnit.datasetNotice}</p>
            <p>
              {data.pollingUnit.code} · {data.pollingUnit.lga.name}, {data.pollingUnit.state.name}
            </p>
            <p>
              <span className="badge warn">{data.severity}</span> Status:{' '}
              <strong>{data.status.replaceAll('_', ' ')}</strong>
            </p>
            <p>{data.summary}</p>
            <p className="hash">Case {id}</p>
            <p>
              Opened {formatWhen(data.createdAt)} by {data.openedBy}.{' '}
              {data.confirmedBy
                ? `Confirmed independently by ${data.confirmedBy}.`
                : 'Not yet independently confirmed.'}
            </p>
            {data.publishedAt && <p>Published {formatWhen(data.publishedAt)}.</p>}
            {data.retractionPending && (
              <p className="alert">Retraction requested. A second admin must check it.</p>
            )}
            {data.retractionNote && <p className="alert">Retraction note: {data.retractionNote}</p>}
          </section>
          <section className="card outbox">
            <h2>Document differences</h2>
            {[
              ...new Map(
                data.evidence.map((item) => [
                  `${item.observation.id}:${item.reference?.id ?? ''}`,
                  item,
                ]),
              ).values(),
            ].map((item) => (
              <SheetComparison
                key={`${item.observation.id}:${item.reference?.id ?? ''}`}
                observed={item.observation}
                reference={item.reference ?? undefined}
                observerImage={`/backend/v1/cases/${id}/images/observer/${item.observation.id}`}
                referenceImage={
                  item.reference
                    ? `/backend/v1/cases/${id}/images/reference/${item.reference.id}`
                    : undefined
                }
              />
            ))}
            <ul>
              {data.evidence.map((item) => (
                <li key={item.flag.id}>
                  {item.flag.rule.replaceAll('_', ' ')} · {item.flag.field}: {item.flag.observed}{' '}
                  compared with {item.flag.expected}. Observer {item.observation.observer}.
                </li>
              ))}
            </ul>
          </section>
          <section className="card outbox">
            <h2>Reference provenance</h2>
            <p>
              <a className="button" href={`/backend/v1/cases/${id}/evidence-pack`}>
                {translatedMessage('evidencePack')}
              </a>
            </p>
            {references.length ? (
              references.map(
                (reference) =>
                  reference && (
                    <article key={reference.id}>
                      <h3>
                        {reference.dataset === 'sample'
                          ? 'SAMPLE — fictional reference'
                          : 'Manually attached reference'}
                      </h3>
                      <p>
                        <a href={reference.sourceUrl} target="_blank" rel="noreferrer">
                          Source record
                        </a>{' '}
                        · Retrieved {formatWhen(reference.retrievedAt)}
                      </p>
                      <p>
                        Transcribed by {reference.transcribedBy};{' '}
                        {reference.verifiedBy
                          ? `verified by ${reference.verifiedBy}`
                          : 'awaiting independent verification'}
                        .
                      </p>
                      <p className="hash">SHA-256: {reference.imageSha256}</p>
                    </article>
                  ),
              )
            ) : (
              <p>This case concerns checks within observer records; no reference is attached.</p>
            )}
          </section>
          {(data.permissions.investigate ||
            data.permissions.resolve ||
            data.permissions.retract) && (
            <section className="card outbox">
              <h2>Case decision</h2>
              <form
                aria-describedby={error ? 'case-error' : undefined}
                onSubmit={(event) => {
                  event.preventDefault();
                  const to = (
                    (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
                  )?.value;
                  if (to)
                    void change(`/v1/cases/${id}/transition`, { to, note }, 'Case decision saved.');
                }}
              >
                <div className="field">
                  <ContactWarning text={note} />
                  <label htmlFor="case-note">Decision note</label>
                  <textarea
                    id="case-note"
                    required
                    minLength={8}
                    maxLength={1000}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    aria-describedby="case-note-help"
                  />
                  <p id="case-note-help">
                    Explain the evidence. This note appears in the case history if the case is
                    published. Do not include anyone’s contact details.
                  </p>
                </div>
                <div className="actions">
                  {data.permissions.investigate && (
                    <button type="submit" disabled={busy} value="under_investigation">
                      Start investigation
                    </button>
                  )}
                  {data.permissions.confirm && (
                    <button type="submit" disabled={busy} value="confirmed">
                      Confirm and publish
                    </button>
                  )}
                  {data.permissions.resolve && (
                    <>
                      <button type="submit" disabled={busy} value="explained">
                        Explain difference
                      </button>
                      <button type="submit" disabled={busy} className="danger" value="dismissed">
                        Dismiss case
                      </button>
                    </>
                  )}
                  {data.permissions.retract && (
                    <button type="submit" disabled={busy} className="danger" value="retracted">
                      {data.retractionPending ? 'Confirm retraction' : 'Request retraction'}
                    </button>
                  )}
                </div>
              </form>
            </section>
          )}
          <section className="card outbox">
            <h2>Case history</h2>
            <ol>
              {data.history.map((event) => (
                <li key={event.id}>
                  <p>
                    <strong>{event.action.replace('case.', '').replaceAll('_', ' ')}</strong> ·{' '}
                    {formatWhen(event.at)} · {event.actor}
                  </p>
                  {event.note && <p>{event.note}</p>}
                  <p className="hash">Audit hash: {event.hash}</p>
                </li>
              ))}
            </ol>
          </section>
          {data.permissions.comment && (
            <section className="card outbox">
              <h2>Review and desk notes</h2>
              <p>These notes are visible to review and desk accounts.</p>
              <ul>
                {data.comments.map((item) => (
                  <li key={item.id}>
                    {item.body} · {item.author} · {formatWhen(item.at)}
                  </li>
                ))}
              </ul>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void change(`/v1/cases/${id}/comments`, { body: comment }, 'Comment saved.');
                }}
              >
                <div className="field">
                  <label htmlFor="case-comment">Comment</label>
                  <textarea
                    id="case-comment"
                    required
                    maxLength={2000}
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                  />
                </div>
                <button type="submit" disabled={busy}>
                  Add comment
                </button>
              </form>
            </section>
          )}
        </>
      )}
    </>
  );
}
