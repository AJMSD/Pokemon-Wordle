import { jsonb, sql } from '../db.ts';
import { rateLimited, readJson, todayKeyJST, type Ctx } from '../http.ts';
import { getAuthUser } from '../auth/session.ts';
import { checkRateLimit } from '../shared/rateLimit.ts';
import { ensureSessionTarget, resolveTarget, revealedHints } from '../shared/target.ts';
import { checkBallUnlocks } from '../../src/logic/ballLogic.ts';
import { calcParticipationStreak } from '../../src/logic/streakLogic.ts';
import { isStaleSession } from '../../src/logic/staleDeviceCheck.ts';
import { normalizeName } from '../shared/letterMatch.ts';
import { MAX_GUESSES, hintFlagsFor, isValidPokemonName } from '../shared/migrateGuest.ts';
import { buildSessionResponse } from '../shared/sessionResponse.ts';
import { awardBalls, getYesterdayJST, recordCompletion } from '../shared/completion.ts';
import { getClientIP, guestSessionAllowed } from '../shared/guestLimit.ts';
import { identifyPlayer, rateLimitKey, targetSeed } from '../shared/player.ts';
import { findSession, getOrCreateSession } from '../shared/sessions.ts';

interface ParticipationStats {
  last_participation_date: string | null;
  participation_streak: number | null;
  max_participation_streak: number | null;
  total_participations: number | null;
  water_bug_daily_wins: number | null;
}

// POST /v1/submit-guess {guess, session_version, puzzle_date_key, guest_id?}
export async function submitGuess({ req, json }: Ctx): Promise<Response> {
  const body = await readJson(req);
  const { guess, session_version, puzzle_date_key, guest_id } = body ?? {};

  if (!guess || typeof guess !== 'string' || !puzzle_date_key || typeof puzzle_date_key !== 'string') {
    return json({ error: 'Missing required fields' }, 400);
  }

  // Only today's puzzle (JST) can be played; prevents replaying past days to farm stats.
  if (puzzle_date_key !== todayKeyJST()) {
    return json({ error: "This puzzle has ended. Refresh for today's Pokémon." }, 400);
  }

  // Signed-in players by session token; guests by their guest_id.
  const user = await getAuthUser(req);
  if (user === 'invalid') return json({ error: 'Invalid or expired token' }, 401);
  const player = identifyPlayer(user?.id ?? null, guest_id);
  if (!player) {
    return json({ error: 'Authorization required' }, 401);
  }
  const userId = player.kind === 'user' ? player.id : null;
  const isVerified = !!user?.email_verified_at;

  // Rate limit: 10 guesses/minute per player.
  const [rateLimit, existing] = await Promise.all([
    checkRateLimit(sql, rateLimitKey('submit-guess', player), 10, 60),
    findSession(sql, player, puzzle_date_key),
  ]);
  if (!rateLimit.allowed) return rateLimited(json, rateLimit.retryAfter);

  const target = await resolveTarget(sql, puzzle_date_key, targetSeed(player), existing);

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

  // Optimistic concurrency check
  if (isStaleSession(session_version as number, session.version)) {
    return json({ error: 'stale_session', current_version: session.version }, 409);
  }

  // Reject if game already complete
  if (session.completion_state !== 'playing') {
    return json({ error: 'Game already completed', completion_state: session.completion_state }, 400);
  }

  const normalizedGuess = normalizeName(guess);

  // Validate duplicate
  if (session.guesses.includes(normalizedGuess)) {
    return json({ error: 'Duplicate guess' }, 400);
  }

  // Validate it's a real Pokémon (bundled list, never waits on PokéAPI)
  if (!isValidPokemonName(normalizedGuess)) {
    return json({ error: 'Not a valid Pokémon name' }, 400);
  }

  const newGuesses = [...session.guesses, normalizedGuess];
  const isCorrect = normalizedGuess === normalizeName(target.name);
  const isExhausted = newGuesses.length >= MAX_GUESSES;

  let completionState: 'playing' | 'won' | 'lost' = 'playing';
  if (isCorrect) completionState = 'won';
  else if (isExhausted) completionState = 'lost';

  const hintFlags = hintFlagsFor(newGuesses.length, session.hint_flags);

  const newVersion = session.version + 1;

  // Guarded on the version we read, so a concurrent submit can't be overwritten.
  const updated = await sql`
    update daily_sessions set
      guesses = ${newGuesses}::text[],
      hint_flags = ${jsonb(hintFlags)},
      completion_state = ${completionState},
      version = ${newVersion}
    where id = ${session.id} and version = ${session.version}
    returning id`;

  if (updated.length === 0) {
    return json({ error: 'stale_session' }, 409);
  }

  const ballsToAward: string[] = [];
  // Stats, streaks and balls only exist for verified accounts.
  const tracksStats = userId !== null && isVerified;

  // Participation stat: increment on first guess of the day (verified only)
  if (tracksStats && userId && session.guesses.length === 0) {
    const [[stats], [profile]] = await Promise.all([
      sql<ParticipationStats[]>`
        select last_participation_date, participation_streak, max_participation_streak,
               total_participations, water_bug_daily_wins
        from user_stats where user_id = ${userId}`,
      sql`select id from profiles where id = ${userId}`,
    ]);

    if (stats && stats.last_participation_date !== puzzle_date_key) {
      const partStreak = calcParticipationStreak(
        stats.last_participation_date ?? '',
        getYesterdayJST(),
        stats.participation_streak ?? 0
      );

      // Net Ball: track Water/Bug-type days
      const types: string[] = target.data.types ?? [];
      const isWaterOrBug = types.some(t => t === 'water' || t === 'bug');
      const newWaterBugCount = (stats.water_bug_daily_wins ?? 0) + (isWaterOrBug ? 1 : 0);

      try {
        await sql`
          update user_stats set
            total_participations = ${(stats.total_participations ?? 0) + 1},
            participation_streak = ${partStreak},
            max_participation_streak = ${Math.max(stats.max_participation_streak ?? 0, partStreak)},
            last_participation_date = ${puzzle_date_key},
            water_bug_daily_wins = ${newWaterBugCount}
          where user_id = ${userId}`;
        ballsToAward.push(...checkBallUnlocks({
          completionState: 'playing',
          guessCount: 0,
          partStreak,
          waterBugCount: newWaterBugCount,
          isWaterOrBug,
          winsAfterLoss: 0,
          hasProfile: partStreak >= 7 && !!profile,
        }));
      } catch (err) {
        console.error(JSON.stringify({ fn: 'submit-guess', event: 'participation_update_failed', error: String(err) }));
      }
    }
  }

  // On completion, archive the result once and update stats (verified users only).
  // The session is already committed, so a failure here is logged and repaired
  // by the next get-session rather than failing the guess.
  if (completionState !== 'playing' && tracksStats && userId) {
    try {
      ballsToAward.push(...await recordCompletion({
        userId,
        puzzleDateKey: puzzle_date_key,
        targetName: target.name,
        guesses: newGuesses,
        state: completionState,
      }));
    } catch (err) {
      console.error(JSON.stringify({ fn: 'submit-guess', event: 'record_completion_failed', error: String(err) }));
    }
  }

  const newlyUnlocked = tracksStats && userId
    ? await awardBalls(sql, userId, [...new Set(ballsToAward)])
    : [];

  const responseBody = buildSessionResponse(
    {
      guesses: newGuesses,
      hint_flags: hintFlags,
      completion_state: completionState,
      version: newVersion,
    },
    target,
    revealedHints(hintFlags, target.data)
  );
  responseBody.newly_unlocked_balls = newlyUnlocked;

  return json(responseBody, 200);
}
