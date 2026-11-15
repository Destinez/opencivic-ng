import { apiGet } from '@/lib/api';
import Link from 'next/link';

export async function UnitCases({ unitId }: { unitId: string }) {
  const cases = await apiGet<{ data: Array<{ id: string; status: string; summary: string }> }>(
    `/v1/polling-units/${encodeURIComponent(unitId)}/sheetmatch?election=sample-demonstration-poll`,
  ).catch(() => null);
  return (
    <section className="card outbox">
      <h2>Sheet Match</h2>
      <p>Fictional demonstration poll. Only independently confirmed cases appear here.</p>
      {cases?.data.length ? (
        <ul>
          {cases.data.map((row) => (
            <li key={row.id}>
              <Link href={`/cases/${row.id}`}>{row.summary}</Link> · {row.status}
            </li>
          ))}
        </ul>
      ) : (
        <p>
          {cases
            ? 'No published cases for this unit.'
            : 'Case records are temporarily unavailable.'}
        </p>
      )}
      <Link href="/cases">Open the discrepancy board</Link>
    </section>
  );
}
