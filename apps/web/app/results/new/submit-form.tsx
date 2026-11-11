'use client';

import type { ElectionSummary, PollingUnit, SessionUser } from '@/lib/types';
import { PARTIES, emptyVotes } from '@opencivic/shared/parties';
import { useEffect, useState } from 'react';

type ApiResult<T> = { ok: boolean; status: number; data: T };

async function send<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const response = await fetch(`/backend${path}`, { ...init, credentials: 'include' });
  const data = (await response.json().catch(() => ({}))) as T;
  return { ok: response.ok, status: response.status, data };
}

export function SubmitForm({ initialUnitId }: { initialUnitId?: string }) {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [elections, setElections] = useState<ElectionSummary[]>([]);
  const [electionId, setElectionId] = useState('');
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<PollingUnit[]>([]);
  const [unit, setUnit] = useState<PollingUnit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void send<SessionUser>('/v1/auth/me').then((result) => setUser(result.ok ? result.data : null));
    void send<{ data: ElectionSummary[] }>('/v1/elections').then((result) => {
      if (!result.ok) return;
      const open = result.data.data.filter((item) => item.acceptsSubmissions);
      setElections(open);
      setElectionId(open[0]?.id ?? '');
    });
  }, []);

  useEffect(() => {
    if (!initialUnitId) return;
    void send<{ data: PollingUnit }>(`/v1/polling-units/${encodeURIComponent(initialUnitId)}`).then(
      (result) => {
        if (result.ok) setUnit(result.data.data);
      },
    );
  }, [initialUnitId]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setMatches([]);
      return;
    }
    const handle = setTimeout(() => {
      void send<{ data: PollingUnit[] }>(
        `/v1/polling-units?q=${encodeURIComponent(query.trim())}&limit=8`,
      ).then((result) => {
        if (result.ok) setMatches(result.data.data);
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setDone(null);
    if (!unit) {
      setError('Choose a polling unit.');
      return;
    }
    const form = new FormData(event.currentTarget);
    const votes = emptyVotes();
    for (const party of PARTIES) votes[party.code] = numberFrom(form.get(`vote-${party.code}`));
    votes.others = numberFrom(form.get('vote-others'));
    const body = new FormData();
    body.set('electionId', String(form.get('electionId') ?? ''));
    body.set('pollingUnitId', unit.id);
    body.set('accreditedVoters', String(form.get('accreditedVoters') ?? ''));
    body.set('rejectedBallots', String(form.get('rejectedBallots') ?? '0'));
    body.set('partyVotes', JSON.stringify(votes));
    body.set('declaration', form.get('declaration') ? 'true' : 'false');
    const photo = form.get('photo');
    if (photo instanceof File && photo.size > 0) body.set('photo', photo);
    setPending(true);
    const result = await send<{ error?: { message: string }; warnings?: string[] }>(
      '/v1/submissions',
      {
        method: 'POST',
        body,
      },
    );
    setPending(false);
    if (!result.ok) {
      setError(result.data.error?.message ?? 'The observation was not saved.');
      return;
    }
    setDone(
      result.data.warnings && result.data.warnings.length > 0
        ? `Saved as pending. A reviewer will see this check: ${result.data.warnings.join(' ')}`
        : 'Saved as pending. It is not public until a reviewer approves it, and it stays unofficial after that.',
    );
  }

  if (user === undefined) return <p>Checking your account…</p>;
  if (!user) {
    return (
      <p className="card">
        Sign in as an observer before filing. Demo observer: ada.okonkwo@example.com /
        observer-demo-pass.
      </p>
    );
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <p>
        Signed in as {user.name} ({user.role}).
      </p>
      {elections.length === 0 ? <p>No election is accepting observations.</p> : null}
      <div className="field">
        <label htmlFor="electionId">Election</label>
        <select
          id="electionId"
          name="electionId"
          value={electionId}
          onChange={(event) => setElectionId(event.target.value)}
        >
          {elections.map((election) => (
            <option key={election.id} value={election.id}>
              {election.name}
            </option>
          ))}
        </select>
      </div>
      {elections.find((item) => item.id === electionId)?.fictional ? (
        <p>
          <span className="badge fictional">Fictional demonstration. Not an INEC election.</span>
        </p>
      ) : null}
      <div className="field">
        <label htmlFor="unit-search">Polling unit</label>
        <input
          id="unit-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name or SAMPLE code"
          autoComplete="off"
        />
      </div>
      {matches.length > 0 ? (
        <ul className="place-list">
          {matches.map((match) => (
            <li key={match.id}>
              <button
                type="button"
                className="place secondary"
                onClick={() => {
                  setUnit(match);
                  setMatches([]);
                  setQuery(match.name);
                }}
              >
                <span>
                  {match.name}
                  <br />
                  {match.code}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {unit ? (
        <p>
          <span className="badge sample">{unit.datasetNotice}</span>
          <br />
          Selected: {unit.name} ({unit.code})
        </p>
      ) : null}
      <div className="field">
        <label htmlFor="accreditedVoters">Accredited voters</label>
        <input id="accreditedVoters" name="accreditedVoters" inputMode="numeric" required />
      </div>
      <div className="field">
        <label htmlFor="rejectedBallots">Rejected ballots</label>
        <input
          id="rejectedBallots"
          name="rejectedBallots"
          inputMode="numeric"
          defaultValue="0"
          required
        />
      </div>
      <fieldset>
        <legend>Votes, alphabetical by party code</legend>
        <p>
          This is not ballot order and it is not an endorsement. Put every other party on the last
          line.
        </p>
        {PARTIES.map((party) => (
          <div className="field" key={party.code}>
            <label htmlFor={`vote-${party.code}`}>
              {party.name} ({party.code})
            </label>
            <input
              id={`vote-${party.code}`}
              name={`vote-${party.code}`}
              inputMode="numeric"
              defaultValue="0"
            />
          </div>
        ))}
        <div className="field">
          <label htmlFor="vote-others">Other parties, combined</label>
          <input id="vote-others" name="vote-others" inputMode="numeric" defaultValue="0" />
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor="photo">Photo of the result sheet, optional</label>
        <input id="photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" />
      </div>
      <label className="check">
        <input name="declaration" type="checkbox" required />
        <span>
          I observed these figures myself. I will not upload voter-register pages, faces, or other
          people’s personal data. I understand this publication is unofficial and not an INEC
          result.
        </span>
      </label>
      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}
      {done ? <output className="status">{done}</output> : null}
      <button type="submit" disabled={pending || !electionId}>
        {pending ? 'Saving…' : 'Submit observation'}
      </button>
    </form>
  );
}

function numberFrom(value: FormDataEntryValue | null) {
  const parsed = Number(typeof value === 'string' ? value : 0);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}
