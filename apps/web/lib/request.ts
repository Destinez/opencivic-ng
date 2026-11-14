export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/backend${path}`, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? 'The request could not be completed.');
  return body as T;
}

export function jsonRequest(body: unknown, method = 'POST'): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
