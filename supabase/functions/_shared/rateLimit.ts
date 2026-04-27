import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isWindowExpired, isRateLimited, calcRetryAfterSeconds } from '../../../src/logic/rateLimitCalc.ts';

export async function checkRateLimit(
  supabaseAdmin: SupabaseClient,
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const now = new Date();

  const { data: existing } = await supabaseAdmin
    .from('rate_limits')
    .select('count, window_start')
    .eq('key', key)
    .single();

  if (!existing) {
    await supabaseAdmin
      .from('rate_limits')
      .insert({ key, count: 1, window_start: now.toISOString() });
    return { allowed: true };
  }

  if (isWindowExpired(existing.window_start, windowSeconds, now.getTime())) {
    // Window expired — reset
    await supabaseAdmin
      .from('rate_limits')
      .update({ count: 1, window_start: now.toISOString() })
      .eq('key', key);
    return { allowed: true };
  }

  if (isRateLimited(existing.count, maxRequests)) {
    const retryAfter = calcRetryAfterSeconds(existing.window_start, windowSeconds, now.getTime());
    return { allowed: false, retryAfter };
  }

  await supabaseAdmin
    .from('rate_limits')
    .update({ count: existing.count + 1 })
    .eq('key', key);

  return { allowed: true };
}
