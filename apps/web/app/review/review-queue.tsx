'use client';

import { PartyFigures } from '@/components/party-figures';
import { formatWhen } from '@/lib/format';
import type { SessionUser, SubmissionCard } from '@/lib/types';
import { useCallback, useEffect, useId, useState } from 'react';

async function read<T>(path: string, init?: RequestInit) {
  const response = await fetch(`/backend${path}`, { ...init, credentials: 'include' });
  const data = (await response.json().catch(() => ({}))) as T;
  return { ok: response.ok, status: response.status, data };
}

export function ReviewQueue() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState<SubmissionCard[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextStatus: string) => {
    const result = await read<{ data: SubmissionCard[]; error?: { message: string } }>(
      `/v1/review/submissions?status=${nextStatus}`,
    );
    if (!result.ok) {
      setError(result.data.error?.message ?? 'The queue did not load.');
      setRows([]);
      return;
    }
    setError(null);
    setRows(result.data.data);
  }, []);

  useEffect(() => {
    void read<SessionUser>('/v1/auth/me').then((result) => {
      setUser(result.ok ? result.data : null);
      if (result.ok && result.data.role !== 'observer') void load('pending');
    });
  }, [load]);

  async function decide(id: string, decision: 'approved' | 'flagged', note: string) {
    setMessage(null);
    const result = await read<{ error?: { message: string } }>(`/v1/review/submissions/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision, note }),
    });
    if (!result.ok) {
      setError(result.data.error?.message ?? 'The decision was not saved.');
      return;
    }
    setMessage(
      decision === 'approved'
        ? 'Approved. It can appear on the unofficial tally.'
        : 'Flagged. It stays off the tally.',
    );
    await load(status);
  }

  if (user === undefined) return <p>Checking your account…</p>;
  if (!user)
    return (
      <p className="card">
        Sign in as a reviewer. Demo: chidi.bello@example.com / reviewer-demo-pass.
      </p>
    );
  if (user.role === 'observer')
    return <p className="card">Observers can file sheets. Review is a different role.</p>;

  return (
    <div>
      <fieldset className="actions">
        <legend className="sr-only">Queue filter</legend>
        {['pending', 'approved', 'flagged'].map((item) => (
          <button
            key={item}
            type="button"
            className={item === status ? undefined : 'secondary'}
            aria-pressed={item === status}
            onClick={() => {
              setStatus(item);
              void load(item);
            }}
          >
            {item}
          </button>
        ))}
      </fieldset>
      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <output className="status">{message}</output> : null}
      {rows.length === 0 ? <p>Nothing in this list.</p> : null}
      <div className="grid-2">
        {rows.map((row) => (
          <article className="card" key={row.id}>
            <h2>{row.pollingUnit.name}</h2>
            <p>
              <span className="badge sample">{row.pollingUnit.datasetNotice}</span>
            </p>
            <p>
              {row.pollingUnit.code} · {row.pollingUnit.wardName}, {row.pollingUnit.lgaName},{' '}
              {row.pollingUnit.stateName}
            </p>
            <p>
              Filed {formatWhen(row.createdAt)} by {row.observer?.name ?? 'Deleted account'}
            </p>
            {row.warnings.map((warning) => (
              <p key={warning}>
                <span className="badge warn">Needs a check</span> {warning}
              </p>
            ))}
            <PartyFigures
              votes={row.partyVotes}
              accredited={row.accreditedVoters}
              rejected={row.rejectedBallots}
            />
            {row.hasPhoto ? (
              <p>
                <img
                  src={`/backend/v1/submissions/${row.id}/photo`}
                  alt={
                    row.photoPlaceholder
                      ? 'Sample placeholder image seeded for the demo. Not a real result sheet.'
                      : 'Photograph supplied by the observer.'
                  }
                  style={{
                    width: '100%',
                    maxHeight: 240,
                    objectFit: 'contain',
                    background: '#fff',
                  }}
                />
                {row.photoPlaceholder ? (
                  <>
                    <br />
                    Sample placeholder image. Not a real result sheet.
                  </>
                ) : null}
              </p>
            ) : (
              <p>No sheet photo.</p>
            )}
            {row.decisionNote ? <p>Note: {row.decisionNote}</p> : null}
            {row.status === 'pending' ? (
              <DecisionForm onDecide={(decision, note) => decide(row.id, decision, note)} />
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}

function DecisionForm({
  onDecide,
}: { onDecide: (decision: 'approved' | 'flagged', note: string) => void }) {
  const [note, setNote] = useState('');
  const noteId = useId();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const decision = submitter?.value === 'flagged' ? 'flagged' : 'approved';
        onDecide(decision, note);
      }}
    >
      <div className="field">
        <label htmlFor={noteId}>Note</label>
        <textarea id={noteId} value={note} onChange={(event) => setNote(event.target.value)} />
      </div>
      <div className="actions">
        <button type="submit" name="decision" value="approved">
          Approve submission
        </button>
        <button type="submit" className="danger" name="decision" value="flagged">
          Flag submission
        </button>
      </div>
    </form>
  );
}
