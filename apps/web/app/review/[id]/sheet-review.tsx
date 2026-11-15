'use client';

import { ContactWarning } from '@/components/contact-warning';

import { SheetComparison } from '@/components/sheet-comparison';
import { formatWhen } from '@/lib/format';
import { jsonRequest, request } from '@/lib/request';
import type { ReviewDetail, SessionUser } from '@/lib/types';
import { useCallback, useEffect, useState } from 'react';
import { OpenCaseForm } from './open-case-form';
import { ReferenceForm } from './reference-form';

export function SheetReview({ id }: { id: string }) {
  const [detail, setDetail] = useState<ReviewDetail>();
  const [user, setUser] = useState<SessionUser>();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [referenceId, setReferenceId] = useState('');
  const [note, setNote] = useState('');
  const [reasonCode, setReasonCode] = useState('document_mismatch');
  const load = useCallback(async () => {
    const [data, account] = await Promise.all([
      request<ReviewDetail>(`/v1/review/submissions/${id}`),
      request<SessionUser>('/v1/auth/me'),
    ]);
    setDetail(data);
    setUser(account);
  }, [id]);
  useEffect(() => {
    void load().catch((cause: Error) => setError(cause.message));
  }, [load]);
  async function act(path: string, init: RequestInit, success: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await request(path, init);
      await load();
      setMessage(success);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const reference =
    detail?.references.find((record) => record.id === referenceId) ?? detail?.references[0];
  const row = detail?.submission;
  return (
    <>
      {error && (
        <p className="alert" role="alert" id="review-error">
          {error}
        </p>
      )}
      <output aria-live="polite">
        {message || (!detail && !error ? 'Loading the sheet…' : '')}
      </output>
      {detail && row && user && (
        <>
          <section className="card">
            <h2>{row.pollingUnit.name}</h2>
            <p className="badge sample">{row.pollingUnit.datasetNotice}</p>
            <p>
              {row.pollingUnit.code} · {row.pollingUnit.lgaName}, {row.pollingUnit.stateName}
            </p>
            <p>
              Observer: {row.observer?.name ?? 'Deleted account'} · Trust L{detail.trustLevel}
            </p>
            <p>
              Captured on device: {row.capturedAt ? formatWhen(row.capturedAt) : 'Not recorded'}
              <br />
              Received by server: {formatWhen(row.receivedAt)}
            </p>
            <p>
              Status: <strong>{row.status.replaceAll('_', ' ')}</strong>.{' '}
              {detail.trustLevel === 0
                ? 'Two independent approvals required.'
                : 'One independent approval required.'}
            </p>
            {row.claimedUntil && <p>Claim expires {formatWhen(row.claimedUntil)}.</p>}
            {!detail.reviews.some((review) => review.reviewerId === user.id) &&
              ['pending', 'in_review', 'flagged', 'rejected'].includes(row.status) &&
              row.observer?.id !== user.id &&
              row.claimedBy !== user.id && (
                <button
                  type="button"
                  disabled={busy || Boolean(row.claimedBy)}
                  onClick={() =>
                    void act(
                      `/v1/review/submissions/${id}/claim`,
                      { method: 'POST' },
                      'Claim saved for ten minutes.',
                    )
                  }
                >
                  Claim this sheet
                </button>
              )}
          </section>
          <section className="card outbox">
            <h2>Sheet comparison</h2>
            {detail.references.length > 1 && (
              <div className="field">
                <label htmlFor="reference-choice">Reference record</label>
                <select
                  id="reference-choice"
                  value={reference?.id}
                  onChange={(event) => setReferenceId(event.target.value)}
                >
                  {detail.references.map((record) => (
                    <option key={record.id} value={record.id}>
                      {record.source} · {formatWhen(record.retrievedAt)} ·{' '}
                      {record.verifiedBy ? 'verified' : 'unverified'}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <SheetComparison
              observed={row}
              reference={reference}
              observerImage={row.hasPhoto ? `/backend/v1/submissions/${id}/photo` : undefined}
              referenceImage={reference ? `/backend${reference.imageUrl}` : undefined}
            />
            {reference && (
              <>
                <p>{reference.notice}</p>
                <p>
                  <a href={reference.sourceUrl} target="_blank" rel="noreferrer">
                    Source record
                  </a>{' '}
                  · Retrieved {formatWhen(reference.retrievedAt)}
                </p>
                <p className="hash">SHA-256: {reference.imageSha256}</p>
                <p>
                  Transcribed by {reference.transcribedBy}.{' '}
                  {reference.verifiedBy
                    ? `Verified independently by ${reference.verifiedBy}.`
                    : 'Awaiting independent verification.'}
                </p>
                {!reference.verifiedBy && reference.transcribedBy !== user.id && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        `/v1/references/${reference.id}/verify`,
                        { method: 'PATCH' },
                        'Reference verified independently.',
                      )
                    }
                  >
                    Verify reference transcription
                  </button>
                )}
              </>
            )}
            <h3>Checks to investigate</h3>
            {detail.flags.length ? (
              <ul>
                {detail.flags.map((flag) => (
                  <li key={flag.id}>
                    <strong>{flag.severity}</strong> · {flag.rule.replaceAll('_', ' ')} ·{' '}
                    {flag.field}: {flag.observed} compared with {flag.expected}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No current discrepancy flags.</p>
            )}
          </section>
          <details className="card outbox">
            <summary>Attach a reference record</summary>
            <ReferenceForm
              row={row}
              busy={busy}
              onSave={(form) =>
                act(
                  '/v1/references',
                  { method: 'POST', body: form },
                  'Reference attached. A different reviewer must verify it.',
                )
              }
            />
          </details>
          {row.claimedBy === user.id && row.status === 'in_review' && (
            <section className="card outbox">
              <h2>Your decision</h2>
              <form
                aria-describedby={error ? 'review-error' : undefined}
                onSubmit={(event) => {
                  event.preventDefault();
                  const submitter = (event.nativeEvent as SubmitEvent)
                    .submitter as HTMLButtonElement | null;
                  const decision = submitter?.value ?? 'approved';
                  void act(
                    `/v1/review/submissions/${id}`,
                    jsonRequest({
                      decision,
                      reasonCode: decision === 'approved' ? 'checked' : reasonCode,
                      note,
                    }),
                    'Decision recorded. The status above shows whether another review is required.',
                  );
                }}
              >
                <div className="field">
                  <label htmlFor="decision-reason">Reason for a flag or rejection</label>
                  <select
                    id="decision-reason"
                    value={reasonCode}
                    onChange={(event) => setReasonCode(event.target.value)}
                  >
                    <option value="document_mismatch">Documents disagree</option>
                    <option value="unreadable">Sheet unreadable</option>
                    <option value="missing_photo">Photo missing</option>
                    <option value="fabrication">Fabricated evidence</option>
                    <option value="personal_data">Faces or personal information</option>
                    <option value="other">Other reason</option>
                  </select>
                </div>
                <div className="field">
                  <ContactWarning text={note} />
                  <label htmlFor="decision-note">Decision note</label>
                  <textarea
                    id="decision-note"
                    maxLength={500}
                    value={note}
                    aria-describedby="decision-help"
                    onChange={(event) => setNote(event.target.value)}
                  />
                  <p id="decision-help">
                    A flag or rejection needs at least eight characters. Keep names, phone numbers
                    and email addresses out of notes.
                  </p>
                </div>
                <div className="actions">
                  <button type="submit" value="approved" disabled={busy}>
                    Approve sheet
                  </button>
                  <button type="submit" value="flagged" disabled={busy}>
                    Discrepancy likely
                  </button>
                  <button type="submit" value="rejected" className="danger" disabled={busy}>
                    Reject sheet
                  </button>
                </div>
              </form>
            </section>
          )}
          <OpenCaseForm detail={detail} />
          <section className="card outbox">
            <h2>Review history</h2>
            {detail.reviews.length ? (
              <ol>
                {detail.reviews.map((review) => (
                  <li key={review.id}>
                    {review.decision} · {review.reviewerId} · {formatWhen(review.createdAt)}
                    <p>{review.note}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No decisions yet.</p>
            )}
          </section>
        </>
      )}
    </>
  );
}
