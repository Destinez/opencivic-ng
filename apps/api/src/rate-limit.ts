import { createHash } from 'node:crypto';
import { type AppDb, rateLimits } from '@opencivic/db';
import { lt, sql } from 'drizzle-orm';

export const REQUEST_LIMIT = { max: 120, windowMs: 60_000 };
export const LOGIN_LIMIT = { max: 10, windowMs: 15 * 60_000 };
export const REGISTER_LIMIT = { max: 5, windowMs: 60 * 60_000 };
export const SUBMISSION_LIMIT = { max: 10, windowMs: 60 * 60_000 };
export const REFERENCE_LIMIT = { max: 60, windowMs: 60 * 60_000 };
type LimitDb = Pick<AppDb, 'insert' | 'delete'>;

export function createRateLimiter(db: LimitDb, now = Date.now) {
  let cleanupAt = 0;
  return async (
    key: string,
    policy: { max: number; windowMs: number },
    connection: LimitDb = db,
  ) => {
    const time = now();
    const start = Math.floor(time / policy.windowMs) * policy.windowMs;
    if (time >= cleanupAt) {
      cleanupAt = time + 60_000;
      await connection
        .delete(rateLimits)
        .where(lt(rateLimits.windowStart, new Date(time - 3_600_000)));
    }
    const [row] = await connection
      .insert(rateLimits)
      .values({
        key: createHash('sha256').update(key).digest('hex'),
        windowStart: new Date(start),
        count: 1,
      })
      .onConflictDoUpdate({
        target: [rateLimits.key, rateLimits.windowStart],
        set: { count: sql`${rateLimits.count} + 1` },
        setWhere: lt(rateLimits.count, policy.max),
      })
      .returning({ count: rateLimits.count });
    return {
      allowed: Boolean(row),
      limit: policy.max,
      remaining: Math.max(0, policy.max - (row?.count ?? policy.max)),
      retryAfter: Math.max(1, Math.ceil((start + policy.windowMs - time) / 1000)),
    };
  };
}

export type TakeRequest = ReturnType<typeof createRateLimiter>;
