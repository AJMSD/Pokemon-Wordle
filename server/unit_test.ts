// Unit tests that need no database:  deno test -A server/unit_test.ts
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from 'jose';
import bcrypt from 'bcryptjs';

Deno.env.set('TARGET_SALT', 'unit-test-salt');

const { pendingMigrations } = await import('./migrate.ts');
const { needsTouch, publicUser, SESSION_TOUCH_INTERVAL_MS } = await import('./auth/session.ts');
const { bearerToken, randomToken, sha256Hex } = await import('./auth/tokens.ts');
const { normalizeEmail, isDisposableEmail, passwordError, usernameError } = await import('./auth/validation.ts');
const { verifyPassword, hashPassword } = await import('./auth/passwords.ts');
const { verifyGoogleIdToken, signCookie, readCookie } = await import('./auth/google.ts');

const opts = { sanitizeResources: false, sanitizeOps: false };

Deno.test('migrations run in filename order and skip applied ones', () => {
  const files = ['0002_b.sql', 'README.md', '0001_baseline.sql', '0010_c.sql', '0003_x.sql.bak'];
  assertEquals(pendingMigrations(files, []), ['0001_baseline.sql', '0002_b.sql', '0010_c.sql']);
  assertEquals(pendingMigrations(files, ['0001_baseline', '0010_c']), ['0002_b.sql']);
});

Deno.test('tokens are random, url-safe, and hashed as hex sha256', async () => {
  const a = randomToken();
  const b = randomToken();
  assert(a !== b);
  assert(/^[A-Za-z0-9_-]{40,}$/.test(a));
  assertEquals(
    await sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
  assertEquals(bearerToken('Bearer xyz'), 'xyz');
  assertEquals(bearerToken('bearer   xyz'), 'xyz');
  assertEquals(bearerToken('Basic xyz'), null);
  assertEquals(bearerToken(null), null);
});

Deno.test('session expiry is bumped at most hourly', () => {
  const now = Date.now();
  assertEquals(needsTouch(new Date(now - 5 * 60_000), now), false);
  assertEquals(needsTouch(new Date(now - SESSION_TOUCH_INTERVAL_MS), now), true);
});

Deno.test('publicUser keeps the email_confirmed_at field name', () => {
  const at = new Date('2026-10-01T00:00:00Z');
  assertEquals(publicUser({ id: 'u', email: 'a@b.co', email_verified_at: at }), {
    id: 'u', email: 'a@b.co', email_confirmed_at: '2026-10-01T00:00:00.000Z',
  });
  assertEquals(publicUser({ id: 'u', email: 'a@b.co', email_verified_at: null }).email_confirmed_at, null);
});

Deno.test('email, password and username rules', () => {
  assertEquals(normalizeEmail('  Ash@Kanto.COM '), 'ash@kanto.com');
  assertEquals(normalizeEmail('nope'), null);
  assertEquals(normalizeEmail(42), null);
  assert(isDisposableEmail('x@mailinator.com'));
  assert(!isDisposableEmail('x@gmail.com'));
  assert(passwordError('short') !== null);
  assertEquals(passwordError('longenough'), null);
  assert(passwordError('x'.repeat(73)) !== null);
  assertEquals(usernameError('Ash_K'), null);
  assert(usernameError('ab') !== null);
  assert(usernameError('_ash') !== null);
  assert(usernameError('has space') !== null);
});

Deno.test('passwords: bcrypt round trip and $2a$ hashes from the old auth server', opts, async () => {
  const hash = await hashPassword('pikachu123');
  assert(await verifyPassword('pikachu123', hash));
  assert(!(await verifyPassword('wrong-pass', hash)));
  // bcryptjs 2.x emits $2a$ like GoTrue (Go's bcrypt) did.
  const legacy = bcrypt.hashSync('legacy-pass', 10);
  assert(legacy.startsWith('$2a$10$'));
  assert(await verifyPassword('legacy-pass', legacy));
  assert(!(await verifyPassword('anything', null)));
  assert(!(await verifyPassword('anything', 'not-a-hash')));
});

Deno.test('oauth cookie: signed, tamper-evident, expiring', opts, async () => {
  const value = { state: 's', verifier: 'v', origin: 'http://localhost:5173', exp: Date.now() + 60_000 };
  const cookie = await signCookie(value);
  assertEquals(await readCookie(cookie), value);
  const [payload, sig] = cookie.split('.');
  const forged = btoa(JSON.stringify({ ...value, origin: 'https://evil.example' })).replace(/=+$/, '');
  assertEquals(await readCookie(`${forged}.${sig}`), null);
  assertEquals(await readCookie(`${payload}.AAAA`), null);
  assertEquals(await readCookie(cookie, value.exp + 1), null);
  assertEquals(await readCookie(undefined), null);
});

Deno.test('google id_token verification', opts, async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const issuers = ['https://accounts.google.com'];
  const sign = (claims: Record<string, unknown>, aud = 'client-1', iss = issuers[0]) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(iss)
      .setAudience(aud)
      .setSubject('google-sub-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

  const ok = await verifyGoogleIdToken(await sign({ email: 'Ash@Gmail.com', email_verified: true }), {
    clientId: 'client-1', issuers, keys,
  });
  assertEquals(ok, { sub: 'google-sub-1', email: 'ash@gmail.com' });

  await assertRejects(async () => verifyGoogleIdToken(
    await sign({ email: 'a@b.co', email_verified: true }, 'other-client'), { clientId: 'client-1', issuers, keys }));
  await assertRejects(async () => verifyGoogleIdToken(
    await sign({ email: 'a@b.co', email_verified: true }, 'client-1', 'https://evil.example'), { clientId: 'client-1', issuers, keys }));
  await assertRejects(async () => verifyGoogleIdToken(
    await sign({ email: 'a@b.co', email_verified: false }), { clientId: 'client-1', issuers, keys }));
  // Signed by a key Google doesn't publish.
  const other = await generateKeyPair('RS256');
  const foreign = await new SignJWT({ email: 'a@b.co', email_verified: true })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(issuers[0]).setAudience('client-1')
    .setSubject('x').setExpirationTime('5m').sign(other.privateKey);
  await assertRejects(async () => verifyGoogleIdToken(foreign, { clientId: 'client-1', issuers, keys }));
});
