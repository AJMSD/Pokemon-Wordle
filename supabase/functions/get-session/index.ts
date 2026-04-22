import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { markMissedSessions } from '../_shared/missedDay.ts';

function getClientIP(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const url = new URL(req.url);
    const puzzle_date_key = url.searchParams.get('puzzle_date_key');
    const guest_id = url.searchParams.get('guest_id');

    if (!puzzle_date_key) {
      return new Response(JSON.stringify({ error: 'Missing puzzle_date_key' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Resolve identity
    let userId: string | null = null;
    const authHeader = req.headers.get('Authorization');

    if (authHeader) {
      const supabaseUser = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user } } = await supabaseUser.auth.getUser();
      userId = user?.id ?? null;
    }

    const isGuest = !userId;
    if (isGuest && !guest_id) {
      return new Response(JSON.stringify({ error: 'guest_id required for unauthenticated requests' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Rate limit: 30 req/min
    const rateLimitKey = userId
      ? `get-session:user:${userId}`
      : `get-session:ip:${getClientIP(req)}`;

    const { allowed, retryAfter } = await checkRateLimit(supabaseAdmin, rateLimitKey, 30, 60);
    if (!allowed) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded', retry_after: retryAfter }),
        {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) },
        }
      );
    }

    // Mark any stale sessions as missed
    await markMissedSessions(supabaseAdmin, userId, isGuest ? guest_id : null, puzzle_date_key);

    // Load puzzle
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
    const sessionFilter = isGuest ? { guest_id } : { user_id: userId };

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

    // Build revealed hints
    const hints: Record<string, unknown> = {};
    if (session.hint_flags.ability) hints.ability = puzzle.pokemon_data.ability;
    if (session.hint_flags.generation) hints.generation = puzzle.pokemon_data.generation;
    if (session.hint_flags.type) hints.types = puzzle.pokemon_data.types;

    const responseBody: Record<string, unknown> = {
      guesses: session.guesses,
      hint_flags: session.hint_flags,
      hints,
      completion_state: session.completion_state,
      version: session.version,
      puzzle_metadata: {
        name_length: (puzzle.pokemon_name as string).replace(/[^a-z]/gi, '').length,
      },
    };

    if (session.completion_state !== 'playing') {
      responseBody.pokemon_name = puzzle.pokemon_name;
    }

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('get-session error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
