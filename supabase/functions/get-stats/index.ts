import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';

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

  const start = Date.now();

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

    if (!user.email_confirmed_at) {
      return new Response(JSON.stringify({ error: 'Email not verified' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rateLimitKey = `get-stats:user:${user.id}`;
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

    const { data: stats, error } = await supabaseAdmin
      .from('user_stats')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (error || !stats) {
      return new Response(JSON.stringify({ error: 'Stats not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const totalParticipations = stats.total_participations ?? 0;
    const gamesWon = stats.games_won ?? 0;
    const dist: Record<string, number> = stats.guess_distribution ?? {};

    const winRatePercent = totalParticipations > 0
      ? Math.round(gamesWon / totalParticipations * 100)
      : 0;

    let avgGuessesToWin: number | null = null;
    if (gamesWon > 0) {
      const totalGuesses = Object.entries(dist).reduce(
        (sum, [k, v]) => sum + Number(k) * v,
        0
      );
      avgGuessesToWin = Math.round((totalGuesses / gamesWon) * 10) / 10;
    }

    let bestGuessSummary: string | null = null;
    const minKey = Object.entries(dist)
      .filter(([, v]) => v > 0)
      .sort(([a], [b]) => Number(a) - Number(b))
      .at(0);
    if (minKey) {
      bestGuessSummary = `Solved in ${minKey[0]} guesses: ${minKey[1]} times`;
    }

    console.log(JSON.stringify({ fn: 'get-stats', method: req.method, user_id: user.id, status: 200, duration_ms: Date.now() - start }));

    return new Response(
      JSON.stringify({
        total_participations: totalParticipations,
        games_won: gamesWon,
        total_losses: stats.total_losses ?? 0,
        current_streak: stats.current_streak ?? 0,
        max_streak: stats.max_streak ?? 0,
        participation_streak: stats.participation_streak ?? 0,
        max_participation_streak: stats.max_participation_streak ?? 0,
        guess_distribution: dist,
        win_rate_percent: winRatePercent,
        avg_guesses_to_win: avgGuessesToWin,
        best_guess_summary: bestGuessSummary,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    console.error(JSON.stringify({ fn: 'get-stats', error: String(err), status: 500 }));
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
