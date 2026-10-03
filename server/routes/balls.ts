import { sql } from '../db.ts';
import { rateLimited, readJson, type Ctx } from '../http.ts';
import { requireUser } from '../auth/session.ts';
import { checkRateLimit } from '../shared/rateLimit.ts';

const STANDARD_ORDER = ['poke-ball', 'great-ball', 'ultra-ball', 'master-ball'];

function getStreakTierBall(streak: number): string {
  if (streak >= 14) return 'master-ball';
  if (streak >= 7) return 'ultra-ball';
  if (streak >= 3) return 'great-ball';
  return 'poke-ball';
}

async function currentStreak(userId: string): Promise<number> {
  const [stats] = await sql<{ current_streak: number | null }[]>`
    select current_streak from user_stats where user_id = ${userId}`;
  return stats?.current_streak ?? 0;
}

interface CatalogRow {
  id: string;
  display_name: string;
  category: string;
  unlock_condition: { hint?: string } | null;
}

// GET /v1/get-balls
export async function getBalls({ req, json }: Ctx): Promise<Response> {
  const user = await requireUser(req);
  if (!user || !user.email_verified_at) return json({ error: 'Unauthorized' }, 401);

  const [catalog, unlocks, streak, [profile]] = await Promise.all([
    sql<CatalogRow[]>`select id, display_name, category, unlock_condition from ball_catalog`,
    sql<{ ball_id: string }[]>`select ball_id from ball_unlocks where user_id = ${user.id}`,
    currentStreak(user.id),
    sql<{ display_ball: string | null }[]>`select display_ball from profiles where id = ${user.id}`,
  ]);

  const unlocked = new Set(unlocks.map((r) => r.ball_id));
  const displayBall = profile?.display_ball ?? 'poke-ball';
  const currentTierBall = getStreakTierBall(streak);
  const currentTierIndex = STANDARD_ORDER.indexOf(currentTierBall);

  const balls = catalog.map((b) => {
    let status: string;
    if (b.category === 'standard') {
      const ballIndex = STANDARD_ORDER.indexOf(b.id);
      if (ballIndex < currentTierIndex) status = 'past_tier';
      else if (ballIndex === currentTierIndex) status = 'current_tier';
      else status = 'future_tier';
    } else {
      status = unlocked.has(b.id) ? 'unlocked' : 'locked';
    }
    return {
      id: b.id,
      display_name: b.display_name,
      category: b.category,
      status,
      hint: b.unlock_condition?.hint ?? null,
    };
  });

  // Sort: standard balls first (by tier order), then achievement balls
  balls.sort((a, b) => {
    if (a.category === 'standard' && b.category !== 'standard') return -1;
    if (a.category !== 'standard' && b.category === 'standard') return 1;
    if (a.category === 'standard') {
      return STANDARD_ORDER.indexOf(a.id) - STANDARD_ORDER.indexOf(b.id);
    }
    return 0;
  });

  return json({ current_streak_tier: currentTierBall, display_ball: displayBall, balls }, 200);
}

// PATCH /v1/set-display-ball {ball_id}
export async function setDisplayBall({ req, json }: Ctx): Promise<Response> {
  const user = await requireUser(req);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const rateLimit = await checkRateLimit(sql, `set-display-ball:user:${user.id}`, 10, 60);
  if (!rateLimit.allowed) return rateLimited(json, rateLimit.retryAfter);

  const body = await readJson(req);
  if (!body) return json({ error: 'Invalid JSON' }, 400);
  const ballId = body.ball_id;
  if (!ballId || typeof ballId !== 'string') return json({ error: 'ball_id is required' }, 400);

  const [ball] = await sql<{ id: string; category: string }[]>`
    select id, category from ball_catalog where id = ${ballId}`;
  if (!ball) return json({ error: 'Ball not found' }, 400);

  // Standard balls follow the current streak tier; achievement balls must be unlocked.
  let ballAllowed: boolean;
  if (ball.category === 'standard') {
    ballAllowed = getStreakTierBall(await currentStreak(user.id)) === ballId;
  } else {
    const [unlock] = await sql`select 1 from ball_unlocks where user_id = ${user.id} and ball_id = ${ballId}`;
    ballAllowed = !!unlock;
  }
  if (!ballAllowed) return json({ error: 'Ball not available' }, 400);

  const updated = await sql`update profiles set display_ball = ${ballId} where id = ${user.id} returning id`;
  if (updated.length === 0) return json({ error: 'Profile not found' }, 404);

  return json({ display_ball: ballId }, 200);
}
