import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { checkBallUnlocks } from '../../../src/logic/ballLogic.ts';
import { calcWinStreak, calcWinsAfterLoss } from '../../../src/logic/streakLogic.ts';

export function getYesterdayJST(): string {
  return new Date(Date.now() + 9 * 3600 * 1000 - 24 * 3600 * 1000).toISOString().slice(0, 10);
}

// Inserts the balls in one statement; returns only the ones that were new.
export async function awardBalls(
  supabaseAdmin: SupabaseClient,
  userId: string,
  ballIds: string[]
): Promise<string[]> {
  if (ballIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('ball_unlocks')
    .upsert(
      ballIds.map((ball_id) => ({ user_id: userId, ball_id })),
      { onConflict: 'user_id,ball_id', ignoreDuplicates: true }
    )
    .select('ball_id');
  if (error) {
    console.error(JSON.stringify({ fn: 'completion', event: 'award_balls_failed', error: error.message }));
    return [];
  }
  return (data ?? []).map((row: { ball_id: string }) => row.ball_id);
}

export interface CompletedGame {
  userId: string;
  puzzleDateKey: string;
  targetName: string;
  guesses: string[];
  state: 'won' | 'lost';
}

/**
 * Records a finished game for a verified user exactly once.
 *
 * daily_results is inserted first (ON CONFLICT DO NOTHING); only the call that
 * actually inserted the row updates user_stats and returns balls to award, so
 * retries and the get-session repair path can never double count. If the stats
 * write fails the result row is removed again so a later repair can retry.
 *
 * Returns the ball ids earned by this completion ([] if already recorded).
 */
export async function recordCompletion(
  admin: SupabaseClient,
  game: CompletedGame
): Promise<string[]> {
  const { userId, puzzleDateKey, guesses, state } = game;

  const { data: inserted, error: insertError } = await admin
    .from('daily_results')
    .upsert(
      {
        user_id: userId,
        puzzle_date_key: puzzleDateKey,
        pokemon_name: game.targetName,
        guesses,
        guess_count: guesses.length,
        result: state,
      },
      { onConflict: 'user_id,puzzle_date_key', ignoreDuplicates: true }
    )
    .select('user_id');
  if (insertError) throw new Error(`daily_results insert: ${insertError.message}`);
  if (!inserted || inserted.length === 0) return [];

  try {
    const { data: stats, error: statsError } = await admin
      .from('user_stats')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (statsError) throw new Error(`user_stats select: ${statsError.message}`);

    let winsAfterLoss = 0;
    if (stats) {
      const won = state === 'won';
      const dist = { ...(stats.guess_distribution ?? {}) };
      if (won) {
        const key = String(guesses.length);
        dist[key] = (dist[key] ?? 0) + 1;
      }
      const currentStreak = calcWinStreak(
        stats.last_played_date ?? '',
        getYesterdayJST(),
        stats.current_streak ?? 0,
        won
      );
      winsAfterLoss = calcWinsAfterLoss(stats.wins_after_loss_streak ?? 0, won);

      const { error: updateError } = await admin
        .from('user_stats')
        .update({
          games_won: (stats.games_won ?? 0) + (won ? 1 : 0),
          total_losses: (stats.total_losses ?? 0) + (state === 'lost' ? 1 : 0),
          current_streak: currentStreak,
          max_streak: Math.max(stats.max_streak ?? 0, currentStreak),
          last_played_date: puzzleDateKey,
          guess_distribution: dist,
          wins_after_loss_streak: winsAfterLoss,
        })
        .eq('user_id', userId);
      if (updateError) throw new Error(`user_stats update: ${updateError.message}`);
    }

    return checkBallUnlocks({
      completionState: state,
      guessCount: guesses.length,
      partStreak: 0,
      waterBugCount: 0,
      isWaterOrBug: false,
      winsAfterLoss,
      hasProfile: false,
    });
  } catch (err) {
    // Let the next get-session repair this game.
    await admin
      .from('daily_results')
      .delete()
      .match({ user_id: userId, puzzle_date_key: puzzleDateKey });
    throw err;
  }
}
