import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export async function markMissedSessions(
  supabaseAdmin: SupabaseClient,
  userId: string | null,
  guestId: string | null,
  todayKey: string
): Promise<void> {
  const filter = userId ? { user_id: userId } : { guest_id: guestId };

  const { data: staleSessions } = await supabaseAdmin
    .from('daily_sessions')
    .select('id, puzzle_date_key, version')
    .match({ ...filter, completion_state: 'playing' })
    .lt('puzzle_date_key', todayKey);

  if (!staleSessions || staleSessions.length === 0) return;

  for (const s of staleSessions) {
    await supabaseAdmin
      .from('daily_sessions')
      .update({ completion_state: 'missed', version: s.version + 1 })
      .eq('id', s.id);
  }

  // Update streak for authenticated users only
  if (userId) {
    const { data: stats } = await supabaseAdmin
      .from('user_stats')
      .select('games_played, current_streak, last_played_date')
      .eq('user_id', userId)
      .single();

    if (stats) {
      const latestMissed = staleSessions
        .map((s) => s.puzzle_date_key)
        .sort()
        .at(-1)!;

      await supabaseAdmin
        .from('user_stats')
        .update({
          games_played: (stats.games_played ?? 0) + staleSessions.length,
          current_streak: 0,
          last_played_date: latestMissed,
        })
        .eq('user_id', userId);
    }
  }
}
