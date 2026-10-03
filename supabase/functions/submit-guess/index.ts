import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleCors, jsonResponder } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { getAuthUser, jwtSubject } from '../_shared/auth.ts';
import { ensureSessionTarget, resolveTarget, revealedHints, targetColumns } from '../_shared/target.ts';
import { checkBallUnlocks } from '../../../src/logic/ballLogic.ts';
import { calcParticipationStreak } from '../../../src/logic/streakLogic.ts';
import { isStaleSession } from '../../../src/logic/staleDeviceCheck.ts';
import { normalizeName } from '../_shared/letterMatch.ts';
import { MAX_GUESSES, hintFlagsFor, isValidPokemonName } from '../_shared/migrateGuest.ts';
import { buildSessionResponse } from '../_shared/sessionResponse.ts';
import { awardBalls, getYesterdayJST, recordCompletion } from '../_shared/completion.ts';
import { getClientIP, guestSessionAllowed } from '../_shared/guestLimit.ts';
import { identifyPlayer, ownerOf, rateLimitKey, targetSeed } from '../_shared/player.ts';

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const json = jsonResponder(req);

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const start = Date.now();

  try {
    const body = await req.json();
    const { guess, session_version, puzzle_date_key, guest_id } = body;

    if (!guess || typeof guess !== 'string' || !puzzle_date_key) {
      return json({ error: 'Missing required fields' }, 400);
    }

    // Only today's puzzle (JST) can be played; prevents replaying past days to farm stats.
    const todayKey = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    if (puzzle_date_key !== todayKey) {
      return json({ error: "This puzzle has ended. Refresh for today's Pokémon." }, 400);
    }

    // Signed-in players by token subject (confirmed via getUser below);
    // guests by the anon key plus their guest_id.
    const authHeader = req.headers.get('Authorization');
    const player = identifyPlayer(jwtSubject(authHeader), guest_id);
    if (!player) {
      return json({ error: 'Authorization required' }, 401);
    }
    const userId = player.kind === 'user' ? player.id : null;
    const owner = ownerOf(player);

    // Rate limit: 10 guesses/minute per player.
    const [user, rateLimit, sessionResult] = await Promise.all([
      userId ? getAuthUser(authHeader) : Promise.resolve(null),
      checkRateLimit(supabaseAdmin, rateLimitKey('submit-guess', player), 10, 60),
      supabaseAdmin
        .from('daily_sessions')
        .select('*')
        .match({ ...owner, puzzle_date_key })
        .maybeSingle(),
    ]);

    if (userId && user?.id !== userId) {
      return json({ error: 'Invalid or expired token' }, 401);
    }
    const isVerified = !!user?.email_confirmed_at;

    if (!rateLimit.allowed) {
      return json(
        { error: 'Rate limit exceeded', retry_after: rateLimit.retryAfter },
        429,
        { 'Retry-After': String(rateLimit.retryAfter) }
      );
    }

    let session = sessionResult.data;
    const target = await resolveTarget(supabaseAdmin, puzzle_date_key, targetSeed(player), session);

    if (!session && player.kind === 'guest' && !(await guestSessionAllowed(supabaseAdmin, getClientIP(req)))) {
      return json({ error: 'Too many new guest games from this network. Sign in to keep playing.' }, 429, { 'Retry-After': '3600' });
    }

    if (!session) {
      const { data: newSession } = await supabaseAdmin
        .from('daily_sessions')
        .insert({
          ...owner,
          puzzle_date_key,
          ...targetColumns(target),
          guesses: [],
          hint_flags: { ability: false, generation: false, type: false },
          completion_state: 'playing',
          version: 1,
        })
        .select()
        .single();
      session = newSession;
      if (!session) {
        // Lost a create race with a concurrent request; use its row.
        ({ data: session } = await supabaseAdmin
          .from('daily_sessions')
          .select('*')
          .match({ ...owner, puzzle_date_key })
          .single());
      }
    } else {
      await ensureSessionTarget(supabaseAdmin, session, target);
    }

    // Optimistic concurrency check
    if (isStaleSession(session_version, session.version)) {
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
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('daily_sessions')
      .update({
        guesses: newGuesses,
        hint_flags: hintFlags,
        completion_state: completionState,
        version: newVersion,
      })
      .eq('id', session.id)
      .eq('version', session.version)
      .select('id');
    if (updateError) throw new Error(`session update: ${updateError.message}`);

    if (!updated || updated.length === 0) {
      return json({ error: 'stale_session' }, 409);
    }

    const ballsToAward: string[] = [];
    // Stats, streaks and balls only exist for verified accounts.
    const tracksStats = userId !== null && isVerified;

    // Participation stat: increment on first guess of the day (verified only)
    if (tracksStats && userId && session.guesses.length === 0) {
      const [{ data: stats }, { data: profile }] = await Promise.all([
        supabaseAdmin.from('user_stats').select('*').eq('user_id', userId).single(),
        supabaseAdmin.from('profiles').select('id').eq('id', userId).maybeSingle(),
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

        const { error: partError } = await supabaseAdmin.from('user_stats').update({
          total_participations: (stats.total_participations ?? 0) + 1,
          participation_streak: partStreak,
          max_participation_streak: Math.max(stats.max_participation_streak ?? 0, partStreak),
          last_participation_date: puzzle_date_key,
          ...(isWaterOrBug ? { water_bug_daily_wins: newWaterBugCount } : {}),
        }).eq('user_id', userId);
        if (partError) {
          console.error(JSON.stringify({ fn: 'submit-guess', event: 'participation_update_failed', error: partError.message }));
        } else {
          ballsToAward.push(...checkBallUnlocks({
            completionState: 'playing',
            guessCount: 0,
            partStreak,
            waterBugCount: newWaterBugCount,
            isWaterOrBug,
            winsAfterLoss: 0,
            hasProfile: partStreak >= 7 && !!profile,
          }));
        }
      }
    }

    // On completion, archive the result once and update stats (verified users only).
    // The session is already committed, so a failure here is logged and repaired
    // by the next get-session rather than failing the guess.
    if (completionState !== 'playing' && tracksStats && userId) {
      try {
        ballsToAward.push(...await recordCompletion(supabaseAdmin, {
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
      ? await awardBalls(supabaseAdmin, userId, [...new Set(ballsToAward)])
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

    console.log(JSON.stringify({ fn: 'submit-guess', method: req.method, player: player.kind, user_id: userId, status: 200, duration_ms: Date.now() - start }));

    return json(responseBody, 200);
  } catch (err) {
    console.error(JSON.stringify({ fn: 'submit-guess', error: String(err), status: 500 }));
    return json({ error: 'Internal server error' }, 500);
  }
});
