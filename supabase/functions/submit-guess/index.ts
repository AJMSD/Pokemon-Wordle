import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { getAuthUser, jwtSubject } from '../_shared/auth.ts';
import { ensureSessionTarget, resolveTarget, revealedHints, targetColumns } from '../_shared/target.ts';
import { checkBallUnlocks } from '../../../src/logic/ballLogic.ts';
import { calcWinStreak, calcParticipationStreak, calcWinsAfterLoss } from '../../../src/logic/streakLogic.ts';
import { isStaleSession } from '../../../src/logic/staleDeviceCheck.ts';
import { POKEMON_NAMES } from '../../../src/data/pokemonNames.ts';

// Inserts the balls in one statement; returns only the ones that were new.
async function awardBalls(
  supabaseAdmin: SupabaseClient,
  userId: string,
  ballIds: string[]
): Promise<string[]> {
  if (ballIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('ball_unlocks')
    .upsert(
      ballIds.map(ball_id => ({ user_id: userId, ball_id })),
      { onConflict: 'user_id,ball_id', ignoreDuplicates: true }
    )
    .select('ball_id');
  if (error) {
    console.error(JSON.stringify({ fn: 'submit-guess', event: 'award_balls_failed', error: error.message }));
    return [];
  }
  return (data ?? []).map((row: { ball_id: string }) => row.ball_id);
}

const MAX_GUESSES = 10;
const HINT_THRESHOLDS = { ability: 3, generation: 6, type: 9 };

// Bundled list (same normalization as the client), so validation never waits on PokéAPI.
const POKEMON_NAME_SET = new Set(POKEMON_NAMES);

function getClientIP(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(
      /-mega$|-gmax$|-alola$|-galar$|-hisui$|-paldea$|-green-plumage$|-incarnate$|-f$|-m$|-shield$|-single-strike$|-normal$|-plant$|-altered$|-land$|-red-striped$|-standard$|-ordinary$|-aria$|-male$|-average$|-50$|-baile$|-midday$|-solo$|-red-meteor$|-disguised$|-amped$|-full-belly$|-family-of-four$|-zero$|-curly$|-two-segment$|-ice$/,
      ''
    );
}

function getYesterdayJST(): string {
  return new Date(Date.now() + 9 * 3600 * 1000 - 24 * 3600 * 1000).toISOString().slice(0, 10);
}

function json(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extraHeaders },
  });
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

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

    if (!guess || !puzzle_date_key) {
      return json({ error: 'Missing required fields' }, 400);
    }

    // Only today's puzzle (JST) can be played; prevents replaying past days to farm stats.
    const todayKey = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    if (puzzle_date_key !== todayKey) {
      return json({ error: "This puzzle has ended. Refresh for today's Pokémon." }, 400);
    }

    // The token's subject lets the session load start alongside getUser().
    const authHeader = req.headers.get('Authorization');
    const userId = jwtSubject(authHeader);
    const isGuest = !userId;
    if (isGuest && !guest_id) {
      return json({ error: 'guest_id required for unauthenticated requests' }, 400);
    }

    const sessionFilter = isGuest ? { guest_id: guest_id } : { user_id: userId };

    // Rate limit: 10 guesses/minute per user; guests are keyed by IP, which many
    // players can share (mobile CGNAT, schools), so they get a larger bucket.
    const rateLimitKey = userId
      ? `submit-guess:user:${userId}`
      : `submit-guess:ip:${getClientIP(req)}`;

    const [user, rateLimit, sessionResult] = await Promise.all([
      userId ? getAuthUser(authHeader) : Promise.resolve(null),
      checkRateLimit(supabaseAdmin, rateLimitKey, userId ? 10 : 30, 60),
      supabaseAdmin
        .from('daily_sessions')
        .select('*')
        .match({ ...sessionFilter, puzzle_date_key })
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
    const target = await resolveTarget(supabaseAdmin, puzzle_date_key, userId ?? guest_id, session);

    if (!session) {
      const { data: newSession } = await supabaseAdmin
        .from('daily_sessions')
        .insert({
          ...sessionFilter,
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
          .match({ ...sessionFilter, puzzle_date_key })
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

    // Validate it's a real Pokémon
    if (!POKEMON_NAME_SET.has(normalizedGuess)) {
      return json({ error: 'Not a valid Pokémon name' }, 400);
    }

    const newGuesses = [...session.guesses, normalizedGuess];
    const isCorrect = normalizedGuess === normalizeName(target.name);
    const isExhausted = newGuesses.length >= MAX_GUESSES;

    let completionState: 'playing' | 'won' | 'lost' = 'playing';
    if (isCorrect) completionState = 'won';
    else if (isExhausted) completionState = 'lost';

    // Update hint flags
    const hintFlags = { ...session.hint_flags };
    if (newGuesses.length >= HINT_THRESHOLDS.ability) hintFlags.ability = true;
    if (newGuesses.length >= HINT_THRESHOLDS.generation) hintFlags.generation = true;
    if (newGuesses.length >= HINT_THRESHOLDS.type) hintFlags.type = true;

    const newVersion = session.version + 1;

    // Guarded on the version we read, so a concurrent submit can't be overwritten.
    const { data: updated } = await supabaseAdmin
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

    if (!updated || updated.length === 0) {
      return json({ error: 'stale_session' }, 409);
    }

    const ballsToAward: string[] = [];
    const tracksStats = !isGuest && userId && isVerified;

    // Participation stat: increment on first guess of the day (auth + verified only)
    if (tracksStats && session.guesses.length === 0) {
      const [{ data: stats }, { data: profile }] = await Promise.all([
        supabaseAdmin.from('user_stats').select('*').eq('user_id', userId).single(),
        supabaseAdmin.from('profiles').select('id').eq('id', userId).maybeSingle(),
      ]);

      if (stats && stats.last_participation_date !== puzzle_date_key) {
        const yesterdayJST = getYesterdayJST();
        const partStreak = calcParticipationStreak(
          stats.last_participation_date ?? '',
          yesterdayJST,
          stats.participation_streak ?? 0
        );

        // Net Ball: track Water/Bug-type days
        const types: string[] = target.data.types ?? [];
        const isWaterOrBug = types.some(t => t === 'water' || t === 'bug');
        const newWaterBugCount = (stats.water_bug_daily_wins ?? 0) + (isWaterOrBug ? 1 : 0);

        await supabaseAdmin.from('user_stats').update({
          total_participations: (stats.total_participations ?? 0) + 1,
          participation_streak: partStreak,
          max_participation_streak: Math.max(stats.max_participation_streak ?? 0, partStreak),
          last_participation_date: puzzle_date_key,
          ...(isWaterOrBug ? { water_bug_daily_wins: newWaterBugCount } : {}),
        }).eq('user_id', userId);

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

    // On completion, archive result and update stats (auth + verified users only)
    if (completionState !== 'playing' && tracksStats) {
      const [, { data: stats }] = await Promise.all([
        supabaseAdmin.from('daily_results').upsert({
          user_id: userId,
          puzzle_date_key,
          pokemon_name: target.name,
          guesses: newGuesses,
          guess_count: newGuesses.length,
          result: completionState,
        }),
        supabaseAdmin.from('user_stats').select('*').eq('user_id', userId).single(),
      ]);

      let newWinsAfterLoss = 0;

      if (stats) {
        const gamesWon = (stats.games_won ?? 0) + (completionState === 'won' ? 1 : 0);
        const totalLosses = (stats.total_losses ?? 0) + (completionState === 'lost' ? 1 : 0);
        const dist = { ...stats.guess_distribution };
        if (completionState === 'won') {
          const key = String(newGuesses.length);
          dist[key] = (dist[key] ?? 0) + 1;
        }

        const yesterdayJST = getYesterdayJST();
        const currentStreak = calcWinStreak(
          stats.last_played_date ?? '',
          yesterdayJST,
          stats.current_streak ?? 0,
          completionState === 'won'
        );
        const maxStreak = Math.max(stats.max_streak ?? 0, currentStreak);

        newWinsAfterLoss = calcWinsAfterLoss(
          stats.wins_after_loss_streak ?? 0,
          completionState === 'won'
        );

        await supabaseAdmin.from('user_stats').update({
          games_won: gamesWon,
          total_losses: totalLosses,
          current_streak: currentStreak,
          max_streak: maxStreak,
          last_played_date: puzzle_date_key,
          guess_distribution: dist,
          wins_after_loss_streak: newWinsAfterLoss,
        }).eq('user_id', userId);
      }

      ballsToAward.push(...checkBallUnlocks({
        completionState,
        guessCount: newGuesses.length,
        partStreak: 0,
        waterBugCount: 0,
        isWaterOrBug: false,
        winsAfterLoss: newWinsAfterLoss,
        hasProfile: false,
      }));
    }

    const newlyUnlocked = tracksStats
      ? await awardBalls(supabaseAdmin, userId!, [...new Set(ballsToAward)])
      : [];

    // Return answer only when game is complete
    const responseBody: Record<string, unknown> = {
      guesses: newGuesses,
      hint_flags: hintFlags,
      hints: revealedHints(hintFlags, target.data),
      completion_state: completionState,
      version: newVersion,
    };

    if (completionState !== 'playing') {
      responseBody.pokemon_name = target.name;
    }

    responseBody.newly_unlocked_balls = newlyUnlocked;

    console.log(JSON.stringify({ fn: 'submit-guess', method: req.method, user_id: userId, status: 200, duration_ms: Date.now() - start }));

    return json(responseBody, 200);
  } catch (err) {
    console.error(JSON.stringify({ fn: 'submit-guess', error: String(err), status: 500 }));
    return json({ error: 'Internal server error' }, 500);
  }
});
