import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { calcRetryAfterSeconds } from '../../../src/logic/rateLimitCalc.ts';

export async function checkRateLimit(
  supabaseAdmin: SupabaseClient,
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const now = Date.now();

  // Single atomic upsert (see migration 20261002000001_atomic_rate_limit.sql).
  const { data, error } = await supabaseAdmin.rpc('rate_limit_hit', {
    p_key: key,
    p_window_seconds: windowSeconds,
  });

  if (error || !data?.[0]) {
    // Fail open: a limiter hiccup shouldn't take the game down. nginx still
    // enforces per-IP limits in front of every function.
    console.error(JSON.stringify({ fn: 'rateLimit', event: 'error', key, error: error?.message }));
    return { allowed: true };
  }

  const { hit_count, window_start } = data[0] as { hit_count: number; window_start: string };

  if (hit_count > maxRequests) {
    const retryAfter = calcRetryAfterSeconds(window_start, windowSeconds, now);
    console.warn(JSON.stringify({ fn: 'rateLimit', event: 'rate_limited', key, retryAfter }));
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}
