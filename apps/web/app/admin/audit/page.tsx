'use client';

import { formatWhen } from '@/lib/format';
import { useEffect, useState } from 'react';

type EventRow = {
  id: number;
  occurredAt: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
};

export default function AuditPage() {
  const [rows, setRows] = useState<EventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/backend/v1/admin/audit?limit=100', { credentials: 'include' })
      .then(async (response) => {
        const body = (await response.json()) as { data?: EventRow[]; error?: { message: string } };
        if (!response.ok) {
          setError(body.error?.message ?? 'The audit log is not available to this account.');
          setRows([]);
          return;
        }
        setRows(body.data ?? []);
      })
      .catch(() => setError('The data service is unavailable.'));
  }, []);

  return (
    <>
      <p className="kicker">Admin</p>
      <h1>Audit log</h1>
      <p className="lede">
        Every registration, sign-in, observation, and decision is appended. The database refuses
        updates and deletes on this table. Email addresses are not copied into the log.
      </p>
      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}
      {rows === null ? <p>Loading the log…</p> : null}
      {rows && rows.length > 0 ? (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table>
            <caption className="sr-only">Append-only audit events</caption>
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Actor id</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatWhen(row.occurredAt)}</td>
                  <td>{row.action}</td>
                  <td>
                    {row.entityType} {row.entityId}
                  </td>
                  <td>{row.actorId ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
