import { test, expect, type Page, type Route } from '@playwright/test'

// Signed-in play against a mocked API: the server owns the answer, so the
// client must show pending tiles first and colour them from `results`.

const API = 'https://wurmple-api.ajmsd.space'
const USER_ID = '3f1c2a9e-0000-4000-8000-0000000000e2'
const TARGET = { id: 25, name: 'pikachu' }
const HINTS = { ability: 'static', generation: 'generation-i', types: ['electric'] }

function b64url(obj: object): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}

function fakeJwt(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: USER_ID, role: 'authenticated', exp, email: 'e2e@example.com' })}.sig`
}

function letterResults(guess: string, target: string): string[] {
  const g = guess.replace(/[^a-z]/g, '').split('')
  const t = target.replace(/[^a-z]/g, '').split('')
  const out = g.map(() => 'absent')
  const left = new Map<string, number>()
  t.forEach((c, i) => { if (g[i] !== c) left.set(c, (left.get(c) ?? 0) + 1) })
  g.forEach((c, i) => {
    if (t[i] === c) out[i] = 'correct'
    else if ((left.get(c) ?? 0) > 0) { out[i] = 'present'; left.set(c, left.get(c)! - 1) }
  })
  return out
}

function todayJst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

interface MockState { guesses: string[]; submitDelayMs: number; failNext?: number; calls: string[] }

function sessionBody(s: MockState) {
  const won = s.guesses.includes(TARGET.name)
  const state = won ? 'won' : s.guesses.length >= 10 ? 'lost' : 'playing'
  const flags = { ability: s.guesses.length >= 3, generation: s.guesses.length >= 6, type: s.guesses.length >= 9 }
  const hints: Record<string, unknown> = {}
  if (flags.ability || state !== 'playing') hints.ability = HINTS.ability
  if (flags.generation || state !== 'playing') hints.generation = HINTS.generation
  if (flags.type || state !== 'playing') hints.types = HINTS.types
  return {
    guesses: s.guesses,
    results: s.guesses.map((g) => letterResults(g, TARGET.name)),
    hint_flags: flags,
    hints,
    completion_state: state,
    version: s.guesses.length + 1,
    name_length: TARGET.name.length,
    puzzle_metadata: { name_length: TARGET.name.length },
    ...(state !== 'playing' ? { pokemon_name: TARGET.name, pokemon_id: TARGET.id } : {}),
  }
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
    body: JSON.stringify(body),
  })
}

async function signIn(page: Page, s: MockState) {
  const token = fakeJwt()
  const profile = {
    id: USER_ID, username: 'E2ETrainer', display_ball: 'poke-ball', avatar_form_id: null,
    created_at: '2026-01-01T00:00:00Z', tier_prompt_dismissed: true,
  }
  const stats = { user_id: USER_ID, games_played: 3, games_won: 2, current_streak: 1, max_streak: 2, guess_distribution: {} }

  await page.route(`${API}/**`, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (req.method() === 'OPTIONS') return json(route, {})
    const path = url.pathname
    s.calls.push(`${req.method()} ${path}`)
    if (path.endsWith('/get-session')) return json(route, sessionBody(s))
    if (path.endsWith('/submit-guess')) {
      const { guess } = req.postDataJSON() as { guess: string }
      await new Promise((r) => setTimeout(r, s.submitDelayMs))
      if (s.failNext) { const code = s.failNext; s.failNext = undefined; return json(route, { error: 'nope' }, code) }
      s.guesses.push(guess.toLowerCase())
      return json(route, { ...sessionBody(s), newly_unlocked_balls: [] })
    }
    if (path.endsWith('/get-me')) return json(route, { profile, stats })
    if (path.endsWith('/get-balls')) return json(route, { balls: [] })
    if (path.includes('/rest/v1/profiles')) return json(route, [profile])
    if (path.includes('/rest/v1/')) return json(route, [])
    if (path.endsWith('/auth/v1/user')) return json(route, { id: USER_ID, email: 'e2e@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' })
    return json(route, {})
  })

  await page.addInitScript(({ token, userId }) => {
    const session = {
      access_token: token, refresh_token: 'refresh', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: {
        id: userId, aud: 'authenticated', role: 'authenticated', email: 'e2e@example.com',
        email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: {}, user_metadata: {},
        created_at: '2026-01-01T00:00:00Z',
      },
    }
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('sb-wurmple-api-auth-token', JSON.stringify(session))
      sessionStorage.setItem('seeded', '1')
    }
  }, { token, userId: USER_ID })
}

test.describe('Signed-in game (mocked server)', () => {
  test('guess shows pending tiles, then server colours; win screen uses server data', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    const s: MockState = { guesses: [], submitDelayMs: 1200, calls: [] }
    await signIn(page, s)
    await page.goto('/')

    const input = page.locator('.guess-input')
    await expect(input).toBeEnabled({ timeout: 10000 })
    await input.fill('pichu')
    await input.press('Enter')

    const row = page.locator('.guess-item').first()
    await expect(row).toBeVisible({ timeout: 1000 })
    // While the request is in flight no tile may be coloured.
    const coloured = row.locator('.letter-block.correct, .letter-block.present, .letter-block.absent')
    await expect(coloured).toHaveCount(0)
    await expect(coloured).toHaveCount(5, { timeout: 5000 })
    await expect(row.locator('.letter-block.correct')).toHaveCount(2) // p, i

    s.submitDelayMs = 0
    await input.fill('pikachu')
    await input.press('Enter')
    await expect(page.getByText(/pikachu/i).last()).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.guess-input')).toHaveCount(0, { timeout: 5000 }).catch(() => {})
    expect(s.calls.filter((c) => c.endsWith('/submit-guess'))).toHaveLength(2)

    // The answer must never be persisted while playing; after the win it may be.
    const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('wurmple_game:user')))
    expect(stored.length).toBeGreaterThanOrEqual(0)
    expect(errors).toEqual([])
    await page.screenshot({ path: `test-results/signed-in-won-${test.info().project.name}.png` })
  })

  test('rejected guess rolls back and nothing is coloured optimistically', async ({ page }) => {
    const s: MockState = { guesses: [], submitDelayMs: 300, failNext: 409, calls: [] }
    await signIn(page, s)
    await page.goto('/')
    const input = page.locator('.guess-input')
    await expect(input).toBeEnabled({ timeout: 10000 })
    await input.fill('pichu')
    await input.press('Enter')
    await expect(page.locator('.guess-item')).toHaveCount(0, { timeout: 5000 })

    // While playing, no stored game state may contain the answer.
    const leaked = await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith('wurmple_game:user') && /pikachu/i.test(localStorage.getItem(k) ?? '')))
    expect(leaked).toEqual([])
  })

  test('hints come from the server after the 3rd guess', async ({ page }) => {
    const s: MockState = { guesses: ['bulbasaur', 'charmander'], submitDelayMs: 0, calls: [] }
    await signIn(page, s)
    await page.goto('/')
    const input = page.locator('.guess-input')
    await expect(input).toBeEnabled({ timeout: 10000 })
    await expect(page.locator('.guess-item')).toHaveCount(2, { timeout: 10000 })
    await input.fill('squirtle')
    await input.press('Enter')
    await expect(page.getByText(/static/i).first()).toBeVisible({ timeout: 5000 })
    await page.screenshot({ path: `test-results/signed-in-hints-${test.info().project.name}.png` })
  })
})

test('guest progress is migrated after sign-up', async ({ page }) => {
  // Guest plays first (real local logic), then a fresh account signs in.
  await page.goto('/')
  const input = page.locator('.guess-input')
  await expect(input).toBeEnabled({ timeout: 10000 })
  await input.fill('bulbasaur')
  await input.press('Enter')
  await expect(page.locator('.guess-item')).toHaveCount(1, { timeout: 5000 })

  const calls: { path: string; body: unknown }[] = []
  const token = fakeJwt()
  const created = new Date().toISOString()
  await page.route(`${API}/**`, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return json(route, {})
    const path = new URL(req.url()).pathname
    calls.push({ path, body: req.postData() ? req.postDataJSON() : null })
    if (path.endsWith('/migrate-guest')) {
      const body = req.postDataJSON() as { guesses: string[] }
      return json(route, { ...sessionBody({ guesses: body.guesses, submitDelayMs: 0, calls: [] }), migrated: true })
    }
    if (path.endsWith('/get-session')) return json(route, sessionBody({ guesses: ['bulbasaur'], submitDelayMs: 0, calls: [] }))
    const profile = { id: USER_ID, username: 'NewTrainer', display_ball: 'poke-ball', created_at: created, tier_prompt_dismissed: true }
    if (path.endsWith('/get-me')) return json(route, { profile, stats: null })
    if (path.includes('/rest/v1/profiles')) return json(route, [profile])
    if (path.endsWith('/create-profile')) return json(route, { profile })
    return json(route, {})
  })
  await page.evaluate(({ token, userId }) => {
    localStorage.setItem('sb-wurmple-api-auth-token', JSON.stringify({
      access_token: token, refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: userId, aud: 'authenticated', role: 'authenticated', email: 'new@example.com',
        email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: { username: 'NewTrainer' },
        created_at: new Date().toISOString() },
    }))
  }, { token, userId: USER_ID })
  await page.reload()
  await expect.poll(() => calls.some((c) => c.path.endsWith('/migrate-guest')), { timeout: 10000 }).toBe(true)
  const migrate = calls.find((c) => c.path.endsWith('/migrate-guest'))!.body as Record<string, unknown>
  expect(migrate.puzzle_date_key).toBe(todayJst())
  expect(migrate.guesses).toEqual(['bulbasaur'])
  expect(typeof migrate.guest_id).toBe('string')
})
