import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

// Browser flows against a real API + database (no mocks). Opt-in:
//   E2E_REAL_API=http://127.0.0.1:8000   the API the site was built/served with
//   E2E_MAIL_LOG=/path/to/api.log        the API's stdout, run with MAIL_MODE=log
// The API's SITE_URL must be this suite's baseURL so email links come back here.
const API = process.env.E2E_REAL_API
const MAIL_LOG = process.env.E2E_MAIL_LOG

test.skip(!API || !MAIL_LOG, 'set E2E_REAL_API and E2E_MAIL_LOG to run against a real API')
test.describe.configure({ mode: 'serial' })

function lastLink(to: string, param: 'verify' | 'reset'): string {
  const lines = readFileSync(MAIL_LOG!, 'utf8').split('\n').filter((l) => l.includes('"fn":"mailer"'))
  for (const line of lines.reverse()) {
    const mail = JSON.parse(line) as { to: string; text: string }
    const match = mail.to === to && mail.text.match(new RegExp(`https?://\\S+[?&]${param}=[\\w%-]+`))
    if (match) return match[0]
  }
  throw new Error(`no ${param} mail for ${to}`)
}

async function waitForLink(to: string, param: 'verify' | 'reset'): Promise<string> {
  let link = ''
  await expect.poll(() => { try { link = lastLink(to, param); return true } catch { return false } }, { timeout: 10000 }).toBe(true)
  return link
}

async function openAuth(page: Page) {
  await page.getByRole('button', { name: /^sign in$/i }).click()
  await page.waitForTimeout(800)
}

const stamp = Date.now().toString(36)
// One account per Playwright project (desktop/mobile run in parallel).
const email = () => `pw-${stamp}-${test.info().project.name}@example.com`
const username = () => `pw${stamp}${test.info().project.name[0]}`.slice(0, 20)

test('guest plays, signs up, confirms by email and keeps the game', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')

  // Guest guess (on the server from PER_USER_START_DATE, locally before).
  const input = page.locator('.guess-input')
  await expect(input).toBeEnabled({ timeout: 15000 })
  await input.fill('bulbasaur')
  await input.press('Enter')
  await expect(page.locator('.guess-item')).toHaveCount(1, { timeout: 10000 })

  // Sign up.
  await openAuth(page)
  await page.getByRole('button', { name: /sign up/i }).first().click()
  await page.waitForTimeout(500)
  await page.getByLabel(/trainer name/i).fill(username())
  await page.getByLabel(/email/i).fill(email())
  await page.getByLabel(/password/i).fill('FirstPass123')
  await page.getByRole('button', { name: /create account/i }).click()
  await expect(page.getByText(/check your inbox/i)).toBeVisible({ timeout: 10000 })

  // Confirm from the email link: signed in, and the guest guess came along.
  const migrated = page.waitForResponse((r) => r.url().includes('/v1/migrate-guest'))
  await page.goto(await waitForLink(email(), 'verify'))
  const migrateReply = await migrated
  expect(migrateReply.status()).toBe(200)
  expect((await migrateReply.json()).migrated).toBe(true)
  await expect(page.getByRole('button', { name: /^sign in$/i })).toBeHidden({ timeout: 15000 })
  await expect(page.locator('.guess-item')).toHaveCount(1, { timeout: 15000 })
  await expect(page.getByText('Guest', { exact: true })).toBeHidden()
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('wurmple_auth') ?? '{}').token)
  const me = await page.request.get(`${API}/v1/get-me`, { headers: { Authorization: `Bearer ${token}` } })
  expect((await me.json()).profile.username).toBe(username())
  expect(new URL(page.url()).search).toBe('')
  expect(errors).toEqual([])
})

test('password sign-in, sign-out, and password reset by email', async ({ page }) => {
  await page.goto('/')
  await openAuth(page)
  await page.getByLabel(/email/i).fill(email())
  await page.getByLabel(/password/i).fill('FirstPass123')
  await page.locator('button[type="submit"]').filter({ hasText: 'Sign In' }).click()
  await expect(page.getByRole('button', { name: /^sign in$/i })).toBeHidden({ timeout: 15000 })
  await expect(page.locator('.guess-item')).toHaveCount(1, { timeout: 15000 })

  // Sign out through the store (the button lives in different menus per layout).
  await page.evaluate(() => localStorage.removeItem('wurmple_auth'))
  await page.reload()
  await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible({ timeout: 10000 })

  // Forgot password -> email -> new password -> signed in.
  await openAuth(page)
  await page.getByRole('button', { name: /forgot password/i }).click()
  await page.waitForTimeout(500)
  await page.getByLabel(/email/i).fill(email())
  await page.getByRole('button', { name: /send recovery link/i }).click()
  await expect(page.getByText(/reset email sent/i)).toBeVisible({ timeout: 10000 })

  await page.goto(await waitForLink(email(), 'reset'))
  await page.waitForTimeout(800)
  await page.getByLabel(/^new password/i).fill('SecondPass456')
  await page.getByLabel(/confirm password/i).fill('SecondPass456')
  await page.getByRole('button', { name: /confirm new password/i }).click()
  await expect(page.getByRole('button', { name: /^sign in$/i })).toBeHidden({ timeout: 15000 })

  // The old password no longer works; the new one does.
  const old = await page.request.post(`${API}/v1/auth/login`, { data: { email: email(), password: 'FirstPass123' } })
  expect(old.status()).toBe(400)
  const fresh = await page.request.post(`${API}/v1/auth/login`, { data: { email: email(), password: 'SecondPass456' } })
  expect(fresh.status()).toBe(200)
})
