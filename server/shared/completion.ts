import { jsonb, type Db } from '../db.ts';
import { sql as pool } from '../db.ts';
import { checkBallUnlocks } from '../../src/logic/ballLogic.ts';
import { calcWinStreak, calcWinsAfterLoss } from '../../src/logic/streakLogic.ts';

export function getYesterdayJST(): string {
  return new Date(Date.now() + 9 * 3600 * 1000 - 24 * 3600 * 1000).toISOString().slice(0, 10);
}

// Inserts the balls in one statement; returns only the ones that were new.
export async function awardBalls(db: Db, userId: string, ballIds: string[]): Promise<string[]> {
  if (ballIds.length === 0) return [];
  try {
    const rows = await db<{ ball_id: string }[]>`
      insert into ball_unlocks (user_id, ball_id)
      select ${userId}, unnest(${ballIds}::text[])
      on conflict (user_id, ball_id) do nothing
      returning ball_id`;
    return rows.map((row) => row.ball_id);
  } catch (err) {
    console.error(JSON.stringify({ fn: 'completion', event: 'award_balls_failed', error: String(err) }));
    return [];
  }
}

export interface CompletedGame {
  userId: string;
  puzzleDateKey: string;
  targetName: string;
  guesses: string[];
  state: 'won' | 'lost';
}

interface StatsRow {
  games_won: number | null;
  total_losses: number | null;
  current_streak: number | null;
  max_streak: number | null;
  last_played_date: string | null;
  guess_distribution: Record<string, number> | null;
  wins_after_loss_streak: number | null;
}

/**
 * Records a finished game for a verified user exactly once.
 *
 * daily_results is inserted (ON CONFLICT DO NOTHING) in the same transaction
 * as the user_stats update; only the call that actually inserted the row
 * updates stats and returns balls to award, so retries and the get-session
 * repair path can never double count, and a failed stats write leaves no
 * result row behind (the next get-session repairs it).
 *
 * Returns the ball ids earned by this completion ([] if already recorded).
 */
export async function recordCompletion(game: CompletedGame): Promise<string[]> {
  const { userId, puzzleDateKey, guesses, state } = game;

  return await pool.begin(async (tx) => {
    const inserted = await tx`
      insert into daily_results (user_id, puzzle_date_key, pokemon_name, guesses, guess_count, result)
      values (${userId}, ${puzzleDateKey}, ${game.targetName}, ${guesses}::text[], ${guesses.length}, ${state})
      on conflict (user_id, puzzle_date_key) do nothing
      returning user_id`;
    if (inserted.length === 0) return [];

    const [stats] = await tx<StatsRow[]>`
      select games_won, total_losses, current_streak, max_streak, last_played_date,
             guess_distribution, wins_after_loss_streak
      from user_stats where user_id = ${userId} for update`;

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

      await tx`
        update user_stats set
          games_won = ${(stats.games_won ?? 0) + (won ? 1 : 0)},
          total_losses = ${(stats.total_losses ?? 0) + (state === 'lost' ? 1 : 0)},
          current_streak = ${currentStreak},
          max_streak = ${Math.max(stats.max_streak ?? 0, currentStreak)},
          last_played_date = ${puzzleDateKey},
          guess_distribution = ${jsonb(dist)},
          wins_after_loss_streak = ${winsAfterLoss}
        where user_id = ${userId}`;
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
  });
}
