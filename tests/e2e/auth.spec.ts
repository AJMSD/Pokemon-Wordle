import { test, expect, type Page, type Route } from '@playwright/test'

const API = process.env.E2E_API_URL || 'https://wurmple-api.ajmsd.space'
const USER = { id: '00000000-0000-4000-8000-0000000000a1', email: 'ash@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' }
const PROFILE = { id: USER.id, username: 'AshK', avatar_config: {}, display_ball: 'poke-ball', tier_prompt_dismissed_forever: true, created_at: '2026-01-01T00:00:00Z' }

interface Call { method: string; path: string; body: unknown }

// The auth API is mocked so the suite never creates real accounts or sends email.
async function mockApi(page: Page, overrides: Record<string, (route: Route) => unknown> = {}) {
  const calls: Call[] = []
  await page.route(`${API}/**`, async (route) => {
    const req = route.request()
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const path = new URL(req.url()).pathname
    calls.push({ method: req.method(), path, body: req.postData() ? req.postDataJSON() : null })
    if (overrides[path]) return overrides[path](route)
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
    if (path === '/v1/get-me') return json({ user: USER, profile: PROFILE, stats: null })
    if (path === '/v1/auth/verify' || path === '/v1/auth/reset' || path === '/v1/auth/google/exchange' || path === '/v1/auth/login') {
      return json({ token: 'session-token-1', user: USER })
    }
    return json({ ok: true })
  })
  return calls
}

const signedInBearer = (calls: Call[]) => calls.find((c) => c.path === '/v1/get-me')

test.describe('Auth flows', () => {
  test('sign-up shows email verification message', async ({ page }) => {
    const calls = await mockApi(page)
    await page.goto('/')
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.getByRole('button', { name: /sign up/i }).first().click()
    await page.waitForTimeout(800)

    await page.getByLabel(/trainer name/i).fill('E2ETrainer')
    await page.getByLabel(/email/i).fill('e2e-signup@example.com')
    await page.getByLabel(/password/i).fill('TestPassword123!')
    await page.getByRole('button', { name: /create account/i }).click()

    await expect(page.getByText(/check your inbox/i)).toBeVisible({ timeout: 10000 })
    const signup = calls.find((c) => c.path === '/v1/auth/signup')
    expect(signup?.body).toEqual({ email: 'e2e-signup@example.com', password: 'TestPassword123!', username: 'E2ETrainer' })
  })

  test('password reset request shows confirmation message', async ({ page }) => {
    const calls = await mockApi(page)
    await page.goto('/')
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.getByRole('button', { name: /forgot password/i }).click()
    await page.waitForTimeout(800)

    await page.getByLabel(/email/i).fill('test@example.com')
    await page.getByRole('button', { name: /send recovery link/i }).click()

    await expect(page.getByText(/reset email sent|check your inbox/i)).toBeVisible({ timeout: 10000 })
    expect(calls.find((c) => c.path === '/v1/auth/recover')?.body).toEqual({ email: 'test@example.com' })
  })

  test('email link (?verify=) signs the new trainer in', async ({ page }) => {
    const calls = await mockApi(page)
    await page.goto('/?verify=verify-token-abc')
    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeHidden({ timeout: 10000 })
    expect(calls.find((c) => c.path === '/v1/auth/verify')?.body).toEqual({ token: 'verify-token-abc' })
    await expect.poll(() => signedInBearer(calls)).toBeTruthy()
    await expect(page).toHaveURL(/\/$/)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('wurmple_auth') ?? '{}').token)).toBe('session-token-1')
  })

  test('expired email link shows a message and stays signed out', async ({ page }) => {
    await mockApi(page, {
      '/v1/auth/verify': (route) => route.fulfill({
        status: 400, contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: 'invalid_token' }),
      }),
    })
    await page.goto('/?verify=expired')
    await expect(page.getByText(/invalid or has expired/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible()
  })

  test('reset link (?reset=) opens the new-password form and signs in', async ({ page }) => {
    const calls = await mockApi(page)
    await page.goto('/?reset=reset-token-xyz')
    await page.waitForTimeout(800)
    await page.getByLabel(/^new password/i).fill('BrandNewPass1')
    await page.getByLabel(/confirm password/i).fill('BrandNewPass1')
    await page.getByRole('button', { name: /confirm new password/i }).click()

    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeHidden({ timeout: 10000 })
    expect(calls.find((c) => c.path === '/v1/auth/reset')?.body).toEqual({ token: 'reset-token-xyz', password: 'BrandNewPass1' })
  })

  test('Google sign-in round trip', async ({ page, baseURL }) => {
    const calls = await mockApi(page, {
      // Stands in for the API -> Google -> API callback hops.
      '/v1/auth/google/start': (route) => route.fulfill({ status: 302, headers: { location: `${baseURL}/?login=google-code-1` } }),
    })
    await page.goto('/')
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.getByRole('button', { name: /continue with google/i }).first().click()

    await expect.poll(() => calls.find((c) => c.path === '/v1/auth/google/exchange')?.body, { timeout: 10000 })
      .toEqual({ token: 'google-code-1' })
    expect(calls.find((c) => c.path === '/v1/auth/google/start')).toBeTruthy()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeHidden({ timeout: 10000 })
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('wurmple_auth') ?? '{}').token)).toBe('session-token-1')
  })

  test('sign out persists after refresh and keeps protected actions gated', async ({ page }) => {
    const calls = await mockApi(page)
    await page.addInitScript((user) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('wurmple_auth', JSON.stringify({ token: 'session-token-1', user }))
        sessionStorage.setItem('seeded', '1')
      }
    }, USER)
    await page.goto('/')

    const signOutButton = page.getByRole('button', { name: /sign out/i })
    // On phones the sign-out button lives in the Trainer menu.
    if (!(await signOutButton.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: /trainer menu|profile|AshK/i }).first().click().catch(() => {})
    }
    await expect(signOutButton).toBeVisible({ timeout: 10000 })
    await signOutButton.click()

    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible({ timeout: 5000 })
    await expect.poll(() => calls.some((c) => c.path === '/v1/auth/logout')).toBe(true)
    expect(await page.evaluate(() => localStorage.getItem('wurmple_auth'))).toBeNull()

    await page.reload()
    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('button', { name: /sign out/i })).toBeHidden()
    await expect(page.getByRole('button', { name: /collection/i })).toBeHidden()
  })
})
