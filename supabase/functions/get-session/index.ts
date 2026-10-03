import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleCors, jsonResponder } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { markMissedSessions } from '../_shared/missedDay.ts';
import { getAuthUser, jwtSubject } from '../_shared/auth.ts';
import { ensureSessionTarget, resolveTarget, revealedHints, targetColumns } from '../_shared/target.ts';
import { buildSessionResponse } from '../_shared/sessionResponse.ts';
import { awardBalls, recordCompletion } from '../_shared/completion.ts';
import { getClientIP, guestSessionAllowed } from '../_shared/guestLimit.ts';
import { identifyPlayer, ownerOf, rateLimitKey, targetSeed } from '../_shared/player.ts';

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const json = jsonResponder(req);

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

    if (!puzzle_date_key) {
      return json({ error: 'Missing puzzle_date_key' }, 400);
    }

    // Sessions (and their targets) are only created for today's JST puzzle.
    const todayKey = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    if (puzzle_date_key !== todayKey) {
      return json({ error: "This puzzle has ended. Refresh for today's Pokémon." }, 400);
    }

    // Signed-in players by token subject (confirmed via getUser below);
    // guests by the anon key plus their guest_id.
    const authHeader = req.headers.get('Authorization');
    const player = identifyPlayer(jwtSubject(authHeader), url.searchParams.get('guest_id'));
    if (!player) {
      return json({ error: 'Authorization required' }, 401);
    }
    const userId = player.kind === 'user' ? player.id : null;
    const owner = ownerOf(player);

    // Rate limit: 30 req/min
    const [user, rateLimit, sessionResult] = await Promise.all([
      userId ? getAuthUser(authHeader) : Promise.resolve(null),
      checkRateLimit(supabaseAdmin, rateLimitKey('get-session', player), 30, 60),
      supabaseAdmin
        .from('daily_sessions')
        .select('*')
        .match({ ...owner, puzzle_date_key })
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
      // Mark any stale sessions as missed (streaks only exist for users)
      userId ? markMissedSessions(supabaseAdmin, userId, null, puzzle_date_key, isVerified) : null,
      resolveTarget(supabaseAdmin, puzzle_date_key, targetSeed(player), session),
    ]);

    if (!session && player.kind === 'guest' && !(await guestSessionAllowed(supabaseAdmin, getClientIP(req)))) {
      return json({ error: 'Too many new guest games from this network. Sign in to keep playing.' }, 429, { 'Retry-After': '3600' });
    }

    if (!session) {
      const { data: newSession } = await supabaseAdmin
        .from('daily_sessions')
        .insert({
          ...owner,
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
          .match({ ...owner, puzzle_date_key })
          .single());
      }
    } else {
      await ensureSessionTarget(supabaseAdmin, session, target);
    }

    // Repair: a finished game by a verified user whose result/stats write failed
    // earlier. Only sessions the user actually played (guesses present) qualify;
    // recordCompletion is idempotent, so concurrent repairs credit once.
    if (
      userId &&
      isVerified &&
      (session.completion_state === 'won' || session.completion_state === 'lost') &&
      Array.isArray(session.guesses) && session.guesses.length > 0
    ) {
      const { data: result } = await supabaseAdmin
        .from('daily_results')
        .select('user_id')
        .match({ user_id: userId, puzzle_date_key })
        .maybeSingle();
      if (!result) {
        try {
          const balls = await recordCompletion(supabaseAdmin, {
            userId,
            puzzleDateKey: puzzle_date_key,
            targetName: target.name,
            guesses: session.guesses,
            state: session.completion_state,
          });
          await awardBalls(supabaseAdmin, userId, [...new Set(balls)]);
        } catch (err) {
          console.error(JSON.stringify({ fn: 'get-session', event: 'repair_failed', error: String(err) }));
        }
      }
    }

    const responseBody = buildSessionResponse(session, target, revealedHints(session.hint_flags, target.data));

    console.log(JSON.stringify({ fn: 'get-session', method: req.method, player: player.kind, user_id: userId, status: 200, duration_ms: Date.now() - start }));

    return json(responseBody, 200);
  } catch (err) {
    console.error(JSON.stringify({ fn: 'get-session', error: String(err), status: 500 }));
    return json({ error: 'Internal server error' }, 500);
  }
});
