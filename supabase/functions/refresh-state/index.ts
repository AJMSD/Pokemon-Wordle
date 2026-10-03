import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleCors, jsonResponder } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { markMissedSessions } from '../_shared/missedDay.ts';
import { getAuthUser, jwtSubject } from '../_shared/auth.ts';
import { resolveTarget, revealedHints } from '../_shared/target.ts';
import { buildSessionResponse } from '../_shared/sessionResponse.ts';

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const json = jsonResponder(req);

  const start = Date.now();

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const body = await req.json();
    const { puzzle_date_key } = body;

    if (!puzzle_date_key) {
      return json({ error: 'Missing puzzle_date_key' }, 400);
    }

    // Only today's JST puzzle: a future key would mark today's session missed.
    const todayKey = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    if (puzzle_date_key !== todayKey) {
      return json({ error: "This puzzle has ended. Refresh for today's Pokémon." }, 400);
    }

    // Guests play entirely on the client; the server only serves signed-in users.
    const authHeader = req.headers.get('Authorization');
    const userId = jwtSubject(authHeader);
    if (!userId) {
      return json({ error: 'Authorization required' }, 401);
    }

    // Rate limit: 30 req/min
    const rateLimitKey = `refresh-state:user:${userId}`;

    // Load existing session only — refresh-state does not create sessions
    const [user, rateLimit, { data: session }] = await Promise.all([
      getAuthUser(authHeader),
      checkRateLimit(supabaseAdmin, rateLimitKey, 30, 60),
      supabaseAdmin
        .from('daily_sessions')
        .select('*')
        .match({ user_id: userId, puzzle_date_key })
        .maybeSingle(),
    ]);

    if (user?.id !== userId) {
      return json({ error: 'Invalid or expired token' }, 401);
    }
    const isVerified = !!user?.email_confirmed_at;

    if (!rateLimit.allowed) {
      return json(
        { error: 'Rate limit exceeded', retry_after: rateLimit.retryAfter },
        429,
        { 'Retry-After': String(rateLimit.retryAfter) }
      );
    }

    // Mark stale sessions as missed (same as get-session)
    await markMissedSessions(supabaseAdmin, userId, null, puzzle_date_key, isVerified);

    if (!session) {
      return json({ error: 'Session not found' }, 404);
    }

    const target = await resolveTarget(supabaseAdmin, puzzle_date_key, userId, session);

    const responseBody = buildSessionResponse(session, target, revealedHints(session.hint_flags, target.data));

    console.log(JSON.stringify({ fn: 'refresh-state', method: req.method, user_id: userId, status: 200, duration_ms: Date.now() - start }));

    return json(responseBody, 200);
  } catch (err) {
    console.error(JSON.stringify({ fn: 'refresh-state', error: String(err), status: 500 }));
    return json({ error: 'Internal server error' }, 500);
  }
});
