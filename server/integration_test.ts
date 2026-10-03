// Full API flows against a real, migrated Postgres:
//   DATABASE_URL=postgres://... deno test -A server/integration_test.ts
// Uses MAIL_MODE=log and reads links from the captured mail log. Creates its
// own uniquely named accounts, so it can run against a shared test database.
import { assert, assertEquals, assertExists } from 'jsr:@std/assert@1';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import bcrypt from 'bcryptjs';

if (!Deno.env.get('DATABASE_URL')) throw new Error('DATABASE_URL must be set');
Deno.env.set('MAIL_MODE', 'log');
Deno.env.set('TARGET_SALT', Deno.env.get('TARGET_SALT') ?? 'integration-test-salt');
Deno.env.set('SITE_URL', 'http://localhost:5173');
Deno.env.set('API_URL', 'http://api.test');

// Captured "sent" mail.
const mails: { to: string; text: string }[] = [];
const origLog = console.log;
console.log = (...args: unknown[]) => {
  const first = args[0];
  if (typeof first === 'string' && first.includes('"fn":"mailer"')) {
    const m = JSON.parse(first);
    mails.push({ to: m.to, text: m.text });
    return;
  }
  if (typeof first === 'string' && first.startsWith('{"fn":"/v1/')) return; // access log
  origLog(...args);
};

const { handle } = await import('./main.ts');
const { sql } = await import('./db.ts');
const { todayKeyJST } = await import('./http.ts');

const opts = { sanitizeResources: false, sanitizeOps: false };
const stamp = Date.now().toString(36);
const today = todayKeyJST();
const randomIp = () => `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 250) + 1).join('.')}`;

interface CallOpts {
  method?: string;
  token?: string;
  body?: unknown;
  ip?: string;
  headers?: Record<string, string>;
}

async function call(path: string, { method = 'GET', token, body, ip = randomIp(), headers = {} }: CallOpts = {}) {
  const res = await handle(new Request(`http://api.test${path}`, {
    method,
    headers: {
      'X-Forwarded-For': ip,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }));
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, headers: res.headers };
}

function linkToken(param: 'verify' | 'reset', to: string): string {
  const mail = mails.filter((m) => m.to === to).at(-1);
  assertExists(mail, `no mail to ${to}`);
  const match = mail.text.match(new RegExp(`[?&]${param}=([A-Za-z0-9_%-]+)`));
  assertExists(match, `no ${param} link in mail`);
  return decodeURIComponent(match[1]);
}

async function signUpAndVerify(email: string, password: string, username: string) {
  const signup = await call('/v1/auth/signup', { method: 'POST', body: { email, password, username } });
  assertEquals(signup.status, 200, JSON.stringify(signup.json));
  const verify = await call('/v1/auth/verify', { method: 'POST', body: { token: linkToken('verify', email) } });
  assertEquals(verify.status, 200, JSON.stringify(verify.json));
  return verify.json as { token: string; user: { id: string; email: string; email_confirmed_at: string } };
}

async function targetName(userId: string): Promise<string> {
  const [row] = await sql<{ name: string }[]>`
    select coalesce(s.target_pokemon_name, p.pokemon_name) as name
    from daily_sessions s left join daily_puzzles p on p.id = s.puzzle_id
    where s.user_id = ${userId} and s.puzzle_date_key = ${today}`;
  return row.name;
}

Deno.test('health and routing', opts, async () => {
  assertEquals((await call('/v1/health')).status, 200);
  assertEquals((await call('/v1/nope')).status, 404);
  assertEquals((await call('/functions/v1/get-me')).status, 404);
  assertEquals((await call('/v1/get-me', { method: 'POST' })).status, 405);
  const pre = await handle(new Request('http://api.test/v1/get-me', {
    method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' },
  }));
  assertEquals(pre.status, 204);
  assertEquals(pre.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assertEquals(pre.headers.get('access-control-max-age'), '86400');
});

Deno.test('signup validation', opts, async () => {
  const bad = (body: unknown) => call('/v1/auth/signup', { method: 'POST', body });
  assertEquals((await bad({ email: 'nope', password: 'longenough', username: 'ash' })).status, 400);
  assertEquals((await bad({ email: `a${stamp}@mailinator.com`, password: 'longenough', username: 'ash' })).status, 400);
  assertEquals((await bad({ email: `a${stamp}@example.com`, password: 'short', username: 'ash' })).status, 400);
  assertEquals((await bad({ email: `a${stamp}@example.com`, password: 'longenough', username: '_x' })).status, 400);
});

Deno.test('account lifecycle: signup, verify, login, profile, reset, logout', opts, async () => {
  const email = `life-${stamp}@example.com`;
  const username = `life${stamp}`.slice(0, 20);

  // Login before confirming is refused with a recognisable code.
  const signup = await call('/v1/auth/signup', { method: 'POST', body: { email, password: 'first-pass-1', username } });
  assertEquals(signup.status, 200);
  const early = await call('/v1/auth/login', { method: 'POST', body: { email, password: 'first-pass-1' } });
  assertEquals(early.status, 403);
  assertEquals(early.json.code, 'email_not_verified');

  // Re-signing up before confirming: latest password wins, older link dies.
  const oldLink = linkToken('verify', email);
  assertEquals((await call('/v1/auth/signup', { method: 'POST', body: { email, password: 'second-pass-2', username } })).status, 200);
  assertEquals((await call('/v1/auth/verify', { method: 'POST', body: { token: oldLink } })).status, 400);

  const verified = await call('/v1/auth/verify', { method: 'POST', body: { token: linkToken('verify', email) } });
  assertEquals(verified.status, 200);
  const token = verified.json.token as string;
  // A link works once.
  assertEquals((await call('/v1/auth/verify', { method: 'POST', body: { token: linkToken('verify', email) } })).status, 400);

  const me = await call('/v1/get-me', { token });
  assertEquals(me.status, 200);
  const profile = me.json.profile as Record<string, unknown>;
  assertEquals(profile.username, username);
  assertExists(profile.id);
  assertExists(profile.created_at);
  assertExists((me.json.user as Record<string, unknown>).email_confirmed_at);

  // Signing up again with a confirmed email reveals nothing and changes nothing.
  const before = mails.length;
  assertEquals((await call('/v1/auth/signup', { method: 'POST', body: { email, password: 'attacker-pw', username: `x${stamp}`.slice(0, 20) } })).status, 200);
  assertEquals(mails.length, before);
  // Taken Trainer names are refused up front.
  assertEquals((await call('/v1/auth/signup', { method: 'POST', body: { email: `other-${stamp}@example.com`, password: 'longenough', username: username.toUpperCase() } })).status, 409);

  assertEquals((await call('/v1/auth/login', { method: 'POST', body: { email, password: 'first-pass-1' } })).status, 400);
  assertEquals((await call('/v1/auth/login', { method: 'POST', body: { email: `nobody-${stamp}@example.com`, password: 'whatever1' } })).status, 400);
  const login = await call('/v1/auth/login', { method: 'POST', body: { email: email.toUpperCase(), password: 'second-pass-2' } });
  assertEquals(login.status, 200);
  const token2 = login.json.token as string;

  // Profile edits.
  const avatar = await call('/v1/update-profile', { method: 'PATCH', token: token2, body: { avatar_mode: 'pokemon', avatar_pokemon_id: 25 } });
  assertEquals(avatar.status, 200);
  const shiny = await call('/v1/update-profile', { method: 'PATCH', token: token2, body: { avatar_is_shiny: true } });
  assertEquals(shiny.json.avatar_config, { avatar_mode: 'pokemon', avatar_pokemon_id: 25, avatar_is_shiny: true });
  assertEquals((await call('/v1/update-profile', { method: 'PATCH', token: token2, body: { avatar_pokemon_id: 5000 } })).status, 400);
  assertEquals((await call('/v1/dismiss-tier-prompt', { method: 'PATCH', token: token2 })).json.tier_prompt_dismissed_forever, true);

  // Password reset signs out everywhere and returns a fresh session.
  assertEquals((await call('/v1/auth/recover', { method: 'POST', body: { email } })).status, 200);
  assertEquals((await call('/v1/auth/recover', { method: 'POST', body: { email: `ghost-${stamp}@example.com` } })).status, 200);
  const resetToken = linkToken('reset', email);
  assertEquals((await call('/v1/auth/reset', { method: 'POST', body: { token: resetToken, password: 'short' } })).status, 400);
  const reset = await call('/v1/auth/reset', { method: 'POST', body: { token: resetToken, password: 'third-pass-3' } });
  assertEquals(reset.status, 200);
  assertEquals((await call('/v1/get-me', { token })).status, 401);
  assertEquals((await call('/v1/get-me', { token: token2 })).status, 401);
  const token3 = reset.json.token as string;
  assertEquals((await call('/v1/get-me', { token: token3 })).status, 200);
  assertEquals((await call('/v1/auth/reset', { method: 'POST', body: { token: resetToken, password: 'fourth-pass' } })).status, 400);
  assertEquals((await call('/v1/auth/login', { method: 'POST', body: { email, password: 'third-pass-3' } })).status, 200);

  // Logout revokes the token; expired sessions are rejected.
  assertEquals((await call('/v1/auth/logout', { method: 'POST', token: token3 })).status, 200);
  assertEquals((await call('/v1/get-me', { token: token3 })).status, 401);
  const login4 = await call('/v1/auth/login', { method: 'POST', body: { email, password: 'third-pass-3' } });
  await sql`update auth_sessions set expires_at = now() - interval '1 second'
            where user_id = ${(me.json.user as { id: string }).id}`;
  assertEquals((await call('/v1/get-me', { token: login4.json.token as string })).status, 401);
});

Deno.test('taken signup name falls back to the setup modal', opts, async () => {
  const name = `race${stamp}`.slice(0, 20);
  const a = `race-a-${stamp}@example.com`;
  const b = `race-b-${stamp}@example.com`;
  assertEquals((await call('/v1/auth/signup', { method: 'POST', body: { email: a, password: 'longenough', username: name } })).status, 200);
  assertEquals((await call('/v1/auth/signup', { method: 'POST', body: { email: b, password: 'longenough', username: name } })).status, 200);
  await call('/v1/auth/verify', { method: 'POST', body: { token: linkToken('verify', a) } });
  const vb = await call('/v1/auth/verify', { method: 'POST', body: { token: linkToken('verify', b) } });
  assertEquals(vb.status, 200);
  const me = await call('/v1/get-me', { token: vb.json.token as string });
  assertEquals(me.json.profile, null);
  const taken = await call('/v1/create-profile', { method: 'POST', token: vb.json.token as string, body: { username: name } });
  assertEquals(taken.status, 409);
  const ok = await call('/v1/create-profile', { method: 'POST', token: vb.json.token as string, body: { username: `${name}b`.slice(0, 20) } });
  assertEquals(ok.status, 200);
});

Deno.test('imported accounts sign in with their old $2a$ password', opts, async () => {
  const email = `legacy-${stamp}@example.com`;
  const [u] = await sql<{ id: string }[]>`
    insert into users (email, password_hash, email_verified_at)
    values (${email}, ${bcrypt.hashSync('legacy-password', 10)}, now()) returning id`;
  const login = await call('/v1/auth/login', { method: 'POST', body: { email, password: 'legacy-password' } });
  assertEquals(login.status, 200);
  assertEquals((login.json.user as { id: string }).id, u.id);
});

Deno.test('guest play, migration to a new account, and a won game', opts, async () => {
  const guestId = `it-${crypto.randomUUID()}`;
  const ip = randomIp();

  // Guests: no Authorization header, just a guest id.
  const gs = await call(`/v1/get-session?puzzle_date_key=${today}&guest_id=${guestId}`, { ip });
  assertEquals(gs.status, 200, JSON.stringify(gs.json));
  assertEquals(gs.json.completion_state, 'playing');
  assertEquals(gs.json.pokemon_name, undefined);
  assert((gs.json.name_length as number) > 0);
  assertEquals((await call(`/v1/get-session?puzzle_date_key=${today}`)).status, 401);
  assertEquals((await call(`/v1/get-session?puzzle_date_key=2020-01-01&guest_id=${guestId}`)).status, 400);
  assertEquals((await call(`/v1/get-session?puzzle_date_key=${today}&guest_id=${guestId}`, { token: 'bogus-token' })).status, 401);

  // Pick a wrong guess: any valid name that isn't the guest's target.
  const [guestTarget] = await sql<{ target_pokemon_name: string | null }[]>`
    select target_pokemon_name from daily_sessions where guest_id = ${guestId}`;
  const wrong = guestTarget.target_pokemon_name === 'pikachu' ? 'eevee' : 'pikachu';
  const g1 = await call('/v1/submit-guess', { method: 'POST', ip, body: { guess: wrong, puzzle_date_key: today, session_version: 1, guest_id: guestId } });
  assertEquals(g1.status, 200, JSON.stringify(g1.json));
  assertEquals((g1.json.results as unknown[]).length, 1);
  assertEquals((await call('/v1/submit-guess', { method: 'POST', ip, body: { guess: 'notapokemon', puzzle_date_key: today, session_version: 2, guest_id: guestId } })).status, 400);

  // New account imports the guest game.
  const acct = await signUpAndVerify(`mig-${stamp}@example.com`, 'longenough', `mig${stamp}`.slice(0, 20));
  const mig = await call('/v1/migrate-guest', { method: 'POST', token: acct.token, body: { puzzle_date_key: today, guest_id: guestId, guesses: [wrong] } });
  assertEquals(mig.status, 200, JSON.stringify(mig.json));
  assertEquals(mig.json.migrated, true);
  assertEquals(mig.json.guesses, [wrong]);
  // A second import finds the account's session and leaves it alone.
  const again = await call('/v1/migrate-guest', { method: 'POST', token: acct.token, body: { puzzle_date_key: today, guest_id: guestId } });
  assertEquals(again.json.migrated, false);
  assertEquals((await call('/v1/migrate-guest', { method: 'POST', body: { puzzle_date_key: today, guest_id: guestId } })).status, 401);

  // Concurrent submits on the same version: exactly one wins.
  const version = mig.json.version as number;
  const answer = await targetName(acct.user.id);
  const others = ['bulbasaur', 'charmander', 'squirtle', 'eevee', 'pikachu'].filter((n) => n !== answer && n !== wrong);
  const [r1, r2] = await Promise.all([
    call('/v1/submit-guess', { method: 'POST', token: acct.token, body: { guess: others[0], puzzle_date_key: today, session_version: version } }),
    call('/v1/submit-guess', { method: 'POST', token: acct.token, body: { guess: others[1], puzzle_date_key: today, session_version: version } }),
  ]);
  assertEquals([r1.status, r2.status].sort(), [200, 409]);
  const latest = r1.status === 200 ? r1 : r2;

  // Win.
  const win = await call('/v1/submit-guess', { method: 'POST', token: acct.token, body: { guess: answer, puzzle_date_key: today, session_version: latest.json.version } });
  assertEquals(win.status, 200, JSON.stringify(win.json));
  assertEquals(win.json.completion_state, 'won');
  assertEquals(win.json.pokemon_name, answer);
  assertEquals((await call('/v1/submit-guess', { method: 'POST', token: acct.token, body: { guess: others[2], puzzle_date_key: today, session_version: win.json.version } })).status, 400);

  // The imported game was still playing, so finishing it on the account counts.
  const me = await call('/v1/get-me', { token: acct.token });
  assertEquals(me.status, 200);
  const [result] = await sql`select result from daily_results where user_id = ${acct.user.id} and puzzle_date_key = ${today}`;
  assertEquals(result.result, 'won');
  const stats = me.json.stats as Record<string, number>;
  assertEquals(stats.total_wins, 1);

  // get-balls reads the profile's display ball (was always poke-ball before).
  await sql`update profiles set display_ball = 'great-ball' where id = ${acct.user.id}`;
  const balls = await call('/v1/get-balls', { token: acct.token });
  assertEquals(balls.status, 200);
  assertEquals(balls.json.display_ball, 'great-ball');
  assertEquals(balls.json.current_streak_tier, 'poke-ball');
  assertEquals((await call('/v1/set-display-ball', { method: 'PATCH', token: acct.token, body: { ball_id: 'poke-ball' } })).status, 200);
  assertEquals((await call('/v1/set-display-ball', { method: 'PATCH', token: acct.token, body: { ball_id: 'master-ball' } })).status, 400);
  const balls2 = await call('/v1/get-balls', { token: acct.token });
  assertEquals(balls2.json.display_ball, 'poke-ball');
});

Deno.test('rate limits', opts, async () => {
  const email = `rl-${stamp}@example.com`;
  const statuses: number[] = [];
  for (let i = 0; i < 12; i++) {
    statuses.push((await call('/v1/auth/login', { method: 'POST', body: { email, password: 'wrong-pass' } })).status);
  }
  assertEquals(statuses.slice(0, 10).every((s) => s === 400), true);
  assertEquals(statuses.at(-1), 429);

  // Mail-sending endpoints: 5 per address per hour.
  const mailStatuses: number[] = [];
  for (let i = 0; i < 6; i++) {
    mailStatuses.push((await call('/v1/auth/recover', { method: 'POST', body: { email: `rl2-${stamp}@example.com` } })).status);
  }
  assertEquals(mailStatuses, [200, 200, 200, 200, 200, 429]);
});

Deno.test('google sign-in end to end against a stub provider', opts, async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'stub', alg: 'RS256', use: 'sig' };
  let idClaims: Record<string, unknown> = {};
  let lastTokenRequest: URLSearchParams | null = null;

  const stub = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/jwks') return Response.json({ keys: [jwk] });
    if (url.pathname === '/token') {
      lastTokenRequest = new URLSearchParams(await req.text());
      const idToken = await new SignJWT(idClaims)
        .setProtectedHeader({ alg: 'RS256', kid: 'stub' })
        .setIssuer('https://accounts.google.com').setAudience('stub-client')
        .setIssuedAt().setExpirationTime('5m').sign(privateKey);
      return Response.json({ id_token: idToken });
    }
    return new Response('not found', { status: 404 });
  });
  const base = `http://127.0.0.1:${(stub.addr as Deno.NetAddr).port}`;
  Deno.env.set('GOOGLE_ENABLED', 'true');
  Deno.env.set('GOOGLE_CLIENT_ID', 'stub-client');
  Deno.env.set('GOOGLE_SECRET', 'stub-secret');
  Deno.env.set('GOOGLE_AUTH_URL', `${base}/auth`);
  Deno.env.set('GOOGLE_TOKEN_URL', `${base}/token`);
  Deno.env.set('GOOGLE_JWKS_URL', `${base}/jwks`);

  async function googleLogin(sub: string, email: string) {
    idClaims = { sub, email, email_verified: true };
    const start = await call('/v1/auth/google/start?origin=http://localhost:5173');
    assertEquals(start.status, 302);
    const location = new URL(start.headers.get('location')!);
    assertEquals(location.origin + location.pathname, `${base}/auth`);
    assertEquals(location.searchParams.get('redirect_uri'), 'http://api.test/v1/auth/google/callback');
    assertEquals(location.searchParams.get('code_challenge_method'), 'S256');
    const cookie = start.headers.get('set-cookie')!.split(';')[0];

    // Wrong state is refused.
    const bad = await call(`/v1/auth/google/callback?code=c&state=wrong`, { headers: { Cookie: cookie } });
    assertEquals(new URL(bad.headers.get('location')!).searchParams.get('auth_error'), 'google');

    const cb = await call(`/v1/auth/google/callback?code=the-code&state=${location.searchParams.get('state')}`, { headers: { Cookie: cookie } });
    assertEquals(cb.status, 302);
    assertEquals(lastTokenRequest!.get('code'), 'the-code');
    assertExists(lastTokenRequest!.get('code_verifier'));
    const back = new URL(cb.headers.get('location')!);
    assertEquals(back.origin, 'http://localhost:5173');
    const code = back.searchParams.get('login');
    assertExists(code, cb.headers.get('location')!);
    const ex = await call('/v1/auth/google/exchange', { method: 'POST', body: { token: code } });
    assertEquals(ex.status, 200);
    // One-time code.
    assertEquals((await call('/v1/auth/google/exchange', { method: 'POST', body: { token: code } })).status, 400);
    return ex.json as { token: string; user: { id: string } };
  }

  try {
    // New Google account: no profile until a Trainer name is chosen.
    const fresh = await googleLogin(`sub-new-${stamp}`, `g-new-${stamp}@gmail.com`);
    assertEquals((await call('/v1/get-me', { token: fresh.token })).json.profile, null);
    // Same Google id again: same account.
    assertEquals((await googleLogin(`sub-new-${stamp}`, `g-new-${stamp}@gmail.com`)).user.id, fresh.user.id);

    // Existing confirmed password account with that email gets linked.
    const pw = await signUpAndVerify(`g-link-${stamp}@example.com`, 'longenough', `glink${stamp}`.slice(0, 20));
    assertEquals((await googleLogin(`sub-link-${stamp}`, `g-link-${stamp}@example.com`)).user.id, pw.user.id);
    assertEquals((await call('/v1/auth/login', { method: 'POST', body: { email: `g-link-${stamp}@example.com`, password: 'longenough' } })).status, 200);

    // An unconfirmed signup on the address loses its password when Google proves the inbox.
    const squat = `g-squat-${stamp}@example.com`;
    await call('/v1/auth/signup', { method: 'POST', body: { email: squat, password: 'squatter-pw', username: `sq${stamp}`.slice(0, 20) } });
    await googleLogin(`sub-squat-${stamp}`, squat);
    assertEquals((await call('/v1/auth/login', { method: 'POST', body: { email: squat, password: 'squatter-pw' } })).status, 400);
  } finally {
    await stub.shutdown();
    Deno.env.set('GOOGLE_ENABLED', 'false');
  }
});
