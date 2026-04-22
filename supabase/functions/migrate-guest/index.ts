import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

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

  try {
    // Require auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authorization required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabaseUser.auth.getUser();

    if (!user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { guest_id, puzzle_date_key } = body;

    if (!guest_id || !puzzle_date_key) {
      return new Response(JSON.stringify({ error: 'Missing guest_id or puzzle_date_key' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Only allow migrating today's session
    const todayKey = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    if (puzzle_date_key !== todayKey) {
      return new Response(JSON.stringify({ error: "Can only migrate today's session" }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load guest session
    const { data: guestSession } = await supabaseAdmin
      .from('daily_sessions')
      .select('*')
      .match({ guest_id, puzzle_date_key })
      .single();

    if (!guestSession) {
      return new Response(JSON.stringify({ error: 'Guest session not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check for existing user session today
    const { data: existingUserSession } = await supabaseAdmin
      .from('daily_sessions')
      .select('id')
      .match({ user_id: user.id, puzzle_date_key })
      .single();

    if (existingUserSession) {
      return new Response(JSON.stringify({ error: 'User already has a session today' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Insert migrated user session
    const { data: migratedSession } = await supabaseAdmin
      .from('daily_sessions')
      .insert({
        user_id: user.id,
        puzzle_date_key,
        puzzle_id: guestSession.puzzle_id,
        guesses: guestSession.guesses,
        hint_flags: guestSession.hint_flags,
        completion_state: guestSession.completion_state,
        version: 1,
      })
      .select()
      .single();

    // Delete guest session
    await supabaseAdmin
      .from('daily_sessions')
      .delete()
      .match({ guest_id, puzzle_date_key });

    // Load puzzle for response
    const { data: puzzle } = await supabaseAdmin
      .from('daily_puzzles')
      .select('pokemon_name, pokemon_data')
      .eq('puzzle_date_key', puzzle_date_key)
      .single();

    const hints: Record<string, unknown> = {};
    if (migratedSession!.hint_flags.ability) hints.ability = puzzle!.pokemon_data.ability;
    if (migratedSession!.hint_flags.generation) hints.generation = puzzle!.pokemon_data.generation;
    if (migratedSession!.hint_flags.type) hints.types = puzzle!.pokemon_data.types;

    const responseBody: Record<string, unknown> = {
      guesses: migratedSession!.guesses,
      hint_flags: migratedSession!.hint_flags,
      hints,
      completion_state: migratedSession!.completion_state,
      version: migratedSession!.version,
      puzzle_metadata: {
        name_length: (puzzle!.pokemon_name as string).replace(/[^a-z]/gi, '').length,
      },
    };

    if (migratedSession!.completion_state !== 'playing') {
      responseBody.pokemon_name = puzzle!.pokemon_name;
    }

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('migrate-guest error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
