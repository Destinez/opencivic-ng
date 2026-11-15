'use client';

import { jsonRequest, request } from '@/lib/request';
import type { ElectionSummary } from '@/lib/types';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type Observer = {
  id: string;
  name: string;
  email: string;
  trustLevel: number | null;
  accreditationRef: string | null;
  approvedCount: number | null;
  rejectedCount: number | null;
  frozen: boolean | null;
};
type Abuse = {
  signals: Array<{
    kind: string;
    key: string;
    submissions: number;
    units: number;
    observers: number;
  }>;
  duplicateImages: Array<{ id: string; submissionId: string; pollingUnitId: string }>;
  note: string;
};
export default function ObserversPage() {
  const [rows, setRows] = useState<Observer[]>([]);
  const [abuse, setAbuse] = useState<Abuse>();
  const [elections, setElections] = useState<ElectionSummary[]>([]);
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const refresh = useCallback(async () => {
    try {
      const [o, a, e, u] = await Promise.all([
        request<{ data: Observer[] }>('/v1/admin/observers'),
        request<Abuse>('/v1/admin/abuse'),
        request<{ data: ElectionSummary[] }>('/v1/elections'),
        request<{ data: Array<{ id: string; name: string; role: string }> }>('/v1/admin/users'),
      ]);
      setRows(o.data);
      setAbuse(a);
      setElections(e.data);
      setAccounts(u.data);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function save(path: string, input: unknown) {
    setError('');
    setInfo('');
    try {
      await request(path, jsonRequest(input));
      setInfo('Change saved in the audit log.');
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  return (
    <>
      <p className="kicker">Admin</p>
      <h1>Observer trust and abuse review</h1>
      <p className="lede">
        Accreditation and submission freezes need a documented human check. Connection signals alone
        do not establish misuse.
      </p>
      <Link href="/admin/audit">Read the audit log</Link>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <output className="status" aria-live="polite">
        {info}
      </output>
      <section className="outbox">
        <h2>Observers</h2>
        {rows.map((row) => (
          <form
            className="card"
            key={`${row.id}:${row.trustLevel}:${row.frozen}`}
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void save(`/v1/admin/observers/${row.id}/trust`, {
                trustLevel: Number(form.get('level')),
                accreditationRef: String(form.get('reference') ?? '').trim() || null,
                frozen: form.get('frozen') === 'on',
                note: form.get('note'),
              });
            }}
          >
            <h3>{row.name}</h3>
            <p>
              {row.email} · {row.approvedCount ?? 0} approved · {row.rejectedCount ?? 0} rejected
            </p>
            <div className="field">
              <label htmlFor={`level-${row.id}`}>Trust level for {row.name}</label>
              <select id={`level-${row.id}`} name="level" defaultValue={row.trustLevel ?? 0}>
                <option value="0">L0 — two approvals</option>
                <option value="1">L1 — one approval</option>
                <option value="2">L2 — accredited observer</option>
                <option value="3">L3 — coordinator</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor={`reference-${row.id}`}>Accreditation reference for {row.name}</label>
              <input
                id={`reference-${row.id}`}
                name="reference"
                defaultValue={row.accreditationRef ?? ''}
                maxLength={160}
              />
            </div>
            <label className="check">
              <input type="checkbox" name="frozen" defaultChecked={row.frozen ?? false} />
              <span>Freeze submissions for {row.name}</span>
            </label>
            <div className="field">
              <label htmlFor={`note-${row.id}`}>Trust decision note for {row.name}</label>
              <input id={`note-${row.id}`} name="note" required minLength={8} maxLength={500} />
            </div>
            <button type="submit">Save trust for {row.name}</button>
          </form>
        ))}
      </section>
      <section className="card outbox">
        <h2>Abuse signals</h2>
        <p>{abuse?.note}</p>
        {abuse && !abuse.signals.length && !abuse.duplicateImages.length && (
          <p>No current abuse signals.</p>
        )}
        <ul>
          {abuse?.signals.map((row) => (
            <li key={`${row.kind}:${row.key}`}>
              {row.kind.replaceAll('_', ' ')} · {row.submissions} sheets across {row.units} units
              from {row.observers} accounts · group {row.key.slice(0, 12)}
            </li>
          ))}
          {abuse?.duplicateImages.map((row) => (
            <li key={row.id}>
              Duplicate image at {row.pollingUnitId}:{' '}
              <Link href={`/review/${row.submissionId}`}>Check sheet</Link>
            </li>
          ))}
        </ul>
      </section>
      <section className="outbox">
        <h2>Election submissions</h2>
        {elections.map((election) => (
          <form
            className="card"
            key={election.id}
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void save(`/v1/admin/elections/${election.id}/config`, {
                acceptsSubmissions: form.get('accept') === 'on',
                note: form.get('note'),
              });
            }}
          >
            <h3>{election.name}</h3>
            <label className="check">
              <input name="accept" type="checkbox" defaultChecked={election.acceptsSubmissions} />
              <span>Accept submissions for {election.name}</span>
            </label>
            <div className="field">
              <label htmlFor={`election-note-${election.id}`}>
                Configuration note for {election.name}
              </label>
              <input
                id={`election-note-${election.id}`}
                name="note"
                required
                minLength={8}
                maxLength={500}
              />
            </div>
            <button type="submit">Save {election.name}</button>
          </form>
        ))}
      </section>
      <section className="outbox">
        <h2>Account roles</h2>
        {accounts.map((account) => (
          <form
            className="card"
            key={account.id}
            onSubmit={(event) => {
              event.preventDefault();
              void save(`/v1/admin/users/${account.id}/role`, {
                role: new FormData(event.currentTarget).get('role'),
              });
            }}
          >
            <div className="field">
              <label htmlFor={`role-${account.id}`}>Role for {account.name}</label>
              <select id={`role-${account.id}`} name="role" defaultValue={account.role}>
                {['observer', 'reviewer', 'desk', 'admin'].map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </select>
            </div>
            <button type="submit">Save role for {account.name}</button>
          </form>
        ))}
      </section>
    </>
  );
}
