'use client';

import { jsonRequest, request } from '@/lib/request';
import type { ReviewDetail } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function OpenCaseForm({ detail }: { detail: ReviewDetail }) {
  const router = useRouter();
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const flags = detail.flags.filter(
    (flag) => flag.rule !== 'duplicate_image' && flag.severity !== 'info',
  );
  if (
    !flags.length ||
    !detail.submission.hasPhoto ||
    !['flagged', 'approved'].includes(detail.submission.status)
  )
    return null;
  return (
    <section className="card outbox">
      <h2>Open a discrepancy case</h2>
      <p>
        The case stays private until a different reviewer confirms it. New observers also need
        corroborating evidence.
      </p>
      {error && (
        <p className="alert" role="alert" id="open-case-error">
          {error}
        </p>
      )}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            const result = await request<{ id: string }>(
              '/v1/cases',
              jsonRequest({ flagIds: flags.map((flag) => flag.id), summary }),
            );
            router.push(`/cases/${result.id}`);
          } catch (cause) {
            setError((cause as Error).message);
            setBusy(false);
          }
        }}
      >
        <div className="field">
          <label htmlFor="case-summary">Case summary</label>
          <textarea
            id="case-summary"
            minLength={10}
            maxLength={1000}
            required
            aria-describedby={error ? 'open-case-error' : undefined}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </div>
        <button type="submit" disabled={busy}>
          Open discrepancy case
        </button>
      </form>
    </section>
  );
}
