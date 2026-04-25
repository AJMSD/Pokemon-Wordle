import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'GET') {
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

    const [profileResult, statsResult] = await Promise.all([
      supabaseAdmin.from('profiles').select('username, avatar_config, display_ball').eq('id', user.id).single(),
      supabaseAdmin.from('user_stats').select('*').eq('user_id', user.id).single(),
    ]);

    if (profileResult.error || !profileResult.data) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const profile = profileResult.data;
    const stats = statsResult.data;

    const totalParticipations = stats?.total_participations ?? 0;
    const totalWins = stats?.games_won ?? 0;
    const winRate = totalParticipations > 0
      ? Math.round((totalWins / totalParticipations) * 100) / 100
      : 0;

    let avgGuesses = 0;
    if (stats && totalWins > 0) {
      const dist: Record<string, number> = stats.guess_distribution ?? {};
      const totalGuesses = Object.entries(dist).reduce(
        (sum, [k, v]) => sum + Number(k) * v,
        0
      );
      avgGuesses = Math.round((totalGuesses / totalWins) * 10) / 10;
    }

    return new Response(
      JSON.stringify({
        user: {
          id: user.id,
          email: user.email,
          email_confirmed_at: user.email_confirmed_at,
        },
        profile: {
          username: profile.username,
          avatar_config: profile.avatar_config ?? {},
          display_ball: profile.display_ball,
        },
        stats: {
          current_streak: stats?.current_streak ?? 0,
          max_streak: stats?.max_streak ?? 0,
          total_participations: totalParticipations,
          total_wins: totalWins,
          win_rate: winRate,
          avg_guesses: avgGuesses,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    console.error('get-me error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
