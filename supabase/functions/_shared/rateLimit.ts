import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export async function checkRateLimit(
  supabaseAdmin: SupabaseClient,
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowSeconds * 1000);

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

  const recordWindowStart = new Date(existing.window_start);

  if (recordWindowStart < windowStart) {
    // Window expired — reset
    await supabaseAdmin
      .from('rate_limits')
      .update({ count: 1, window_start: now.toISOString() })
      .eq('key', key);
    return { allowed: true };
  }

  if (existing.count >= maxRequests) {
    const windowEnds = new Date(recordWindowStart.getTime() + windowSeconds * 1000);
    const retryAfter = Math.ceil((windowEnds.getTime() - now.getTime()) / 1000);
    return { allowed: false, retryAfter };
  }

  await supabaseAdmin
    .from('rate_limits')
    .update({ count: existing.count + 1 })
    .eq('key', key);

  return { allowed: true };
}
