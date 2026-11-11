import { ApiError, apiGet, apiOrigin } from '@/lib/api';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'API' };

type Spec = {
  info: { description: string };
  paths: Record<string, Record<string, { summary?: string; tags?: string[] }>>;
};

export default async function DevelopersPage() {
  try {
    const spec = await apiGet<Spec>('/v1/openapi.json');
    const rows = Object.entries(spec.paths).flatMap(([path, methods]) =>
      Object.entries(methods).map(([method, operation]) => ({
        method: method.toUpperCase(),
        path,
        tag: operation.tags?.[0] ?? '',
        summary: operation.summary ?? '',
      })),
    );
    return (
      <>
        <p className="kicker">Read API</p>
        <h1>HTTP API</h1>
        <p className="lede">{spec.info.description}</p>
        <p>
          Document: <a href={`${apiOrigin()}/v1/openapi.json`}>{apiOrigin()}/v1/openapi.json</a>.
          The browser UI calls the same service through <code>/backend</code>.
        </p>
        <pre className="card">{`curl '${apiOrigin()}/v1/polling-units?q=Ikeja'`}</pre>
        <div className="card" style={{ overflowX: 'auto' }}>
          <table>
            <caption>Routes in the OpenAPI document</caption>
            <thead>
              <tr>
                <th>Method</th>
                <th>Path</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.method} ${row.path}`}>
                  <td>{row.method}</td>
                  <td>
                    <code>{row.path}</code>
                  </td>
                  <td>{row.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  } catch (error) {
    const message = error instanceof ApiError ? error.message : 'The API is not running.';
    return (
      <>
        <h1>HTTP API</h1>
        <p className="alert" role="alert">
          {message}
        </p>
      </>
    );
  }
}
