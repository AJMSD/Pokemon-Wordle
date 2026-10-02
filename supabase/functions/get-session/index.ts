import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { markMissedSessions } from '../_shared/missedDay.ts';
import { getAuthUser, jwtSubject } from '../_shared/auth.ts';
import { ensureSessionTarget, resolveTarget, revealedHints, targetColumns } from '../_shared/target.ts';

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

  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const start = Date.now();

  try {
    const url = new URL(req.url);
    const puzzle_date_key = url.searchParams.get('puzzle_date_key');
    const guest_id = url.searchParams.get('guest_id');

    if (!puzzle_date_key) {
      return json({ error: 'Missing puzzle_date_key' }, 400);
    }

    // Sessions (and their targets) are only created for today's JST puzzle.
    const todayKey = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    if (puzzle_date_key !== todayKey) {
      return json({ error: "This puzzle has ended. Refresh for today's Pokémon." }, 400);
    }

    // The token's subject lets the session load start alongside getUser().
    const authHeader = req.headers.get('Authorization');
    const userId = jwtSubject(authHeader);
    const isGuest = !userId;
    if (isGuest && !guest_id) {
      return json({ error: 'guest_id required for unauthenticated requests' }, 400);
    }

    const sessionFilter = isGuest ? { guest_id } : { user_id: userId };

    // Rate limit: 30 req/min
    const rateLimitKey = userId
      ? `get-session:user:${userId}`
      : `get-session:ip:${getClientIP(req)}`;

    const [user, rateLimit, sessionResult] = await Promise.all([
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

    let session = sessionResult.data;
    const [, target] = await Promise.all([
      // Mark any stale sessions as missed
      markMissedSessions(supabaseAdmin, userId, isGuest ? guest_id : null, puzzle_date_key, isVerified),
      resolveTarget(supabaseAdmin, puzzle_date_key, userId ?? guest_id!, session),
    ]);

    if (!session) {
      const { data: newSession } = await supabaseAdmin
        .from('daily_sessions')
        .insert({
          ...sessionFilter,
          puzzle_date_key,
          ...targetColumns(target),
          guesses: [],
          hint_flags: { ability: false, generation: false, type: false },
          completion_state: 'playing',
          version: 1,
        })
        .select()
        .single();
      session = newSession;
      if (!session) {
        // Lost a create race with a concurrent request; use its row.
        ({ data: session } = await supabaseAdmin
          .from('daily_sessions')
          .select('*')
          .match({ ...sessionFilter, puzzle_date_key })
          .single());
      }
    } else {
      await ensureSessionTarget(supabaseAdmin, session, target);
    }

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

    console.log(JSON.stringify({ fn: 'get-session', method: req.method, user_id: userId, status: 200, duration_ms: Date.now() - start }));

    return json(responseBody, 200);
  } catch (err) {
    console.error(JSON.stringify({ fn: 'get-session', error: String(err), status: 500 }));
    return json({ error: 'Internal server error' }, 500);
  }
});
