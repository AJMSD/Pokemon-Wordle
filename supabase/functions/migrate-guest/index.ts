import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleCors, jsonResponder } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { resolveTarget, revealedHints, targetColumns } from '../_shared/target.ts';
import { replayGuestGuesses } from '../_shared/migrateGuest.ts';
import { buildSessionResponse } from '../_shared/sessionResponse.ts';

// Client guest ids are crypto.randomUUID() or a base36 fallback.
const GUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Turns a guest's locally played game into the signed-in user's session for
 * today. The server derives the guest target by the public formula, replays the
 * claimed guesses (so hint flags and completion are computed, not trusted) and
 * creates the session only if the user has none yet. It never credits stats
 * (a `daily_results` row is written for finished games so the repair path in
 * get-session does not credit them later) and never touches guest rows.
 *
 * Request:  { puzzle_date_key, guest_id, guesses: string[] }
 * Errors:   400 {code: 'missing_fields'|'invalid_guest_id'|'wrong_date'|'invalid_guesses'},
 *           401 (auth), 429 (rate limit).
 * Success:  200 session body (see buildSessionResponse) + `migrated: boolean`
 *           (false when the user already had a session today: that one is returned).
 */
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
    // Require auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Authorization required' }, 401);
    }

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabaseUser.auth.getUser();

    if (!user) {
      return json({ error: 'Invalid or expired token' }, 401);
    }

    const rateLimit = await checkRateLimit(supabaseAdmin, `migrate-guest:user:${user.id}`, 5, 3600);
    if (!rateLimit.allowed) {
      return json(
        { error: 'Rate limit exceeded', retry_after: rateLimit.retryAfter },
        429,
        { 'Retry-After': String(rateLimit.retryAfter) }
      );
    }

    const body = await req.json();
    const { guest_id, puzzle_date_key, guesses } = body;

    if (!guest_id || !puzzle_date_key) {
      return json({ error: 'Missing guest_id or puzzle_date_key', code: 'missing_fields' }, 400);
    }
    if (typeof guest_id !== 'string' || !GUEST_ID_RE.test(guest_id)) {
      return json({ error: 'Invalid guest_id', code: 'invalid_guest_id' }, 400);
    }

    // Only allow migrating today's session
    const todayKey = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    if (puzzle_date_key !== todayKey) {
      return json({ error: "Can only migrate today's session", code: 'wrong_date' }, 400);
    }

    // The guest's target comes from the public formula (what the offline client used).
    const target = await resolveTarget(supabaseAdmin, puzzle_date_key, guest_id, null, { guest: true });

    const replay = replayGuestGuesses(guesses, target.name);
    if (!replay.ok) {
      return json({ error: replay.error, code: 'invalid_guesses' }, 400);
    }

    const loadExisting = () =>
      supabaseAdmin
        .from('daily_sessions')
        .select('*')
        .match({ user_id: user.id, puzzle_date_key })
        .maybeSingle();

    const respond = (session: Parameters<typeof buildSessionResponse>[0], migrated: boolean, t = target) => {
      console.log(JSON.stringify({ fn: 'migrate-guest', method: req.method, user_id: user.id, migrated, status: 200, duration_ms: Date.now() - start }));
      return json({ ...buildSessionResponse(session, t, revealedHints(session.hint_flags, t.data)), migrated }, 200);
    };

    const { data: existing, error: existingError } = await loadExisting();
    if (existingError) throw new Error(`session lookup: ${existingError.message}`);
    if (existing) {
      // Existing sessions win; answer with the user's own target.
      const t = await resolveTarget(supabaseAdmin, puzzle_date_key, user.id, existing);
      return respond(existing, false, t);
    }

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('daily_sessions')
      .insert({
        user_id: user.id,
        puzzle_date_key,
        ...targetColumns(target),
        guesses: replay.guesses,
        hint_flags: replay.hint_flags,
        completion_state: replay.completion_state,
        version: 1,
      })
      .select()
      .single();

    if (insertError || !inserted) {
      // Lost a race with get-session creating the user's row: return that one.
      const { data: raced } = await loadExisting();
      if (raced && insertError?.code === '23505') {
        const t = await resolveTarget(supabaseAdmin, puzzle_date_key, user.id, raced);
        return respond(raced, false, t);
      }
      throw new Error(`session insert: ${insertError?.message ?? 'no row returned'}`);
    }

    // A finished migrated game earns no stats: record it as already archived so
    // the get-session repair path never credits it.
    if (replay.completion_state !== 'playing') {
      const { error: archiveError } = await supabaseAdmin
        .from('daily_results')
        .upsert(
          {
            user_id: user.id,
            puzzle_date_key,
            pokemon_name: target.name,
            guesses: replay.guesses,
            guess_count: replay.guesses.length,
            result: replay.completion_state,
          },
          { onConflict: 'user_id,puzzle_date_key', ignoreDuplicates: true }
        );
      if (archiveError) {
        console.error(JSON.stringify({ fn: 'migrate-guest', event: 'archive_failed', error: archiveError.message }));
      }
    }

    return respond(inserted, true);
  } catch (err) {
    console.error(JSON.stringify({ fn: 'migrate-guest', error: String(err), status: 500 }));
    return json({ error: 'Internal server error' }, 500);
  }
});
