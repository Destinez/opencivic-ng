type Bucket = { count: number; expiresAt: number };

export const REQUEST_LIMIT = { max: 120, windowMs: 60_000 };
export const LOGIN_LIMIT = { max: 10, windowMs: 15 * 60_000 };
export const REGISTER_LIMIT = { max: 5, windowMs: 60 * 60_000 };

export function createRateLimiter({ now = Date.now, maxKeys = 10_000 } = {}) {
  const buckets = new Map<string, Bucket>();
  let nextCleanup = 0;

  return (key: string, { max, windowMs }: { max: number; windowMs: number }) => {
    const time = now();
    if (time >= nextCleanup) {
      for (const [id, bucket] of buckets) {
        if (bucket.expiresAt <= time) buckets.delete(id);
      }
      nextCleanup = time + 60_000;
    }

    let bucket = buckets.get(key);
    if (bucket && bucket.expiresAt <= time) {
      buckets.delete(key);
      bucket = undefined;
    }
    if (!bucket) {
      // Keep active limits intact when the store is full.
      if (buckets.size >= maxKeys) {
        return { allowed: false, limit: max, remaining: 0, retryAfter: 60 };
      }
      bucket = { count: 0, expiresAt: time + windowMs };
      buckets.set(key, bucket);
    }

    const allowed = bucket.count < max;
    if (allowed) bucket.count += 1;
    return {
      allowed,
      limit: max,
      remaining: Math.max(0, max - bucket.count),
      retryAfter: Math.max(1, Math.ceil((bucket.expiresAt - time) / 1000)),
    };
  };
}
