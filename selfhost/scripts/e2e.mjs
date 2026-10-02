// End-to-end smoke test against the public API: creates a throwaway confirmed
// user, signs in, plays a guess, checks stats and row-level privacy, then
// deletes the user. Run on ajmsd with selfhost/.env loaded:
//   set -a; . selfhost/.env; set +a; node selfhost/scripts/e2e.mjs
import { randomUUID } from 'node:crypto';

const api = process.env.API_EXTERNAL_URL ?? 'https://wurmple-api.ajmsd.space';
const admin = process.env.ADMIN_URL ?? 'http://127.0.0.1:54321'; // admin calls stay local
const anon = process.env.ANON_KEY;
const service = process.env.SERVICE_ROLE_KEY;
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const stamp = Date.now().toString(36);
const email = `e2e-${stamp}@ajmsd.space`;
const password = `E2e-${randomUUID()}`;

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
}

async function call(url, { method = 'GET', token = anon, body, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      apikey: anon,
      Authorization: `Bearer ${token}`,
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

let userId;
try {
  const created = await call(`${admin}/auth/v1/admin/users`, {
    method: 'POST', token: service, headers: { apikey: service },
    body: { email, password, email_confirm: true },
  });
  userId = created.json?.id;
  check('admin creates confirmed test user', created.status === 200 && !!userId, `status ${created.status}`);

  const login = await call(`${api}/auth/v1/token?grant_type=password`, { method: 'POST', body: { email, password } });
  const token = login.json?.access_token;
  check('password sign-in via public API', login.status === 200 && !!token, `status ${login.status}`);

  const profile = await call(`${api}/functions/v1/create-profile`, { method: 'POST', token, body: { username: `e2e${stamp}`.slice(0, 15) } });
  check('create-profile', profile.status === 200 || profile.status === 201, `status ${profile.status}`);

  const puzzle = await call(`${api}/functions/v1/get-daily-puzzle`, { token });
  check('get-daily-puzzle', puzzle.status === 200 && puzzle.json?.puzzle_date_key === today, `key ${puzzle.json?.puzzle_date_key}`);

  const session = await call(`${api}/functions/v1/get-session?puzzle_date_key=${today}`, { token });
  check('get-session', session.status === 200, `status ${session.status}`);

  const guess = await call(`${api}/functions/v1/submit-guess`, { method: 'POST', token, body: { guess: 'pikachu', puzzle_date_key: today, session_version: session.json?.version } });
  check('submit-guess (today)', guess.status === 200, `status ${guess.status}`);

  const stale = await call(`${api}/functions/v1/submit-guess`, { method: 'POST', token, body: { guess: 'eevee', puzzle_date_key: '2026-01-01' } });
  check('submit-guess rejects past day', stale.status === 400, `status ${stale.status}`);

  const me = await call(`${api}/functions/v1/get-me`, { token });
  check('get-me returns own profile', me.status === 200 && !!me.json?.profile, `status ${me.status}`);

  const balls = await call(`${api}/functions/v1/get-balls`, { token });
  check('get-balls', balls.status === 200, `status ${balls.status}`);

  const profiles = await call(`${api}/rest/v1/profiles?select=id`, { token });
  check('REST: only own profile visible', profiles.status === 200 && profiles.json.length === 1 && profiles.json[0].id === userId, `rows ${profiles.json.length}`);

  const sessions = await call(`${api}/rest/v1/daily_sessions?select=user_id`, { token });
  check('REST: only own sessions visible', sessions.status === 200 && sessions.json.every((s) => s.user_id === userId), `rows ${sessions.json.length}`);

  const puzzles = await call(`${api}/rest/v1/daily_puzzles?select=pokemon_name`, { token });
  check('REST: puzzle answers hidden', puzzles.status === 200 && puzzles.json.length === 0, `rows ${puzzles.json.length}`);

  const write = await call(`${api}/rest/v1/ball_unlocks`, { method: 'POST', token, body: { user_id: userId, ball_id: 'master-ball' } });
  check('REST: direct writes blocked', write.status === 401 || write.status === 403, `status ${write.status}`);

  const logout = await call(`${api}/auth/v1/logout`, { method: 'POST', token });
  check('sign-out', logout.status === 204, `status ${logout.status}`);
} catch (err) {
  check('unexpected error', false, err.message);
} finally {
  if (userId) {
    const del = await call(`${admin}/auth/v1/admin/users/${userId}`, { method: 'DELETE', token: service, headers: { apikey: service } });
    check('cleanup: test user deleted', del.status === 200, `status ${del.status}`);
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
