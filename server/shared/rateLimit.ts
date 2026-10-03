import type { Db } from '../db.ts';
import { calcRetryAfterSeconds } from '../../src/logic/rateLimitCalc.ts';

export async function checkRateLimit(
  db: Db,
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const now = Date.now();

  let row: { hit_count: number; window_start: Date } | undefined;
  try {
    // Single atomic upsert (rate_limit_hit in db/migrations/0001_baseline.sql).
    [row] = await db<{ hit_count: number; window_start: Date }[]>`
      select hit_count, window_start from rate_limit_hit(${key}, ${windowSeconds})`;
  } catch (err) {
    // Fail open: a limiter hiccup shouldn't take the game down. nginx still
    // enforces per-IP limits in front of every route.
    console.error(JSON.stringify({ fn: 'rateLimit', event: 'error', key, error: String(err) }));
    return { allowed: true };
  }
  if (!row) return { allowed: true };

  if (row.hit_count > maxRequests) {
    const retryAfter = calcRetryAfterSeconds(row.window_start.toISOString(), windowSeconds, now);
    console.warn(JSON.stringify({ fn: 'rateLimit', event: 'rate_limited', key, retryAfter }));
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}
