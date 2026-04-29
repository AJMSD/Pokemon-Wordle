import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { checkBallUnlocks } from '../../../src/logic/ballLogic.ts';
import { calcWinStreak, calcParticipationStreak, calcWinsAfterLoss } from '../../../src/logic/streakLogic.ts';
import { isStaleSession } from '../../../src/logic/staleDeviceCheck.ts';

async function awardBall(
  supabaseAdmin: SupabaseClient,
  userId: string,
  ballId: string
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('ball_unlocks')
    .insert({ user_id: userId, ball_id: ballId });
  return !error; // false if already unlocked (unique violation)
}

const MAX_GUESSES = 10;
const HINT_THRESHOLDS = { ability: 3, generation: 6, type: 9 };

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

let pokemonAllowlistPromise: Promise<Set<string> | null> | null = null;

async function loadPokemonAllowlist(): Promise<Set<string> | null> {
  try {
    const res = await fetch('https://pokeapi.co/api/v2/pokemon?limit=1025');
    if (!res.ok) return null;
    const data = await res.json();
    const names = Array.isArray(data?.results)
      ? data.results
          .map((entry: { name?: string }) => normalizeName(entry?.name ?? ''))
          .filter(Boolean)
      : [];
    return new Set(names);
  } catch {
    return null;
  }
}

async function getPokemonAllowlist(): Promise<Set<string> | null> {
  if (!pokemonAllowlistPromise) {
    pokemonAllowlistPromise = loadPokemonAllowlist();
  }

  const allowlist = await pokemonAllowlistPromise;
  if (!allowlist) {
    // Retry on later request when the warmup fetch fails.
    pokemonAllowlistPromise = null;
  }
  return allowlist;
}

async function isValidPokemon(name: string): Promise<boolean> {
  const allowlist = await getPokemonAllowlist();
  // Don't reject valid guesses due to upstream list outages.
  if (!allowlist) return true;
  return allowlist.has(name);
}

function getTodayJST(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function getYesterdayJST(): string {
  return new Date(Date.now() + 9 * 3600 * 1000 - 24 * 3600 * 1000).toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
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
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Determine caller identity and verification status
    let userId: string | null = null;
    let isVerified = false;
    const authHeader = req.headers.get('Authorization');

    if (authHeader) {
      const supabaseUser = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user } } = await supabaseUser.auth.getUser();
      userId = user?.id ?? null;
      isVerified = !!user?.email_confirmed_at;
    }

    const isGuest = !userId;
    if (isGuest && !guest_id) {
      return new Response(JSON.stringify({ error: 'guest_id required for unauthenticated requests' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Rate limit: 10 guesses/minute per user/guest
    const rateLimitKey = userId
      ? `submit-guess:user:${userId}`
      : `submit-guess:ip:${getClientIP(req)}`;

    const { allowed, retryAfter } = await checkRateLimit(supabaseAdmin, rateLimitKey, 10, 60);
    if (!allowed) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded', retry_after: retryAfter }),
        {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) },
        }
      );
    }

    // Load today's puzzle
    const { data: puzzle } = await supabaseAdmin
      .from('daily_puzzles')
      .select('id, pokemon_name, pokemon_data')
      .eq('puzzle_date_key', puzzle_date_key)
      .single();

    if (!puzzle) {
      return new Response(JSON.stringify({ error: 'Puzzle not found for date' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load or create session
    const sessionFilter = isGuest
      ? { guest_id: guest_id }
      : { user_id: userId };

    let { data: session } = await supabaseAdmin
      .from('daily_sessions')
      .select('*')
      .match({ ...sessionFilter, puzzle_date_key })
      .single();

    if (!session) {
      const { data: newSession } = await supabaseAdmin
        .from('daily_sessions')
        .insert({
          ...sessionFilter,
          puzzle_date_key,
          puzzle_id: puzzle.id,
          guesses: [],
          hint_flags: { ability: false, generation: false, type: false },
          completion_state: 'playing',
          version: 1,
        })
        .select()
        .single();
      session = newSession;
    }

    // Optimistic concurrency check
    if (isStaleSession(session_version, session.version)) {
      return new Response(
        JSON.stringify({ error: 'stale_session', current_version: session.version }),
        {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Reject if game already complete
    if (session.completion_state !== 'playing') {
      return new Response(
        JSON.stringify({ error: 'Game already completed', completion_state: session.completion_state }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const newlyUnlocked: string[] = [];

    // Participation stat: increment on first guess of the day (auth + verified only)
    if (!isGuest && userId && isVerified && session.guesses.length === 0) {
      const { data: stats } = await supabaseAdmin
        .from('user_stats')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (stats && stats.last_participation_date !== puzzle_date_key) {
        const yesterdayJST = getYesterdayJST();
        const partStreak = calcParticipationStreak(
          stats.last_participation_date ?? '',
          yesterdayJST,
          stats.participation_streak ?? 0
        );

        // Net Ball: track Water/Bug-type days
        const types: string[] = (puzzle.pokemon_data as { types?: string[] }).types ?? [];
        const isWaterOrBug = types.some(t => t === 'water' || t === 'bug');
        const newWaterBugCount = (stats.water_bug_daily_wins ?? 0) + (isWaterOrBug ? 1 : 0);

        await supabaseAdmin.from('user_stats').update({
          total_participations: (stats.total_participations ?? 0) + 1,
          participation_streak: partStreak,
          max_participation_streak: Math.max(stats.max_participation_streak ?? 0, partStreak),
          last_participation_date: puzzle_date_key,
          ...(isWaterOrBug ? { water_bug_daily_wins: newWaterBugCount } : {}),
        }).eq('user_id', userId);

        const { data: profile } = partStreak >= 7
          ? await supabaseAdmin.from('profiles').select('user_id').eq('user_id', userId).single()
          : { data: null };

        const participationBalls = checkBallUnlocks({
          completionState: 'playing',
          guessCount: 0,
          partStreak,
          waterBugCount: newWaterBugCount,
          isWaterOrBug,
          winsAfterLoss: 0,
          hasProfile: !!profile,
        });
        for (const ball of participationBalls) {
          if (await awardBall(supabaseAdmin, userId, ball)) newlyUnlocked.push(ball);
        }
      }
    }

    const normalizedGuess = normalizeName(guess);

    // Validate duplicate
    if (session.guesses.includes(normalizedGuess)) {
      return new Response(JSON.stringify({ error: 'Duplicate guess' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate it's a real Pokémon
    const valid = await isValidPokemon(normalizedGuess);
    if (!valid) {
      return new Response(JSON.stringify({ error: 'Not a valid Pokémon name' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const newGuesses = [...session.guesses, normalizedGuess];
    const isCorrect = normalizedGuess === normalizeName(puzzle.pokemon_name);
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

    await supabaseAdmin
      .from('daily_sessions')
      .update({
        guesses: newGuesses,
        hint_flags: hintFlags,
        completion_state: completionState,
        version: newVersion,
      })
      .match({ ...sessionFilter, puzzle_date_key });

    // On completion, archive result and update stats (auth + verified users only)
    if (completionState !== 'playing' && !isGuest && userId && isVerified) {
      await supabaseAdmin.from('daily_results').upsert({
        user_id: userId,
        puzzle_date_key,
        pokemon_name: puzzle.pokemon_name,
        guesses: newGuesses,
        guess_count: newGuesses.length,
        result: completionState,
      });

      const { data: stats } = await supabaseAdmin
        .from('user_stats')
        .select('*')
        .eq('user_id', userId)
        .single();

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

      const completionBalls = checkBallUnlocks({
        completionState,
        guessCount: newGuesses.length,
        partStreak: 0,
        waterBugCount: 0,
        isWaterOrBug: false,
        winsAfterLoss: newWinsAfterLoss,
        hasProfile: false,
      });
      for (const ball of completionBalls) {
        if (await awardBall(supabaseAdmin, userId, ball)) newlyUnlocked.push(ball);
      }
    }

    // Build hints to return based on revealed flags
    const hints: Record<string, unknown> = {};
    if (hintFlags.ability) hints.ability = puzzle.pokemon_data.ability;
    if (hintFlags.generation) hints.generation = puzzle.pokemon_data.generation;
    if (hintFlags.type) hints.types = puzzle.pokemon_data.types;

    // Return answer only when game is complete
    const responseBody: Record<string, unknown> = {
      guesses: newGuesses,
      hint_flags: hintFlags,
      hints,
      completion_state: completionState,
      version: newVersion,
    };

    if (completionState !== 'playing') {
      responseBody.pokemon_name = puzzle.pokemon_name;
    }

    responseBody.newly_unlocked_balls = newlyUnlocked;

    console.log(JSON.stringify({ fn: 'submit-guess', method: req.method, user_id: userId, status: 200, duration_ms: Date.now() - start }));

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(JSON.stringify({ fn: 'submit-guess', error: String(err), status: 500 }));
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
