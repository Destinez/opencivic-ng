import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ELECTION_SLUGS,
  migrateDatabase,
  openDatabase,
  rateLimits,
  seedDatabase,
} from '@opencivic/db';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { REQUEST_LIMIT } from './rate-limit';

const uploadDir = await mkdtemp(join(tmpdir(), 'opencivic-requests-'));
const handle = await openDatabase('pglite');
await migrateDatabase(handle.exec);
await seedDatabase(handle.db, { uploadDir });
const deps = {
  db: handle.db,
  uploadDir,
  webOrigins: ['http://localhost:3000'],
  cookieSecure: false,
};
const app = createApp({ ...deps, rateLimit: false });
const aggregate = `/v1/aggregates?election=${ELECTION_SLUGS.sample}`;

afterAll(async () => {
  await handle.close();
  await rm(uploadDir, { recursive: true, force: true });
});

describe('public request validation', () => {
  it.each([
    'q=a',
    `q=${'a'.repeat(101)}`,
    'q=ab%00cd',
    'q=Ikeja&q=Edo',
    'limit=0',
    'limit=101',
    'limit=-1',
    'limit=1.5',
    'limit=ten',
    'limit=',
    'limit=1&limit=2',
    'offset=-1',
    'offset=5001',
    'offset=Infinity',
    'offset=1e3',
    `offset=${'9'.repeat(40)}`,
    'stateId=',
    'lgaId=with%20spaces',
    'wardId=bad%00id',
    `wardId=${'a'.repeat(161)}`,
    'unexpected=true',
  ])('rejects invalid search parameters: %s', async (query) => {
    const response = await app.request(`/v1/polling-units?${query}`);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'validation' } });
  });

  it('returns bounded pages and treats search metacharacters literally', async () => {
    const first = await app.request('/v1/polling-units?q=Ikeja&limit=1');
    const second = await app.request('/v1/polling-units?q=Ikeja&limit=1&offset=1');
    const pageOne = (await first.json()) as { data: Array<{ id: string }> };
    const pageTwo = (await second.json()) as { data: Array<{ id: string }> };
    expect(pageOne).toMatchObject({ limit: 1, offset: 0, official: false });
    expect(pageTwo).toMatchObject({ limit: 1, offset: 1, official: false });
    expect(pageOne.data).toHaveLength(1);
    expect(pageTwo.data).toHaveLength(1);
    expect(pageOne.data[0].id).not.toBe(pageTwo.data[0].id);
    const literal = await app.request('/v1/polling-units?q=%25_');
    expect(literal.status).toBe(200);
    expect(await literal.json()).toMatchObject({ total: 0, data: [] });
  });

  it.each([
    '/v1/states/bad%00id/lgas',
    `/v1/lgas/${'a'.repeat(161)}/wards`,
    '/v1/polling-units/SAMPLE%2F123',
    '/v1/elections/has%20spaces',
    '/v1/states?unknown=1',
    '/v1/elections?unknown=1',
    '/v1/states/sample-state-lagos/lgas?unknown=1',
    '/v1/lgas/sample-lga-lagos-ikeja/wards?unknown=1',
    '/v1/polling-units/sample-unit?unknown=1',
    `/v1/elections/${ELECTION_SLUGS.sample}?unknown=1`,
    `${aggregate}&level=national`,
    `${aggregate}&level=state&level=lga`,
    `${aggregate}&level=lga`,
    `${aggregate}&level=ward&parentId=`,
    `${aggregate}&level=state&parentId=sample-state-lagos`,
    `${aggregate}&level=state&unexpected=1`,
    '/v1/aggregates?level=state',
  ])('rejects invalid IDs and rollup parameters: %s', async (path) => {
    expect((await app.request(path)).status).toBe(422);
  });

  it('distinguishes unknown areas from valid empty results', async () => {
    expect((await app.request('/v1/polling-units/unknown-unit')).status).toBe(404);
    expect((await app.request(`${aggregate}&level=lga&parentId=missing-state`)).status).toBe(404);
    expect((await app.request(`${aggregate}&level=ward&parentId=sample-state-lagos`)).status).toBe(
      404,
    );
    const response = await app.request(`${aggregate}&level=lga&parentId=sample-state-lagos`);
    expect(response.status).toBe(200);
  });

  it('rejects malformed JSON, unknown account fields, and unsupported content types', async () => {
    const send = (body: string, contentType = 'application/json') =>
      app.request('/v1/auth/register', {
        method: 'POST',
        headers: { 'content-type': contentType },
        body,
      });
    expect((await send('{')).status).toBe(400);
    expect((await send('{}', 'text/plain')).status).toBe(415);
    expect((await send('null')).status).toBe(422);
    expect((await send('[]')).status).toBe(422);
    expect(
      (
        await send(
          JSON.stringify({
            name: 'Test Observer',
            email: 'test.observer@example.com',
            password: 'test-only-password',
            ageConfirmed: true,
            consent: true,
            role: 'admin',
          }),
        )
      ).status,
    ).toBe(422);
  });

  it('rejects oversized JSON and multipart bodies before parsing or authentication', async () => {
    for (const [path, contentType, size] of [
      ['/v1/auth/register', 'application/json', 65_537],
      ['/v1/submissions', 'multipart/form-data; boundary=test', 2_100_001],
    ] as const) {
      const response = await app.request(path, {
        method: 'POST',
        headers: { 'content-type': contentType },
        body: 'x'.repeat(size),
      });
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ error: { code: 'payload_too_large' } });
    }
    const longUrl = await app.request(`/v1/polling-units?q=${'x'.repeat(8192)}`);
    expect(longUrl.status).toBe(414);
  });
});

describe('HTTP request limits', () => {
  beforeEach(async () => {
    await handle.db.delete(rateLimits);
  });
  it('shares a public quota across paths and ignores forged forwarding headers', async () => {
    const limited = createApp(deps);
    const secondInstance = createApp(deps);
    for (let request = 0; request < REQUEST_LIMIT.max; request += 1) {
      const response = await (request % 2 ? secondInstance : limited).request('/v1/openapi.json', {
        headers: { 'x-forwarded-for': `192.0.2.${request}` },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('ratelimit-remaining')).toBe(String(119 - request));
    }
    const select = vi.spyOn(handle.db, 'select');
    try {
      for (const path of [
        '/v1/states',
        '/v1/states/sample-state-lagos/lgas',
        '/v1/lgas/sample-lga-lagos-ikeja/wards',
        '/v1/polling-units?q=Ikeja',
        '/v1/polling-units/sample-unit',
        '/v1/elections',
        `/v1/elections/${ELECTION_SLUGS.sample}`,
        `${aggregate}&level=state`,
        '/v1/openapi.json',
        '/docs',
      ]) {
        const response = await limited.request(path, {
          headers: { 'x-forwarded-for': '198.51.100.1', cookie: 'oc_session=untrusted' },
        });
        expect(response.status).toBe(429);
        expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
        expect(response.headers.get('ratelimit-remaining')).toBe('0');
        expect(await response.json()).toMatchObject({ error: { code: 'rate_limited' } });
      }
      expect(select).not.toHaveBeenCalled();
    } finally {
      select.mockRestore();
    }
    expect((await limited.request('/health')).status).toBe(200);
  });

  it.each([
    ['login', 10, 900],
    ['register', 5, 3600],
  ] as const)(
    'applies a stricter %s quota, including invalid attempts',
    async (route, max, reset) => {
      const limited = createApp(deps);
      const send = () =>
        limited.request(`/v1/auth/${route}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
      for (let request = 0; request < max; request += 1) expect((await send()).status).toBe(422);
      const response = await send();
      expect(response.status).toBe(429);
      expect(response.headers.get('ratelimit-limit')).toBe(String(max));
      expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(Number(response.headers.get('retry-after'))).toBeLessThanOrEqual(reset);
    },
  );
});
