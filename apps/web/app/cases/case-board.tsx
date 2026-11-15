'use client';

import { formatWhen } from '@/lib/format';
import { request } from '@/lib/request';
import type { AreaRow, ElectionSummary, SessionUser, StateRow } from '@/lib/types';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

const CaseMap = dynamic(() => import('./case-map').then((module) => module.CaseMap), {
  ssr: false,
  loading: () => <p>Loading the map…</p>,
});
export type BoardCase = {
  id: string;
  status: string;
  severity: string;
  summary: string;
  createdAt: string;
  publishedAt: string | null;
  flags: Array<{ id: string; rule: string; field: string; severity: string }>;
  pollingUnit: {
    id: string;
    name: string;
    code: string;
    datasetNotice: string;
    latitude: number | null;
    longitude: number | null;
    state: { id: string; name: string };
    lga: { id: string; name: string };
  };
};

export function CaseBoard() {
  const [elections, setElections] = useState<ElectionSummary[]>([]);
  const [states, setStates] = useState<StateRow[]>([]);
  const [lgas, setLgas] = useState<AreaRow[]>([]);
  const [user, setUser] = useState<SessionUser>();
  const [election, setElection] = useState('sample-demonstration-poll');
  const [state, setState] = useState('');
  const [lga, setLga] = useState('');
  const [severity, setSeverity] = useState('');
  const [status, setStatus] = useState('published');
  const [rows, setRows] = useState<BoardCase[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [map, setMap] = useState(false);
  const [selected, setSelected] = useState('');
  const latest = useRef(0);
  useEffect(() => {
    void Promise.all([
      request<{ data: ElectionSummary[] }>('/v1/elections'),
      request<{ data: StateRow[] }>('/v1/states'),
    ])
      .then(([e, s]) => {
        setElections(e.data);
        setStates(s.data);
      })
      .catch((cause: Error) => setError(cause.message));
    void request<SessionUser>('/v1/auth/me')
      .then(setUser)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    let current = true;
    setLgas([]);
    if (state)
      void request<{ data: AreaRow[] }>(`/v1/states/${state}/lgas`)
        .then((result) => {
          if (current) setLgas(result.data);
        })
        .catch((cause: Error) => {
          if (current) setError(cause.message);
        });
    return () => {
      current = false;
    };
  }, [state]);
  const load = useCallback(
    async (pageToken?: string) => {
      const sequence = ++latest.current;
      setBusy(true);
      setError('');
      const params = new URLSearchParams({ election, status, limit: '20' });
      if (state) params.set('state', state);
      if (lga) params.set('lga', lga);
      if (severity) params.set('severity', severity);
      if (pageToken) params.set('page_token', pageToken);
      try {
        const result = await request<{ data: BoardCase[]; nextPageToken: string | null }>(
          `/v1/cases?${params}`,
        );
        if (sequence !== latest.current) return;
        setRows(result.data);
        setNext(result.nextPageToken);
        setSelected('');
      } catch (cause) {
        if (sequence !== latest.current) return;
        setError((cause as Error).message);
        setRows([]);
        setNext(null);
      } finally {
        if (sequence === latest.current) setBusy(false);
      }
    },
    [election, state, lga, severity, status],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const staff = user && ['reviewer', 'desk', 'admin'].includes(user.role);
  return (
    <>
      <form
        className="card"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <div className="grid-3">
          <div className="field">
            <label htmlFor="board-election">Election</label>
            <select
              id="board-election"
              value={election}
              onChange={(event) => setElection(event.target.value)}
            >
              {elections.map((row) => (
                <option key={row.id} value={row.slug}>
                  {row.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="board-state">State</label>
            <select
              id="board-state"
              value={state}
              onChange={(event) => {
                setState(event.target.value);
                setLga('');
              }}
            >
              <option value="">All states</option>
              {states.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="board-lga">Local government area</label>
            <select
              id="board-lga"
              value={lga}
              onChange={(event) => setLga(event.target.value)}
              disabled={!state}
            >
              <option value="">All local government areas</option>
              {lgas.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="board-severity">Severity</label>
            <select
              id="board-severity"
              value={severity}
              onChange={(event) => setSeverity(event.target.value)}
            >
              <option value="">All severities</option>
              <option value="critical">Critical</option>
              <option value="warn">Needs a check</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="board-status">Case status</label>
            <select
              id="board-status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="published">Published, including retracted</option>
              <option value="retracted">Retracted</option>
              {staff && (
                <>
                  <option value="all">All available cases</option>
                  <option value="under_investigation">Under investigation</option>
                  <option value="explained">Explained</option>
                  <option value="dismissed">Dismissed</option>
                  {user.role !== 'desk' && <option value="open">Open drafts</option>}
                </>
              )}
            </select>
          </div>
        </div>
        <button type="submit" disabled={busy}>
          Refresh cases
        </button>
      </form>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <output className="status">
        {busy ? 'Loading cases…' : `${rows.length} cases on this page.`}
      </output>
      <div className="actions">
        <button
          type="button"
          className="secondary"
          aria-expanded={map}
          onClick={() => setMap(!map)}
        >
          {map ? 'Hide case map' : 'Show case map'}
        </button>
        {next && (
          <button type="button" disabled={busy} onClick={() => void load(next)}>
            Next page
          </button>
        )}
        <button type="button" className="secondary" disabled={busy} onClick={() => void load()}>
          Newest cases
        </button>
      </div>
      {map && (
        <section className="card" aria-label="Case map">
          <h2>Cases on this page</h2>
          <p>
            Nearby pins are grouped. Open a group to zoom in, or use the complete list below. Sample
            coordinates are approximate.
          </p>
          <CaseMap rows={rows} onSelect={setSelected} />
          <p>Map tiles © OpenStreetMap contributors.</p>
        </section>
      )}
      <section aria-label="Case list" className="outbox">
        <h2>Case list</h2>
        {!busy && !rows.length && <p>No cases match these filters.</p>}
        <div className="grid-2">
          {rows.map((row) => (
            <article className="card" key={row.id} data-selected={selected === row.id || undefined}>
              <h3>
                <Link href={`/cases/${row.id}`} prefetch={false}>
                  {row.pollingUnit.name}
                </Link>
              </h3>
              <p className="badge sample">{row.pollingUnit.datasetNotice}</p>
              <p>
                {row.pollingUnit.lga.name}, {row.pollingUnit.state.name} · {row.pollingUnit.code}
              </p>
              <p>
                <span className="badge warn">{row.severity}</span>
                {row.status.replaceAll('_', ' ')}
              </p>
              <p>{row.summary}</p>
              <ul>
                {row.flags.map((flag) => (
                  <li key={flag.id}>
                    {flag.rule.replaceAll('_', ' ')} · {flag.field}
                  </li>
                ))}
              </ul>
              <p>
                {row.publishedAt
                  ? `Published ${formatWhen(row.publishedAt)}`
                  : `Opened ${formatWhen(row.createdAt)}`}
              </p>
              <Link className="button secondary" href={`/cases/${row.id}`} prefetch={false}>
                Read case and evidence
              </Link>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
