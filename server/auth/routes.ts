// Email + password accounts: signup, email verification, login, logout,
// password reset. Responses never reveal whether an email is registered.
import { sql, type Db } from '../db.ts';
import { env, rateLimited, readJson, type Ctx, type Json } from '../http.ts';
import { checkRateLimit } from '../shared/rateLimit.ts';
import { getClientIP } from '../shared/guestLimit.ts';
import { bearerToken, randomToken, sha256Hex } from './tokens.ts';
import { createSession, publicUser, revokeSession, type AuthUser } from './session.ts';
import { hashPassword, verifyPassword } from './passwords.ts';
import { isDisposableEmail, normalizeEmail, passwordError, usernameError } from './validation.ts';
import { resetPasswordMail, sendMailInBackground, verifyEmailMail, type Mail } from './mailer.ts';

const VERIFY_TTL_SECONDS = 24 * 3600;
const RESET_TTL_SECONDS = 3600;
// Brevo's free tier allows 300 emails/day; leave headroom.
const MAIL_PER_DAY = 250;

export type TokenKind = 'verify' | 'reset' | 'google_login';

export function siteUrl(): string {
  return env('SITE_URL', 'https://wurmple.ajmsd.space').replace(/\/+$/, '');
}

/** Stores a fresh one-time token for the user and returns it. */
export async function issueToken(db: Db, userId: string, kind: TokenKind, ttlSeconds: number): Promise<string> {
  const token = randomToken();
  await db`
    insert into auth_tokens (token_hash, user_id, kind, expires_at)
    values (${await sha256Hex(token)}, ${userId}, ${kind}, now() + make_interval(secs => ${ttlSeconds}))`;
  return token;
}

/** Marks a one-time token used; returns its user id, or null if unknown, used or expired. */
export async function consumeToken(db: Db, token: unknown, kind: TokenKind): Promise<string | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const [row] = await db<{ user_id: string }[]>`
    update auth_tokens set used_at = now()
    where token_hash = ${await sha256Hex(token)} and kind = ${kind}
      and used_at is null and expires_at > now()
    returning user_id`;
  return row?.user_id ?? null;
}

/**
 * Creates the profile from the Trainer name given at signup. If the name was
 * taken meanwhile no profile is created and the app asks for another one.
 */
export async function ensureProfileFromSignup(db: Db, userId: string): Promise<void> {
  await db`
    insert into profiles (id, username)
    select id, signup_username from users where id = ${userId} and signup_username is not null
    on conflict do nothing`;
  await db`
    update users set signup_username = null
    where id = ${userId} and exists (select 1 from profiles where id = ${userId})`;
}

async function limit(json: Json, key: string, max: number, windowSeconds: number): Promise<Response | null> {
  const { allowed, retryAfter } = await checkRateLimit(sql, key, max, windowSeconds);
  return allowed ? null : rateLimited(json, retryAfter);
}

/** Per-IP and per-address limits for endpoints that send email. */
async function mailLimits(json: Json, req: Request, email: string): Promise<Response | null> {
  return await limit(json, `auth-mail:ip:${getClientIP(req)}`, 10, 3600)
    ?? await limit(json, `auth-mail:email:${email}`, 5, 3600);
}

async function sendAccountMail(mail: Mail, event: string): Promise<void> {
  const { allowed } = await checkRateLimit(sql, 'auth-mail:global', MAIL_PER_DAY, 86400);
  if (!allowed) {
    console.error(JSON.stringify({ fn: 'auth', event: 'daily_mail_cap_reached' }));
    return;
  }
  sendMailInBackground(mail, event);
}

async function sendVerification(db: Db, userId: string, email: string): Promise<void> {
  await db`delete from auth_tokens where user_id = ${userId} and kind = 'verify'`;
  const token = await issueToken(db, userId, 'verify', VERIFY_TTL_SECONDS);
  await sendAccountMail(verifyEmailMail(email, `${siteUrl()}/?verify=${encodeURIComponent(token)}`), 'verify_mail');
}

function sessionBody(token: string, user: AuthUser) {
  return { token, user: publicUser(user) };
}

type UserRow = AuthUser & { password_hash: string | null };

async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  const [row] = await sql<UserRow[]>`
    select id, email, email_verified_at, password_hash from users where lower(email) = ${email}`;
  return row;
}

// POST /v1/auth/signup {email, password, username}
export async function signup({ req, json }: Ctx): Promise<Response> {
  const body = await readJson(req);
  if (!body) return json({ error: 'Invalid JSON' }, 400);

  const email = normalizeEmail(body.email);
  if (!email) return json({ error: 'Enter a valid email address' }, 400);
  if (isDisposableEmail(email)) return json({ error: 'Disposable email addresses are not allowed' }, 400);
  const pwError = passwordError(body.password);
  if (pwError) return json({ error: pwError }, 400);
  const nameError = usernameError(body.username);
  if (nameError) return json({ error: nameError }, 400);
  const username = String(body.username).trim();

  const limited = await limit(json, `auth-signup:ip:${getClientIP(req)}`, 10, 3600)
    ?? await limit(json, `auth-mail:email:${email}`, 5, 3600);
  if (limited) return limited;

  const [taken] = await sql`select 1 from profiles where lower(username) = lower(${username})`;
  if (taken) return json({ error: 'That Trainer name is already taken' }, 409);

  // Hash first on every path so response time doesn't reveal existing accounts.
  const passwordHash = await hashPassword(body.password as string);
  const existing = await findUserByEmail(email);

  if (existing?.email_verified_at) {
    // Already registered: say nothing (no enumeration), send nothing.
    return json({ ok: true }, 200);
  }

  let userId: string;
  if (existing) {
    // Unconfirmed signup: the latest one wins and older links stop working,
    // so whoever confirms always knows the password that goes with it.
    await sql`
      update users set password_hash = ${passwordHash}, signup_username = ${username}
      where id = ${existing.id}`;
    userId = existing.id;
  } else {
    try {
      const [row] = await sql<{ id: string }[]>`
        insert into users (email, password_hash, signup_username)
        values (${email}, ${passwordHash}, ${username})
        returning id`;
      userId = row.id;
    } catch (err) {
      // Concurrent signup for the same address.
      if ((err as { code?: string }).code === '23505') return json({ ok: true }, 200);
      throw err;
    }
  }

  await sendVerification(sql, userId, email);
  return json({ ok: true }, 200);
}

// POST /v1/auth/verify {token}
export async function verify({ req, json }: Ctx): Promise<Response> {
  const body = await readJson(req);
  const limited = await limit(json, `auth-token:ip:${getClientIP(req)}`, 30, 600);
  if (limited) return limited;

  const result = await sql.begin(async (tx) => {
    const userId = await consumeToken(tx, body?.token, 'verify');
    if (!userId) return null;
    const [user] = await tx<AuthUser[]>`
      update users set email_verified_at = coalesce(email_verified_at, now())
      where id = ${userId}
      returning id, email, email_verified_at`;
    await ensureProfileFromSignup(tx, userId);
    return sessionBody(await createSession(tx, userId), user);
  });

  if (!result) {
    return json({ error: 'This confirmation link is invalid or has expired.', code: 'invalid_token' }, 400);
  }
  return json(result, 200);
}

// POST /v1/auth/login {email, password}
export async function login({ req, json }: Ctx): Promise<Response> {
  const body = await readJson(req);
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === 'string' ? body.password : '';

  const limited = await limit(json, `auth-login:ip:${getClientIP(req)}`, 30, 600)
    ?? (email ? await limit(json, `auth-login:email:${email}`, 10, 600) : null);
  if (limited) return limited;

  const user = email ? await findUserByEmail(email) : undefined;
  const ok = await verifyPassword(password, user?.password_hash ?? null);
  if (!user || !ok) return json({ error: 'Invalid login credentials' }, 400);
  if (!user.email_verified_at) {
    return json({ error: 'Email not confirmed', code: 'email_not_verified' }, 403);
  }

  return json(sessionBody(await createSession(sql, user.id), user), 200);
}

// POST /v1/auth/logout (Bearer)
export async function logout({ req, json }: Ctx): Promise<Response> {
  const token = bearerToken(req.headers.get('Authorization'));
  if (token) await revokeSession(token);
  return json({ ok: true }, 200);
}

// POST /v1/auth/resend {email}
export async function resend({ req, json }: Ctx): Promise<Response> {
  const body = await readJson(req);
  const email = normalizeEmail(body?.email);
  if (!email) return json({ error: 'Enter a valid email address' }, 400);
  const limited = await mailLimits(json, req, email);
  if (limited) return limited;

  const user = await findUserByEmail(email);
  if (user && !user.email_verified_at && user.password_hash) {
    await sendVerification(sql, user.id, user.email);
  }
  return json({ ok: true }, 200);
}

// POST /v1/auth/recover {email}
export async function recover({ req, json }: Ctx): Promise<Response> {
  const body = await readJson(req);
  const email = normalizeEmail(body?.email);
  if (!email) return json({ error: 'Enter a valid email address' }, 400);
  const limited = await mailLimits(json, req, email);
  if (limited) return limited;

  const user = await findUserByEmail(email);
  if (user) {
    await sql`delete from auth_tokens where user_id = ${user.id} and kind = 'reset'`;
    const token = await issueToken(sql, user.id, 'reset', RESET_TTL_SECONDS);
    await sendAccountMail(resetPasswordMail(user.email, `${siteUrl()}/?reset=${encodeURIComponent(token)}`), 'reset_mail');
  }
  return json({ ok: true }, 200);
}

// POST /v1/auth/reset {token, password}
export async function reset({ req, json }: Ctx): Promise<Response> {
  const body = await readJson(req);
  const pwError = passwordError(body?.password);
  if (pwError) return json({ error: pwError }, 400);
  const limited = await limit(json, `auth-token:ip:${getClientIP(req)}`, 30, 600);
  if (limited) return limited;

  const passwordHash = await hashPassword(body!.password as string);
  const result = await sql.begin(async (tx) => {
    const userId = await consumeToken(tx, body?.token, 'reset');
    if (!userId) return null;
    // The link proves the inbox, so it also confirms the address.
    const [user] = await tx<AuthUser[]>`
      update users set password_hash = ${passwordHash}, email_verified_at = coalesce(email_verified_at, now())
      where id = ${userId}
      returning id, email, email_verified_at`;
    // Sign out everywhere else.
    await tx`delete from auth_sessions where user_id = ${userId}`;
    await tx`delete from auth_tokens where user_id = ${userId} and kind = 'reset'`;
    await ensureProfileFromSignup(tx, userId);
    return sessionBody(await createSession(tx, userId), user);
  });

  if (!result) {
    return json({ error: 'Password reset link is invalid or expired. Request a new reset email and try again.', code: 'invalid_token' }, 400);
  }
  return json(result, 200);
}
