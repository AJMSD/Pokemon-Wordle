import { sql, isUniqueViolation } from '../db.ts';
import { rateLimited, readJson, todayKeyJST, type Ctx } from '../http.ts';
import { requireUser } from '../auth/session.ts';
import { checkRateLimit } from '../shared/rateLimit.ts';
import { resolveTarget, revealedHints, type Target } from '../shared/target.ts';
import { replayGuestGuesses } from '../shared/migrateGuest.ts';
import { buildSessionResponse } from '../shared/sessionResponse.ts';
import { GUEST_ID_RE } from '../shared/player.ts';
import { findSession, insertSession, type SessionRow } from '../shared/sessions.ts';
import { isPerUserDate } from '../../src/logic/dailyTarget.ts';

/**
 * Moves a guest's game for today onto the signed-in user's account, only if
 * the user has no session today yet. It never credits stats (a `daily_results`
 * row is written for finished games so the get-session repair never credits
 * them later).
 *
 * - Per-user days: guests play on the server, so their session row is simply
 *   reassigned to the user (target, guesses and hints carry over unchanged).
 * - Earlier (shared-puzzle) days: guests played locally against the public
 *   shared target; the claimed guesses are replayed so hint flags and
 *   completion are computed, not trusted.
 *
 * Request:  POST /v1/migrate-guest { puzzle_date_key, guest_id, guesses?: string[] }
 * Errors:   400 {code: 'missing_fields'|'invalid_guest_id'|'wrong_date'|'invalid_guesses'},
 *           404 {code: 'no_guest_session'}, 401 (auth), 429 (rate limit).
 * Success:  200 session body (see buildSessionResponse) + `migrated: boolean`
 *           (false when the user already had a session today: that one is returned).
 */
export async function migrateGuest({ req, json }: Ctx): Promise<Response> {
  const user = await requireUser(req);
  if (!user) {
    return json({ error: 'Invalid or expired token' }, 401);
  }

  const rateLimit = await checkRateLimit(sql, `migrate-guest:user:${user.id}`, 5, 3600);
  if (!rateLimit.allowed) return rateLimited(json, rateLimit.retryAfter);

  const body = await readJson(req);
  const { guest_id, puzzle_date_key, guesses } = body ?? {};

  if (!guest_id || !puzzle_date_key || typeof puzzle_date_key !== 'string') {
    return json({ error: 'Missing guest_id or puzzle_date_key', code: 'missing_fields' }, 400);
  }
  if (typeof guest_id !== 'string' || !GUEST_ID_RE.test(guest_id)) {
    return json({ error: 'Invalid guest_id', code: 'invalid_guest_id' }, 400);
  }

  // Only allow migrating today's session
  if (puzzle_date_key !== todayKeyJST()) {
    return json({ error: "Can only migrate today's session", code: 'wrong_date' }, 400);
  }

  const owner = { kind: 'user' as const, id: user.id };
  const loadExisting = () => findSession(sql, owner, puzzle_date_key);

  const respond = (session: SessionRow, migrated: boolean, t: Target) =>
    json({ ...buildSessionResponse(session, t, revealedHints(session.hint_flags, t.data)), migrated }, 200);

  // Existing sessions win; answer with the user's own target.
  const respondExisting = async (session: SessionRow) =>
    respond(session, false, await resolveTarget(sql, puzzle_date_key, user.id, session));

  const existing = await loadExisting();
  if (existing) return respondExisting(existing);

  // A finished game is archived without stats so get-session never credits it.
  const archive = async (targetName: string, sessionGuesses: string[], state: string) => {
    if (state === 'playing') return;
    try {
      await sql`
        insert into daily_results (user_id, puzzle_date_key, pokemon_name, guesses, guess_count, result)
        values (${user.id}, ${puzzle_date_key}, ${targetName}, ${sessionGuesses}::text[], ${sessionGuesses.length}, ${state})
        on conflict (user_id, puzzle_date_key) do nothing`;
    } catch (err) {
      console.error(JSON.stringify({ fn: 'migrate-guest', event: 'archive_failed', error: String(err) }));
    }
  };

  if (isPerUserDate(puzzle_date_key)) {
    // Reassign the guest's server session; guarded on guest_id so two
    // concurrent migrations can't both take it.
    let moved: SessionRow | undefined;
    try {
      [moved] = await sql<SessionRow[]>`
        update daily_sessions set user_id = ${user.id}, guest_id = null
        where guest_id = ${guest_id} and puzzle_date_key = ${puzzle_date_key}
        returning *`;
    } catch (err) {
      // 23505: get-session created the user's row meanwhile; that one wins.
      const raced = isUniqueViolation(err) ? await loadExisting() : undefined;
      if (raced) return respondExisting(raced);
      throw err;
    }
    if (!moved) {
      return json({ error: 'No guest game to import', code: 'no_guest_session' }, 404);
    }
    const t = await resolveTarget(sql, puzzle_date_key, user.id, moved);
    await archive(t.name, moved.guesses, moved.completion_state);
    return respond(moved, true, t);
  }

  // Shared-puzzle days: the guest's target is the public shared pick.
  const target = await resolveTarget(sql, puzzle_date_key, guest_id, null);

  const replay = replayGuestGuesses(guesses, target.name);
  if (!replay.ok) {
    return json({ error: replay.error, code: 'invalid_guesses' }, 400);
  }

  const inserted = await insertSession(sql, owner, puzzle_date_key, target, {
    guesses: replay.guesses,
    hint_flags: replay.hint_flags,
    completion_state: replay.completion_state,
  });
  if (!inserted) {
    // Lost a race with get-session creating the user's row: return that one.
    const raced = await loadExisting();
    if (raced) return respondExisting(raced);
    throw new Error('session insert: no row returned');
  }

  await archive(target.name, replay.guesses, replay.completion_state);
  return respond(inserted, true, target);
}
