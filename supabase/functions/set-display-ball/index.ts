import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';

function getStreakTierBall(streak: number): string {
  if (streak >= 14) return 'master-ball';
  if (streak >= 7) return 'ultra-ball';
  if (streak >= 3) return 'great-ball';
  return 'poke-ball';
}

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
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  try {
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = user.id;

    const rateLimit = await checkRateLimit(supabaseAdmin, `set-display-ball:user:${userId}`, 10, 60);
    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded', retry_after: rateLimit.retryAfter }),
        {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(rateLimit.retryAfter) },
        }
      );
    }

    let body: { ball_id?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { ball_id } = body;
    if (!ball_id) {
      return new Response(JSON.stringify({ error: 'ball_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify ball exists in catalog
    const { data: ball } = await supabaseAdmin
      .from('ball_catalog')
      .select('id, category')
      .eq('id', ball_id)
      .single();

    if (!ball) {
      return new Response(JSON.stringify({ error: 'Ball not found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if user is allowed to use this ball
    let ballAllowed = false;

    if (ball.category === 'standard') {
      const { data: stats } = await supabaseAdmin
        .from('user_stats')
        .select('current_streak')
        .eq('user_id', userId)
        .single();
      const streak = stats?.current_streak ?? 0;
      ballAllowed = getStreakTierBall(streak) === ball_id;
    } else {
      const { data: unlock } = await supabaseAdmin
        .from('ball_unlocks')
        .select('ball_id')
        .match({ user_id: userId, ball_id })
        .single();
      ballAllowed = !!unlock;
    }

    if (!ballAllowed) {
      return new Response(JSON.stringify({ error: 'Ball not available' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: updatedProfile, error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ display_ball: ball_id })
      .eq('id', userId)
      .select('id')
      .maybeSingle();

    if (updateError) {
      throw updateError;
    }

    if (!updatedProfile) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(JSON.stringify({ fn: 'set-display-ball', method: req.method, user_id: userId, status: 200, duration_ms: Date.now() - start }));

    return new Response(
      JSON.stringify({ display_ball: ball_id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error(JSON.stringify({ fn: 'set-display-ball', error: String(err), status: 500 }));
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
