import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit';

describe('request limits', () => {
  it('allows the exact quota, rejects excess requests, and recovers at expiry', () => {
    let now = 0;
    const take = createRateLimiter({ now: () => now });
    const policy = { max: 2, windowMs: 60_000 };
    expect(take('one', policy)).toMatchObject({ allowed: true, remaining: 1 });
    expect(take('one', policy)).toMatchObject({ allowed: true, remaining: 0 });
    now = 1500;
    expect(take('one', policy)).toMatchObject({ allowed: false, retryAfter: 59 });
    now = 60_000;
    expect(take('one', policy)).toMatchObject({ allowed: true, remaining: 1 });
  });

  it('keeps client addresses and route policies independent', () => {
    const take = createRateLimiter();
    const policy = { max: 1, windowMs: 60_000 };
    expect(take('login:one', policy).allowed).toBe(true);
    expect(take('login:one', policy).allowed).toBe(false);
    expect(take('login:two', policy).allowed).toBe(true);
    expect(take('register:one', policy).allowed).toBe(true);
  });

  it('bounds storage without evicting active limits and reclaims expired entries', () => {
    let now = 0;
    const take = createRateLimiter({ now: () => now, maxKeys: 2 });
    const policy = { max: 1, windowMs: 60_000 };
    take('one', policy);
    take('two', policy);
    expect(take('three', policy).allowed).toBe(false);
    expect(take('one', policy).allowed).toBe(false);
    now = 60_000;
    expect(take('three', policy).allowed).toBe(true);
    expect(take('four', policy).allowed).toBe(true);
  });
});
