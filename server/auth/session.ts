import { sql, type Db } from '../db.ts';
import { bearerToken, randomToken, sha256Hex } from './tokens.ts';

export const SESSION_TTL_DAYS = 30;
// Sliding expiry is bumped at most this often per session (saves a write per request).
export const SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export interface AuthUser {
  id: string;
  email: string;
  email_verified_at: Date | null;
}

/** The user shape the frontend stores (field names kept from the old auth API). */
export function publicUser(user: AuthUser) {
  return {
    id: user.id,
    email: user.email,
    email_confirmed_at: user.email_verified_at ? new Date(user.email_verified_at).toISOString() : null,
  };
}

/** True when a session last seen at `lastSeen` should get its expiry pushed out. */
export function needsTouch(lastSeen: Date, now = Date.now()): boolean {
  return now - lastSeen.getTime() >= SESSION_TOUCH_INTERVAL_MS;
}

/** Creates a session and returns the bearer token (shown to the client once). */
export async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomToken();
  await db`
    insert into auth_sessions (user_id, token_hash, expires_at)
    values (${userId}, ${await sha256Hex(token)}, now() + make_interval(days => ${SESSION_TTL_DAYS}))`;
  return token;
}

export async function revokeSession(token: string): Promise<void> {
  await sql`delete from auth_sessions where token_hash = ${await sha256Hex(token)}`;
}

/**
 * The signed-in user for a request:
 * - `null` when no Authorization header was sent (guest),
 * - `'invalid'` when a token was sent but is unknown or expired,
 * - the user otherwise.
 */
export async function getAuthUser(req: Request): Promise<AuthUser | null | 'invalid'> {
  const header = req.headers.get('Authorization');
  if (!header) return null;
  const token = bearerToken(header);
  if (!token) return 'invalid';

  const [row] = await sql<(AuthUser & { session_id: string; last_seen_at: Date })[]>`
    select s.id as session_id, s.last_seen_at, u.id, u.email, u.email_verified_at
    from auth_sessions s join users u on u.id = s.user_id
    where s.token_hash = ${await sha256Hex(token)} and s.expires_at > now()`;
  if (!row) return 'invalid';

  if (needsTouch(row.last_seen_at)) {
    sql`
      update auth_sessions
      set last_seen_at = now(), expires_at = now() + make_interval(days => ${SESSION_TTL_DAYS})
      where id = ${row.session_id}`.catch((err) =>
      console.error(JSON.stringify({ fn: 'auth', event: 'session_touch_failed', error: String(err) })));
  }

  return { id: row.id, email: row.email, email_verified_at: row.email_verified_at };
}

/** Like getAuthUser, but guests count as unauthenticated. */
export async function requireUser(req: Request): Promise<AuthUser | null> {
  const user = await getAuthUser(req);
  return user && user !== 'invalid' ? user : null;
}
