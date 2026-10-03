// End-to-end smoke test against the public API: seeds a throwaway account (via
// psql in the postgres container), signs in through the password-reset flow,
// plays a guess, checks stats and that the old API paths are gone, then
// deletes the account. Run on ajmsd from the repo root:
//   node selfhost/scripts/e2e.mjs
// API_URL / SITE_URL override the targets; COMPOSE_PROJECT_NAME selects a
// non-default stack (e.g. staging).
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const api = process.env.API_URL ?? 'https://wurmple-api.ajmsd.space';
const site = process.env.SITE_URL ?? 'https://wurmple.ajmsd.space';
const composeFile = fileURLToPath(new URL('../docker-compose.yml', import.meta.url));
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const stamp = Date.now().toString(36);
const email = `e2e-${stamp}@ajmsd.space`;
const password = `E2e-${randomUUID()}`;

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
}

function psql(query) {
  return execFileSync('docker', ['compose', '-f', composeFile, 'exec', '-T', 'postgres',
    'psql', '-U', 'postgres', '-d', 'wurmple', '-v', 'ON_ERROR_STOP=1', '-qtAc', query], { encoding: 'utf8' }).trim();
}

async function call(path, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

// Browser preflights (Node's fetch skips CORS, so check the headers directly).
for (const path of ['/v1/get-me', '/v1/auth/login', '/v1/submit-guess']) {
  const res = await fetch(`${api}${path}`, {
    method: 'OPTIONS',
    headers: { Origin: site, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
  });
  const allowed = res.headers.get('access-control-allow-origin');
  check(`CORS preflight ${path}`, res.ok && allowed === site, `status ${res.status}, allow-origin ${allowed}`);
}

// The old auth/REST/functions paths no longer exist.
for (const path of ['/functions/v1/get-me', '/auth/v1/user', '/rest/v1/profiles']) {
  const res = await call(path);
  check(`old path gone ${path}`, res.status === 404, `status ${res.status}`);
}

check('health', (await call('/v1/health')).status === 200);

const guestId = `e2e-${randomUUID()}`;
const guest = await call(`/v1/get-session?puzzle_date_key=${today}&guest_id=${guestId}`);
check('guest get-session (no Authorization)', guest.status === 200 && guest.json.pokemon_name === undefined, `status ${guest.status}`);

let userId;
try {
  userId = psql(`insert into users (email, email_verified_at) values ('${email}', now()) returning id`);
  const resetToken = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(resetToken).digest('hex');
  psql(`insert into auth_tokens (token_hash, user_id, kind, expires_at) values ('${hash}', '${userId}', 'reset', now() + interval '10 minutes')`);
  check('seeded test user', /^[0-9a-f-]{36}$/.test(userId), userId);

  const reset = await call('/v1/auth/reset', { method: 'POST', body: { token: resetToken, password } });
  check('password reset signs in', reset.status === 200 && !!reset.json.token, `status ${reset.status}`);

  const login = await call('/v1/auth/login', { method: 'POST', body: { email, password } });
  const token = login.json?.token;
  check('password sign-in', login.status === 200 && !!token, `status ${login.status}`);

  const profile = await call('/v1/create-profile', { method: 'POST', token, body: { username: `e2e${stamp}`.slice(0, 15) } });
  check('create-profile', profile.status === 200, `status ${profile.status}`);

  const session = await call(`/v1/get-session?puzzle_date_key=${today}`, { token });
  check('get-session', session.status === 200, `status ${session.status}`);

  const guess = await call('/v1/submit-guess', { method: 'POST', token, body: { guess: 'pikachu', puzzle_date_key: today, session_version: session.json?.version } });
  check('submit-guess (today)', guess.status === 200, `status ${guess.status}`);

  const stale = await call('/v1/submit-guess', { method: 'POST', token, body: { guess: 'eevee', puzzle_date_key: '2026-01-01' } });
  check('submit-guess rejects past day', stale.status === 400, `status ${stale.status}`);

  const me = await call('/v1/get-me', { token });
  check('get-me returns own profile', me.status === 200 && me.json?.profile?.id === userId, `status ${me.status}`);

  const balls = await call('/v1/get-balls', { token });
  check('get-balls', balls.status === 200 && !!balls.json.display_ball, `status ${balls.status}`);

  const logout = await call('/v1/auth/logout', { method: 'POST', token });
  check('sign-out', logout.status === 200, `status ${logout.status}`);
  check('token revoked', (await call('/v1/get-me', { token })).status === 401);
} catch (err) {
  check('unexpected error', false, err.message);
} finally {
  if (userId) {
    psql(`delete from users where id = '${userId}'`);
    check('cleanup: test user deleted', psql(`select count(*) from users where id = '${userId}'`) === '0');
  }
  psql(`delete from daily_sessions where guest_id = '${guestId}'`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
