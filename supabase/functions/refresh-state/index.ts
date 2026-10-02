import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { markMissedSessions } from '../_shared/missedDay.ts';
import { getAuthUser, jwtSubject } from '../_shared/auth.ts';
import { resolveTarget, revealedHints } from '../_shared/target.ts';

function getClientIP(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

function json(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extraHeaders },
  });
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

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
    const { puzzle_date_key, guest_id } = body;

    if (!puzzle_date_key) {
      return json({ error: 'Missing puzzle_date_key' }, 400);
    }

    // Resolve identity (auth optional)
    const authHeader = req.headers.get('Authorization');
    const userId = jwtSubject(authHeader);
    const isGuest = !userId;
    if (isGuest && !guest_id) {
      return json({ error: 'guest_id required for unauthenticated requests' }, 400);
    }

    const sessionFilter = isGuest ? { guest_id } : { user_id: userId };

    // Rate limit: 30 req/min
    const rateLimitKey = userId
      ? `refresh-state:user:${userId}`
      : `refresh-state:ip:${getClientIP(req)}`;

    // Load existing session only — refresh-state does not create sessions
    const [user, rateLimit, { data: session }] = await Promise.all([
      userId ? getAuthUser(authHeader) : Promise.resolve(null),
      checkRateLimit(supabaseAdmin, rateLimitKey, 30, 60),
      supabaseAdmin
        .from('daily_sessions')
        .select('*')
        .match({ ...sessionFilter, puzzle_date_key })
        .maybeSingle(),
    ]);

    if (userId && user?.id !== userId) {
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
    await markMissedSessions(supabaseAdmin, userId, isGuest ? guest_id : null, puzzle_date_key, isVerified);

    if (!session) {
      return json({ error: 'Session not found' }, 404);
    }

    const target = await resolveTarget(supabaseAdmin, puzzle_date_key, userId ?? guest_id, session);

    const responseBody: Record<string, unknown> = {
      guesses: session.guesses,
      hint_flags: session.hint_flags,
      hints: revealedHints(session.hint_flags, target.data),
      completion_state: session.completion_state,
      version: session.version,
      puzzle_metadata: {
        name_length: target.name.replace(/[^a-z]/gi, '').length,
      },
    };

    if (session.completion_state !== 'playing') {
      responseBody.pokemon_name = target.name;
    }

    console.log(JSON.stringify({ fn: 'refresh-state', method: req.method, user_id: userId, status: 200, duration_ms: Date.now() - start }));

    return json(responseBody, 200);
  } catch (err) {
    console.error(JSON.stringify({ fn: 'refresh-state', error: String(err), status: 500 }));
    return json({ error: 'Internal server error' }, 500);
  }
});
