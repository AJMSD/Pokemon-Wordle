import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

function getStreakTierBall(streak: number): string {
  if (streak >= 14) return 'master-ball';
  if (streak >= 7) return 'ultra-ball';
  if (streak >= 3) return 'great-ball';
  return 'poke-ball';
}

const STANDARD_ORDER = ['poke-ball', 'great-ball', 'ultra-ball', 'master-ball'];

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

  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user || !user.email_confirmed_at) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const userId = user.id;

  const [catalogResult, unlocksResult, statsResult, profileResult] = await Promise.all([
    supabaseAdmin.from('ball_catalog').select('id, display_name, description, category, unlock_condition'),
    supabaseAdmin.from('ball_unlocks').select('ball_id').eq('user_id', userId),
    supabaseAdmin.from('user_stats').select('current_streak').eq('user_id', userId).single(),
    supabaseAdmin.from('profiles').select('display_ball').eq('user_id', userId).single(),
  ]);

  const catalog = catalogResult.data ?? [];
  const unlocked = new Set((unlocksResult.data ?? []).map((r: { ball_id: string }) => r.ball_id));
  const streak = statsResult.data?.current_streak ?? 0;
  const displayBall = profileResult.data?.display_ball ?? 'poke-ball';

  const currentTierBall = getStreakTierBall(streak);
  const currentTierIndex = STANDARD_ORDER.indexOf(currentTierBall);

  const balls = catalog.map((b: {
    id: string;
    display_name: string;
    category: string;
    unlock_condition: { hint?: string } | null;
  }) => {
    const hint = b.unlock_condition?.hint ?? null;
    let status: string;

    if (b.category === 'standard') {
      const ballIndex = STANDARD_ORDER.indexOf(b.id);
      if (ballIndex < currentTierIndex) status = 'past_tier';
      else if (ballIndex === currentTierIndex) status = 'current_tier';
      else status = 'future_tier';
    } else {
      status = unlocked.has(b.id) ? 'unlocked' : 'locked';
    }

    return {
      id: b.id,
      display_name: b.display_name,
      category: b.category,
      status,
      hint,
    };
  });

  // Sort: standard balls first (by tier order), then achievement balls
  balls.sort((a: { category: string; id: string }, b: { category: string; id: string }) => {
    if (a.category === 'standard' && b.category !== 'standard') return -1;
    if (a.category !== 'standard' && b.category === 'standard') return 1;
    if (a.category === 'standard') {
      return STANDARD_ORDER.indexOf(a.id) - STANDARD_ORDER.indexOf(b.id);
    }
    return 0;
  });

  return new Response(
    JSON.stringify({
      current_streak_tier: currentTierBall,
      display_ball: displayBall,
      balls,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
