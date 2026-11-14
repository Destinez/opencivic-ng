'use client';

import { formatWhen } from '@/lib/format';
import { request } from '@/lib/request';
import type { SubmissionCard } from '@/lib/types';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export function ReviewQueue() {
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState<SubmissionCard[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void request<{ data: SubmissionCard[] }>(`/v1/review/submissions?status=${status}`)
      .then((result) => {
        if (active) {
          setRows(result.data);
          setError('');
        }
      })
      .catch((cause: Error) => {
        if (active) {
          setRows([]);
          setError(cause.message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [status]);
  return (
    <>
      <div className="field">
        <label htmlFor="queue-status">Queue filter</label>
        <select
          id="queue-status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          {['pending', 'in_review', 'flagged', 'rejected', 'approved'].map((value) => (
            <option key={value} value={value}>
              {value.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p role="alert" className="alert">
          {error} <Link href="/account">Account</Link>
        </p>
      )}
      <output>
        {loading ? 'Loading observations…' : `${rows.length} observations in this list.`}
      </output>
      <div className="grid-2">
        {rows.map((row) => (
          <article className="card" key={row.id}>
            <h2>{row.pollingUnit.name}</h2>
            <p className="badge sample">{row.pollingUnit.datasetNotice}</p>
            <p>
              {row.pollingUnit.code} · {row.pollingUnit.lgaName}, {row.pollingUnit.stateName}
            </p>
            <p>
              Received {formatWhen(row.receivedAt)} · {row.status.replaceAll('_', ' ')}
            </p>
            {row.warnings.map((warning) => (
              <p key={warning}>
                <span className="badge warn">Needs a check</span> {warning}
              </p>
            ))}
            <Link className="button" prefetch={false} href={`/review/${row.id}`}>
              Review this sheet
            </Link>
          </article>
        ))}
      </div>
    </>
  );
}
