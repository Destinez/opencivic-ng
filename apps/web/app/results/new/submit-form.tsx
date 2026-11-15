'use client';

import { message } from '@/lib/i18n/messages';

import { OutboxPanel } from '@/components/outbox-panel';
import { compressPhoto } from '@/lib/compress-photo';
import { getMeta, saveDraft, setMeta } from '@/lib/outbox';
import type { ElectionSummary, PollingUnit, SessionUser } from '@/lib/types';
import { PARTIES, emptyVotes } from '@opencivic/shared/parties';
import { parseSubmissionBody } from '@opencivic/shared/validation';
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
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const [capturedAt, setCapturedAt] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const result = await send<SessionUser>('/v1/auth/me');
        setUser(result.ok ? result.data : null);
        await setMeta('activeUser', result.ok ? result.data : undefined);
      } catch {
        setUser((await getMeta<SessionUser>('activeUser')) ?? null);
      }
    })();
    void (async () => {
      let data: ElectionSummary[] = [];
      try {
        const result = await send<{ data: ElectionSummary[] }>('/v1/elections');
        if (result.ok) {
          data = result.data.data;
          await setMeta('elections', data);
        } else {
          data = (await getMeta<ElectionSummary[]>('elections')) ?? [];
        }
      } catch {
        data = (await getMeta<ElectionSummary[]>('elections')) ?? [];
      }
      const open = data.filter((item) => item.acceptsSubmissions);
      setElections(open);
      setElectionId(open[0]?.id ?? '');
      setCapturedAt(
        open[0]?.fictional && open[0].heldOn
          ? `${open[0].heldOn}T12:00`
          : new Date().toISOString().slice(0, 16),
      );
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const cached = (await getMeta<PollingUnit[]>('units')) ?? [];
      try {
        if (initialUnitId) {
          const result = await send<{ data: PollingUnit }>(
            `/v1/polling-units/${encodeURIComponent(initialUnitId)}`,
          );
          if (result.ok) {
            setUnit(result.data.data);
            await rememberUnit(result.data.data);
            return;
          }
        }
      } catch {
        /* Use the selected unit stored on this device. */
      }
      setUnit(cached.find((item) => item.id === initialUnitId) ?? cached[0] ?? null);
    })();
  }, [initialUnitId]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setMatches([]);
      return;
    }
    const handle = setTimeout(() => {
      void send<{ data: PollingUnit[] }>(
        `/v1/polling-units?q=${encodeURIComponent(query.trim())}&limit=8`,
      )
        .then(async (result) => {
          if (result.ok) setMatches(result.data.data);
          else {
            const cached = (await getMeta<PollingUnit[]>('units')) ?? [];
            setMatches(
              cached.filter((item) =>
                `${item.name} ${item.code}`.toLowerCase().includes(query.toLowerCase()),
              ),
            );
          }
        })
        .catch(async () => {
          const cached = (await getMeta<PollingUnit[]>('units')) ?? [];
          setMatches(
            cached.filter((item) =>
              `${item.name} ${item.code}`.toLowerCase().includes(query.toLowerCase()),
            ),
          );
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
    body.set('clientId', clientId);
    body.set('capturedAt', new Date(capturedAt).toISOString());
    body.set('electionId', String(form.get('electionId') ?? ''));
    body.set('pollingUnitId', unit.id);
    body.set('accreditedVoters', String(form.get('accreditedVoters') ?? ''));
    body.set('rejectedBallots', String(form.get('rejectedBallots') ?? '0'));
    body.set('partyVotes', JSON.stringify(votes));
    body.set('declaration', form.get('declaration') ? 'true' : 'false');
    const photo = form.get('photo');
    if (!user) return;
    const formElement = event.currentTarget;
    setPending(true);
    try {
      const input = parseSubmissionBody(Object.fromEntries(body));
      if (unit.registeredVoters != null && input.accreditedVoters > unit.registeredVoters)
        throw new Error('Accredited voters cannot exceed the loaded register count.');
      const image = photo instanceof File && photo.size > 0 ? await compressPhoto(photo) : null;
      await saveDraft({
        clientId,
        ownerId: user.id,
        unitLabel: unit.name,
        input,
        photo: image,
        sourceBytes: photo instanceof File ? photo.size : 0,
        createdAt: Date.now(),
        state: 'saved',
        phase: 'figures',
        attempts: 0,
        nextAttemptAt: 0,
      });
      setDone('Saved on this phone. It will send when a connection is available.');
      setClientId(crypto.randomUUID());
      formElement.reset();
      window.dispatchEvent(new Event('opencivic-outbox'));
      if ('serviceWorker' in navigator) {
        void navigator.serviceWorker.ready
          .then((registration) => {
            const background = registration as ServiceWorkerRegistration & {
              sync?: { register: (tag: string) => Promise<void> };
            };
            return background.sync?.register('opencivic-outbox');
          })
          .catch(() => undefined);
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'The observation could not be saved on this device.',
      );
    } finally {
      setPending(false);
    }
  }

  if (user === undefined) return <p>Checking your account…</p>;
  if (!user || user.role !== 'observer') {
    return (
      <p className="card">
        Sign in as an observer before filing. Demo observer: ada.okonkwo@example.com /
        observer-demo-pass.
      </p>
    );
  }

  return (
    <>
      <form
        className="card"
        onSubmit={onSubmit}
        aria-describedby={error ? 'submit-error' : undefined}
      >
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
          <label htmlFor="capturedAt">Capture time</label>
          <input
            id="capturedAt"
            name="capturedAt"
            type="datetime-local"
            value={capturedAt}
            onChange={(event) => setCapturedAt(event.target.value)}
            required
            aria-describedby="capture-help"
          />
          <p id="capture-help" className="muted">
            For this fictional poll, use the time shown on the sample sheet. The server also records
            when it receives the observation.
          </p>
        </div>
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
                    void rememberUnit(match);
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
          <input
            id="accreditedVoters"
            name="accreditedVoters"
            type="number"
            min={0}
            max={200000}
            step={1}
            inputMode="numeric"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="rejectedBallots">Rejected ballots</label>
          <input
            id="rejectedBallots"
            name="rejectedBallots"
            type="number"
            min={0}
            max={200000}
            step={1}
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
                type="number"
                min={0}
                max={200000}
                step={1}
                inputMode="numeric"
                defaultValue="0"
              />
            </div>
          ))}
          <div className="field">
            <label htmlFor="vote-others">Other parties, combined</label>
            <input
              id="vote-others"
              name="vote-others"
              type="number"
              min={0}
              max={200000}
              step={1}
              inputMode="numeric"
              defaultValue="0"
            />
          </div>
        </fieldset>
        {elections.find((election) => election.id === electionId)?.fictional && (
          <p>
            <a href="/samples/observer-sheet.png" download>
              Download the fictional observer sheet for this demo
            </a>
          </p>
        )}
        <div className="field">
          <label htmlFor="photo">Photo of the result sheet, optional</label>
          <input
            id="photo"
            name="photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-describedby="photo-guide"
          />
          <p id="photo-guide">
            Photograph the sheet only, with no faces, names of voters or register pages. Location
            metadata is removed.
          </p>
        </div>
        <label className="check">
          <input name="declaration" type="checkbox" required />
          <span>
            I observed these figures myself. I will not upload voter-register pages, faces, or other
            people’s personal data. I consent to storing these figures and publishing the sheet as
            evidence after independent review. I understand this publication is unofficial and not
            an INEC result.
          </span>
        </label>
        {error ? (
          <p className="alert" role="alert" id="submit-error">
            {error}
          </p>
        ) : null}
        {done ? <output className="status">{done}</output> : null}
        <button type="submit" disabled={pending || !electionId}>
          {message(pending ? 'savingObservation' : 'saveObservation')}
        </button>
      </form>
      <OutboxPanel ownerId={user.id} />
    </>
  );
}

function numberFrom(value: FormDataEntryValue | null) {
  const parsed = Number(typeof value === 'string' ? value : 0);
  return parsed;
}

async function rememberUnit(unit: PollingUnit) {
  const stored = (await getMeta<PollingUnit[]>('units')) ?? [];
  await setMeta('units', [unit, ...stored.filter((item) => item.id !== unit.id)].slice(0, 200));
}
