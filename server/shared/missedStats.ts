export interface StaleSession {
  puzzle_date_key: string;
  guesses?: string[] | null;
}

/**
 * user_stats changes when stale 'playing' sessions are marked missed. The win
 * streak always breaks; the participation streak only breaks when the latest
 * missed day had no guesses (a started-but-unfinished game still counts as
 * participation).
 */
export function missedStatsUpdate(stale: StaleSession[]): Record<string, unknown> {
  const latest = [...stale].sort((a, b) => a.puzzle_date_key.localeCompare(b.puzzle_date_key)).at(-1)!;
  const participated = (latest.guesses?.length ?? 0) > 0;
  return {
    current_streak: 0,
    ...(participated ? {} : { participation_streak: 0 }),
    last_played_date: latest.puzzle_date_key,
  };
}
