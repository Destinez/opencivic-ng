export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export function apiOrigin(): string {
  return process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
}

export async function apiGet<T>(path: string, cookie?: string): Promise<T> {
  const response = await fetch(`${apiOrigin()}${path}`, {
    cache: 'no-store',
    headers: cookie ? { cookie } : undefined,
  });
  if (!response.ok) {
    throw new ApiError(`The data service returned ${response.status}.`);
  }
  return (await response.json()) as T;
}
