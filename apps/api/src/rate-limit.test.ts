import { migrateDatabase, openTestDatabase, rateLimits } from '@opencivic/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit';

const handle = await openTestDatabase();
await migrateDatabase(handle.exec);
afterAll(() => handle.close());
beforeEach(async () => {
  await handle.db.delete(rateLimits);
});

describe('shared request limits', () => {
  it('allows the exact quota and recovers at the window boundary', async () => {
    let now = 0;
    const take = createRateLimiter(handle.db, () => now);
    const policy = { max: 2, windowMs: 60_000 };
    expect(await take('one', policy)).toMatchObject({ allowed: true, remaining: 1 });
    expect(await take('one', policy)).toMatchObject({ allowed: true, remaining: 0 });
    now = 1500;
    expect(await take('one', policy)).toMatchObject({ allowed: false, retryAfter: 59 });
    now = 60_000;
    expect(await take('one', policy)).toMatchObject({ allowed: true, remaining: 1 });
  });

  it('shares counters across independent instances and concurrent attempts', async () => {
    const first = createRateLimiter(handle.db, () => 1000);
    const second = createRateLimiter(handle.db, () => 1000);
    const policy = { max: 5, windowMs: 60_000 };
    const attempts = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        (index % 2 ? first : second)('same-network', policy),
      ),
    );
    expect(attempts.filter((attempt) => attempt.allowed)).toHaveLength(5);
    expect(await createRateLimiter(handle.db, () => 1000)('same-network', policy)).toMatchObject({
      allowed: false,
    });
    expect(await first('other-network', policy)).toMatchObject({ allowed: true });
  });

  it('stores opaque keys and removes expired windows', async () => {
    let now = 0;
    const take = createRateLimiter(handle.db, () => now);
    await take('login:192.0.2.1:person@example.com', { max: 10, windowMs: 900_000 });
    expect(JSON.stringify(await handle.db.select().from(rateLimits))).not.toContain(
      'person@example.com',
    );
    now = 3_660_000;
    await take('new-network', { max: 10, windowMs: 60_000 });
    expect(await handle.db.select().from(rateLimits)).toHaveLength(1);
  });
});
