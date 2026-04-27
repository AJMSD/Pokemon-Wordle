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

  const start = Date.now();

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

  try {
    const body = await req.json();
    const { puzzle_date_key, guest_id } = body;

    if (!puzzle_date_key) {
      return new Response(JSON.stringify({ error: 'Missing puzzle_date_key' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Resolve identity (auth optional)
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

    // Rate limit: 30 req/min
    const rateLimitKey = userId
      ? `refresh-state:user:${userId}`
      : `refresh-state:ip:${getClientIP(req)}`;

    const rateLimit = await checkRateLimit(supabaseAdmin, rateLimitKey, 30, 60);
    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded', retry_after: rateLimit.retryAfter }),
        {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(rateLimit.retryAfter) },
        }
      );
    }

    // Mark stale sessions as missed (same as get-session)
    await markMissedSessions(supabaseAdmin, userId, isGuest ? guest_id : null, puzzle_date_key, isVerified);

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

    // Load existing session only — refresh-state does not create sessions
    const sessionFilter = isGuest ? { guest_id } : { user_id: userId };

    const { data: session } = await supabaseAdmin
      .from('daily_sessions')
      .select('*')
      .match({ ...sessionFilter, puzzle_date_key })
      .single();

    if (!session) {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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

    console.log(JSON.stringify({ fn: 'refresh-state', method: req.method, user_id: userId, status: 200, duration_ms: Date.now() - start }));

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(JSON.stringify({ fn: 'refresh-state', error: String(err), status: 500 }));
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
