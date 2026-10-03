import { sql } from '../db.ts';
import type { Ctx } from '../http.ts';
import { publicUser, requireUser } from '../auth/session.ts';

interface ProfileRow {
  id: string;
  username: string;
  avatar_config: Record<string, unknown> | null;
  display_ball: string | null;
  tier_prompt_dismissed_forever: boolean;
  created_at: Date;
}

interface StatsRow {
  current_streak: number | null;
  max_streak: number | null;
  total_participations: number | null;
  games_won: number | null;
  participation_streak: number | null;
  max_participation_streak: number | null;
  total_losses: number | null;
  guess_distribution: Record<string, number> | null;
}

// GET /v1/get-me -> { user, profile (null until a Trainer name is chosen), stats }
export async function getMe({ req, json }: Ctx): Promise<Response> {
  const user = await requireUser(req);
  if (!user) return json({ error: 'Invalid token' }, 401);

  const [[profile], [stats]] = await Promise.all([
    sql<ProfileRow[]>`
      select id, username, avatar_config, display_ball, tier_prompt_dismissed_forever, created_at
      from profiles where id = ${user.id}`,
    sql<StatsRow[]>`
      select current_streak, max_streak, total_participations, games_won, participation_streak,
             max_participation_streak, total_losses, guess_distribution
      from user_stats where user_id = ${user.id}`,
  ]);

  const totalParticipations = stats?.total_participations ?? 0;
  const totalWins = stats?.games_won ?? 0;
  const dist: Record<string, number> = stats?.guess_distribution ?? {};

  const winRate = totalParticipations > 0
    ? Math.round((totalWins / totalParticipations) * 100) / 100
    : 0;

  let avgGuesses = 0;
  if (totalWins > 0) {
    const totalGuesses = Object.entries(dist).reduce(
      (sum, [k, v]) => sum + Number(k) * v,
      0
    );
    avgGuesses = Math.round((totalGuesses / totalWins) * 10) / 10;
  }

  let bestGuessSummary: string | null = null;
  const minKey = Object.entries(dist)
    .filter(([, v]) => v > 0)
    .sort(([a], [b]) => Number(a) - Number(b))
    .at(0);
  if (minKey) {
    bestGuessSummary = `Solved in ${minKey[0]} guesses: ${minKey[1]} times`;
  }

  return json({
    user: publicUser(user),
    profile: profile
      ? {
          id: profile.id,
          username: profile.username,
          avatar_config: profile.avatar_config ?? {},
          display_ball: profile.display_ball,
          tier_prompt_dismissed_forever: Boolean(profile.tier_prompt_dismissed_forever),
          created_at: profile.created_at.toISOString(),
        }
      : null,
    stats: {
      current_streak: stats?.current_streak ?? 0,
      max_streak: stats?.max_streak ?? 0,
      total_participations: totalParticipations,
      total_wins: totalWins,
      win_rate: winRate,
      avg_guesses: avgGuesses,
      participation_streak: stats?.participation_streak ?? 0,
      max_participation_streak: stats?.max_participation_streak ?? 0,
      total_losses: stats?.total_losses ?? 0,
      guess_distribution: dist,
      best_guess_summary: bestGuessSummary,
    },
  }, 200);
}
