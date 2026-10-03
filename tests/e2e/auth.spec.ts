import { test, expect } from '@playwright/test'

const API = 'https://wurmple-api.ajmsd.space'
const calls: string[] = []

test.describe('Auth flows', () => {
  // Sign-up and reset run against a mocked auth API so the suite never creates
  // real accounts or sends real email on prod.
  test.beforeEach(async ({ page }) => {
    await page.route(`${API}/**`, async (route) => {
      const req = route.request()
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers })
      const path = new URL(req.url()).pathname
      calls.push(path)
      const json = (body: unknown) =>
        route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) })
      if (path.endsWith('/functions/v1/validate-email')) return json({ valid: true })
      if (path.endsWith('/auth/v1/signup')) {
        // Email confirmation on: GoTrue returns the user without a session.
        return json({ id: '00000000-0000-4000-8000-0000000000a1', email: 'x@example.com', aud: 'authenticated', role: '', identities: [{}] })
      }
      if (path.endsWith('/auth/v1/recover')) return json({})
      return json({})
    })
    calls.length = 0
  })

  test('sign-up shows email verification message', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.getByRole('button', { name: /sign up/i }).first().click()

    await page.getByLabel(/trainer name/i).fill('E2ETrainer')
    await page.getByLabel(/email/i).fill('e2e-signup@example.com')
    await page.getByLabel(/password/i).fill('TestPassword123!')
    await page.getByRole('button', { name: /create account/i }).click()

    await expect(page.getByText(/check your inbox/i)).toBeVisible({ timeout: 10000 })
    expect(calls.some((c) => c.endsWith('/auth/v1/signup'))).toBe(true)
  })

  test('password reset shows confirmation message', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.getByRole('button', { name: /forgot password/i }).click()

    await page.getByLabel(/email/i).fill('test@example.com')
    await page.getByRole('button', { name: /send recovery link/i }).click()

    await expect(page.getByText(/reset email sent|check your inbox/i)).toBeVisible({ timeout: 10000 })
    expect(calls.some((c) => c.endsWith('/auth/v1/recover'))).toBe(true)
  })

  test('sign out persists after refresh and keeps protected actions gated', async ({ page }) => {
    const email = process.env.E2E_AUTH_EMAIL
    const password = process.env.E2E_AUTH_PASSWORD
    test.skip(!email || !password, 'Set E2E_AUTH_EMAIL and E2E_AUTH_PASSWORD to run authenticated sign-out regression')

    await page.goto('/')
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.getByLabel(/email/i).fill(email!)
    await page.getByLabel(/password/i).fill(password!)
    await page.locator('button[type="submit"]').filter({ hasText: 'Sign In' }).click()

    const signOutButton = page.getByRole('button', { name: /sign out/i })
    await expect(signOutButton).toBeVisible({ timeout: 10000 })
    await signOutButton.click()

    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible({ timeout: 2000 })
    await expect(page.getByRole('button', { name: /sign out/i })).toBeHidden()
    await expect(page.getByRole('button', { name: /profile/i })).toBeHidden()

    await page.reload()

    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('button', { name: /sign out/i })).toBeHidden()
    await expect(page.getByRole('button', { name: /profile/i })).toBeHidden()
    await expect(page.getByRole('button', { name: /collection/i })).toBeHidden()

    await page.getByRole('button', { name: /^sign in$/i }).click()
    await expect(page.getByRole('button', { name: /forgot password/i })).toBeVisible({ timeout: 5000 })
  })
})
