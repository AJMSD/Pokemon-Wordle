import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export async function markMissedSessions(
  supabaseAdmin: SupabaseClient,
  userId: string | null,
  guestId: string | null,
  todayKey: string,
  isVerified: boolean = false
): Promise<void> {
  const filter = userId ? { user_id: userId } : { guest_id: guestId };

  const { data: staleSessions } = await supabaseAdmin
    .from('daily_sessions')
    .select('id, puzzle_date_key, version')
    .match({ ...filter, completion_state: 'playing' })
    .lt('puzzle_date_key', todayKey);

  if (!staleSessions || staleSessions.length === 0) return;

  // One statement for all of them. The version bump only has to invalidate
  // clients still holding a stale copy, so a common value above every row's
  // current version does the job.
  const nextVersion = Math.max(...staleSessions.map((s) => s.version)) + 1;
  await supabaseAdmin
    .from('daily_sessions')
    .update({ completion_state: 'missed', version: nextVersion })
    .in('id', staleSessions.map((s) => s.id))
    .eq('completion_state', 'playing');

  if (userId && isVerified) {
    const latestMissed = staleSessions
      .map((s) => s.puzzle_date_key)
      .sort()
      .at(-1)!;

    await supabaseAdmin
      .from('user_stats')
      .update({
        current_streak: 0,
        participation_streak: 0,
        last_played_date: latestMissed,
      })
      .eq('user_id', userId);
  }
}
