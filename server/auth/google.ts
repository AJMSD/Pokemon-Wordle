// Google sign-in (OpenID Connect authorization code flow with PKCE).
//
// start    -> 302 to Google; state + PKCE verifier ride in a short-lived HMAC-signed cookie.
// callback -> exchanges the code, verifies the id_token against Google's keys, finds or
//             creates the account, and redirects to the site with a 60-second one-time
//             login code (never the session token itself) in ?login=.
// exchange -> trades that code for a session token.
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { sql, isUniqueViolation } from '../db.ts';
import { env, rateLimited, readJson, type Ctx } from '../http.ts';
import { allowedOrigin } from '../shared/cors.ts';
import { checkRateLimit } from '../shared/rateLimit.ts';
import { getClientIP } from '../shared/guestLimit.ts';
import { randomToken } from './tokens.ts';
import { createSession, publicUser, type AuthUser } from './session.ts';
import { consumeToken, issueToken, siteUrl } from './routes.ts';

const COOKIE = 'wurmple_oauth';
const COOKIE_PATH = '/v1/auth/google';
const COOKIE_TTL_SECONDS = 600;
const LOGIN_CODE_TTL_SECONDS = 60;

// Overridable for tests (a local stub stands in for Google).
const AUTH_URL = () => env('GOOGLE_AUTH_URL', 'https://accounts.google.com/o/oauth2/v2/auth');
const TOKEN_URL = () => env('GOOGLE_TOKEN_URL', 'https://oauth2.googleapis.com/token');
const JWKS_URL = () => env('GOOGLE_JWKS_URL', 'https://www.googleapis.com/oauth2/v3/certs');
const ISSUERS = () => (Deno.env.get('GOOGLE_ISSUER') ?? 'https://accounts.google.com,accounts.google.com').split(',');

const enabled = () => Deno.env.get('GOOGLE_ENABLED') === 'true' && !!Deno.env.get('GOOGLE_CLIENT_ID');
const redirectUri = () => `${env('API_URL', 'https://wurmple-api.ajmsd.space').replace(/\/+$/, '')}/v1/auth/google/callback`;

const encoder = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let hmacKey: Promise<CryptoKey> | null = null;
function cookieKey(): Promise<CryptoKey> {
  // Derived from the server secret with a distinct label, so it can't collide with target seeds.
  hmacKey ??= crypto.subtle.importKey('raw', encoder.encode(`wurmple:oauth-cookie:${env('TARGET_SALT')}`),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return hmacKey;
}

interface OAuthCookie {
  state: string;
  verifier: string;
  origin: string;
  exp: number;
}

export async function signCookie(value: OAuthCookie): Promise<string> {
  const payload = b64url(encoder.encode(JSON.stringify(value)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await cookieKey(), encoder.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

export async function readCookie(raw: string | undefined, now = Date.now()): Promise<OAuthCookie | null> {
  const [payload, sig] = raw?.split('.') ?? [];
  if (!payload || !sig) return null;
  try {
    const sigBytes = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', await cookieKey(), sigBytes, encoder.encode(payload));
    if (!ok) return null;
    const value = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as OAuthCookie;
    return value.exp > now ? value : null;
  } catch {
    return null;
  }
}

function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

function cookieHeader(value: string, maxAge: number): string {
  const secure = redirectUri().startsWith('https:') ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=${COOKIE_PATH}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  if (cookie) headers.set('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
}

let jwks: JWTVerifyGetKey | null = null;

export interface GoogleIdentity {
  sub: string;
  email: string;
}

/** Verifies a Google id_token (signature, issuer, audience, expiry, verified email). */
export async function verifyGoogleIdToken(
  idToken: string,
  opts: { clientId: string; issuers: string[]; keys: JWTVerifyGetKey }
): Promise<GoogleIdentity> {
  const { payload } = await jwtVerify(idToken, opts.keys, { issuer: opts.issuers, audience: opts.clientId });
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('id_token has no subject');
  if (typeof payload.email !== 'string' || payload.email_verified !== true) {
    throw new Error('Google account email is not verified');
  }
  return { sub: payload.sub, email: payload.email.toLowerCase() };
}

/** The account for a Google identity: by Google id, else linked by email, else new. */
export async function findOrCreateGoogleUser(identity: GoogleIdentity): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await sql.begin(async (tx) => {
        const [bySub] = await tx<{ id: string }[]>`select id from users where google_sub = ${identity.sub}`;
        if (bySub) return bySub.id;

        const [byEmail] = await tx<{ id: string; email_verified_at: Date | null }[]>`
          select id, email_verified_at from users where lower(email) = ${identity.email} for update`;
        if (byEmail) {
          // Google proved the inbox. An unconfirmed password signup on this
          // address may not be the owner's, so its password and name are dropped.
          await tx`
            update users set
              google_sub = ${identity.sub},
              password_hash = case when email_verified_at is null then null else password_hash end,
              signup_username = case when email_verified_at is null then null else signup_username end,
              email_verified_at = coalesce(email_verified_at, now())
            where id = ${byEmail.id}`;
          return byEmail.id;
        }

        // New account; the app asks for a Trainer name (no profile yet).
        const [created] = await tx<{ id: string }[]>`
          insert into users (email, google_sub, email_verified_at)
          values (${identity.email}, ${identity.sub}, now())
          returning id`;
        return created.id;
      });
    } catch (err) {
      // A concurrent callback created the same account; the retry finds it.
      if (attempt === 0 && isUniqueViolation(err)) continue;
      throw err;
    }
  }
  throw new Error('unreachable');
}

async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
}

// GET /v1/auth/google/start?origin=<site origin>
export async function googleStart({ url }: Ctx): Promise<Response> {
  const origin = allowedOrigin(url.searchParams.get('origin')) ?? siteUrl();
  if (!enabled()) return redirect(`${origin}/?auth_error=google_disabled`);

  const state = randomToken(16);
  const verifier = randomToken(32);
  const cookie = await signCookie({ state, verifier, origin, exp: Date.now() + COOKIE_TTL_SECONDS * 1000 });

  const params = new URLSearchParams({
    client_id: env('GOOGLE_CLIENT_ID'),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return redirect(`${AUTH_URL()}?${params}`, cookieHeader(cookie, COOKIE_TTL_SECONDS));
}

// GET /v1/auth/google/callback?code&state
export async function googleCallback({ req, url }: Ctx): Promise<Response> {
  const saved = await readCookie(getCookie(req, COOKIE));
  const origin = saved?.origin ?? siteUrl();
  const clear = cookieHeader('', 0);
  const fail = (reason: string) => {
    console.warn(JSON.stringify({ fn: 'google', event: 'login_failed', reason }));
    return redirect(`${origin}/?auth_error=google`, clear);
  };

  if (!enabled()) return fail('disabled');
  if (!saved) return fail('missing_cookie');
  if (url.searchParams.get('state') !== saved.state) return fail('state_mismatch');
  const code = url.searchParams.get('code');
  if (!code) return fail(url.searchParams.get('error') ?? 'no_code');

  const { allowed } = await checkRateLimit(sql, `auth-google:ip:${getClientIP(req)}`, 30, 600);
  if (!allowed) return fail('rate_limited');

  try {
    const tokenRes = await fetch(TOKEN_URL(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env('GOOGLE_CLIENT_ID'),
        client_secret: env('GOOGLE_SECRET'),
        redirect_uri: redirectUri(),
        grant_type: 'authorization_code',
        code_verifier: saved.verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenRes.ok) return fail(`token_exchange_${tokenRes.status}`);
    const { id_token } = await tokenRes.json();
    if (typeof id_token !== 'string') return fail('no_id_token');

    jwks ??= createRemoteJWKSet(new URL(JWKS_URL()));
    const identity = await verifyGoogleIdToken(id_token, {
      clientId: env('GOOGLE_CLIENT_ID'),
      issuers: ISSUERS(),
      keys: jwks,
    });
    const userId = await findOrCreateGoogleUser(identity);
    const loginCode = await issueToken(sql, userId, 'google_login', LOGIN_CODE_TTL_SECONDS);
    return redirect(`${origin}/?login=${encodeURIComponent(loginCode)}`, clear);
  } catch (err) {
    return fail(String(err));
  }
}

// POST /v1/auth/google/exchange {token}
export async function googleExchange({ req, json }: Ctx): Promise<Response> {
  const body = await readJson(req);
  const { allowed, retryAfter } = await checkRateLimit(sql, `auth-token:ip:${getClientIP(req)}`, 30, 600);
  if (!allowed) return rateLimited(json, retryAfter);

  const result = await sql.begin(async (tx) => {
    const userId = await consumeToken(tx, body?.token, 'google_login');
    if (!userId) return null;
    const [user] = await tx<AuthUser[]>`select id, email, email_verified_at from users where id = ${userId}`;
    return { token: await createSession(tx, userId), user: publicUser(user) };
  });
  if (!result) return json({ error: 'This sign-in link has expired. Try again.', code: 'invalid_token' }, 400);
  return json(result, 200);
}
