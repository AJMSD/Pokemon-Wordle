import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';

const BLOCKED = ['fuck', 'shit', 'bitch', 'cunt', 'nigger', 'faggot', 'retard'];
const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_]{1,18}[a-zA-Z0-9]$|^[a-zA-Z0-9]{3}$/;

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

    const rateLimit = await checkRateLimit(supabaseAdmin, `create-profile:user:${user.id}`, 5, 3600);
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
    const username: string = (body.username ?? '').trim();

    if (username.length < 3 || username.length > 20) {
      return new Response(JSON.stringify({ error: 'Username must be 3–20 characters' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!USERNAME_RE.test(username)) {
      return new Response(
        JSON.stringify({ error: 'Username may only contain letters, numbers, and underscores' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const lower = username.toLowerCase();
    if (BLOCKED.some(w => lower.includes(w))) {
      return new Response(JSON.stringify({ error: 'Username not allowed' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: insertError } = await supabaseAdmin.from('profiles').insert({
      id: user.id,
      username,
      display_ball: 'poke-ball',
    });

    if (insertError) {
      const isUnique = insertError.code === '23505' || insertError.message?.includes('unique');
      if (isUnique) {
        return new Response(JSON.stringify({ error: 'Username already taken' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw insertError;
    }

    console.log(JSON.stringify({ fn: 'create-profile', method: req.method, user_id: user.id, status: 200, duration_ms: Date.now() - start }));

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(JSON.stringify({ fn: 'create-profile', error: String(err), status: 500 }));
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
