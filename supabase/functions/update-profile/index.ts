import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const start = Date.now();

  if (req.method !== 'PATCH') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Authorization required' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabaseUser.auth.getUser();

    if (!user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rateLimit = await checkRateLimit(supabaseAdmin, `update-profile:user:${user.id}`, 10, 60);
    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded', retry_after: rateLimit.retryAfter }),
        {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(rateLimit.retryAfter) },
        }
      );
    }

    const body = await req.json();
    const { avatar_mode, avatar_pokemon_id, avatar_form_id, avatar_is_shiny } = body;

    if (avatar_mode !== undefined && avatar_mode !== 'default' && avatar_mode !== 'pokemon') {
      return new Response(
        JSON.stringify({ error: 'avatar_mode must be "default" or "pokemon"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (avatar_pokemon_id !== undefined) {
      const id = Number(avatar_pokemon_id);
      if (!Number.isInteger(id) || id < 1 || id > 1010) {
        return new Response(
          JSON.stringify({ error: 'avatar_pokemon_id must be an integer between 1 and 1010' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    if (avatar_is_shiny !== undefined && typeof avatar_is_shiny !== 'boolean') {
      return new Response(
        JSON.stringify({ error: 'avatar_is_shiny must be a boolean' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('profiles')
      .select('avatar_config')
      .eq('id', user.id)
      .single();

    if (fetchError || !existing) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const current = (existing.avatar_config ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (avatar_mode !== undefined) patch.avatar_mode = avatar_mode;
    if (avatar_pokemon_id !== undefined) patch.avatar_pokemon_id = Number(avatar_pokemon_id);
    if (avatar_form_id !== undefined) patch.avatar_form_id = avatar_form_id;
    if (avatar_is_shiny !== undefined) patch.avatar_is_shiny = avatar_is_shiny;

    const merged = { ...current, ...patch };

    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ avatar_config: merged })
      .eq('id', user.id);

    if (updateError) throw updateError;

    console.log(JSON.stringify({ fn: 'update-profile', method: req.method, user_id: user.id, status: 200, duration_ms: Date.now() - start }));

    return new Response(JSON.stringify({ avatar_config: merged }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(JSON.stringify({ fn: 'update-profile', error: String(err), status: 500 }));
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
