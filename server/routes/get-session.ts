import { sql } from '../db.ts';
import { rateLimited, todayKeyJST, type Ctx } from '../http.ts';
import { getAuthUser } from '../auth/session.ts';
import { checkRateLimit } from '../shared/rateLimit.ts';
import { markMissedSessions } from '../shared/missedDay.ts';
import { ensureSessionTarget, resolveTarget, revealedHints } from '../shared/target.ts';
import { buildSessionResponse } from '../shared/sessionResponse.ts';
import { awardBalls, recordCompletion } from '../shared/completion.ts';
import { getClientIP, guestSessionAllowed } from '../shared/guestLimit.ts';
import { identifyPlayer, rateLimitKey, targetSeed } from '../shared/player.ts';
import { findSession, getOrCreateSession } from '../shared/sessions.ts';

// GET /v1/get-session?puzzle_date_key=YYYY-MM-DD[&guest_id=...]
export async function getSession({ req, url, json }: Ctx): Promise<Response> {
  const puzzle_date_key = url.searchParams.get('puzzle_date_key');
  if (!puzzle_date_key) {
    return json({ error: 'Missing puzzle_date_key' }, 400);
  }

  // Sessions (and their targets) are only created for today's JST puzzle.
  if (puzzle_date_key !== todayKeyJST()) {
    return json({ error: "This puzzle has ended. Refresh for today's Pokémon." }, 400);
  }

  // Signed-in players by session token; guests by their guest_id.
  const user = await getAuthUser(req);
  if (user === 'invalid') return json({ error: 'Invalid or expired token' }, 401);
  const player = identifyPlayer(user?.id ?? null, url.searchParams.get('guest_id'));
  if (!player) {
    return json({ error: 'Authorization required' }, 401);
  }
  const userId = player.kind === 'user' ? player.id : null;
  const isVerified = !!user?.email_verified_at;

  // Rate limit: 30 req/min
  const [rateLimit, existing] = await Promise.all([
    checkRateLimit(sql, rateLimitKey('get-session', player), 30, 60),
    findSession(sql, player, puzzle_date_key),
  ]);
  if (!rateLimit.allowed) return rateLimited(json, rateLimit.retryAfter);

  const [, target] = await Promise.all([
    // Mark any stale sessions as missed (streaks only exist for users)
    userId ? markMissedSessions(sql, userId, puzzle_date_key, isVerified) : null,
    resolveTarget(sql, puzzle_date_key, targetSeed(player), existing),
  ]);

  if (!existing && player.kind === 'guest' && !(await guestSessionAllowed(sql, getClientIP(req)))) {
    return json({ error: 'Too many new guest games from this network. Sign in to keep playing.' }, 429, { 'Retry-After': '3600' });
  }

  let session;
  if (existing) {
    session = existing;
    await ensureSessionTarget(sql, session, target);
  } else {
    session = await getOrCreateSession(sql, player, puzzle_date_key, target);
  }

  // Repair: a finished game by a verified user whose result/stats write failed
  // earlier. Only sessions the user actually played (guesses present) qualify;
  // recordCompletion is idempotent, so concurrent repairs credit once.
  if (
    userId &&
    isVerified &&
    (session.completion_state === 'won' || session.completion_state === 'lost') &&
    Array.isArray(session.guesses) && session.guesses.length > 0
  ) {
    const [result] = await sql`
      select 1 from daily_results where user_id = ${userId} and puzzle_date_key = ${puzzle_date_key}`;
    if (!result) {
      try {
        const balls = await recordCompletion({
          userId,
          puzzleDateKey: puzzle_date_key,
          targetName: target.name,
          guesses: session.guesses,
          state: session.completion_state,
        });
        await awardBalls(sql, userId, [...new Set(balls)]);
      } catch (err) {
        console.error(JSON.stringify({ fn: 'get-session', event: 'repair_failed', error: String(err) }));
      }
    }
  }

  return json(buildSessionResponse(session, target, revealedHints(session.hint_flags, target.data)), 200);
}
