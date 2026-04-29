import { test, expect } from '@playwright/test'

test.describe('Auth flows', () => {
  test('sign-up shows email verification message', async ({ page }) => {
    await page.goto('/')

    // Open auth modal — look for a sign-in button in the header
    await page.getByRole('button', { name: /sign in/i }).click()

    // Switch to sign-up tab/link
    await page.getByRole('button', { name: /sign up/i }).click()

    // Fill in credentials with a unique email
    const email = `test-${Date.now()}@gmail.com`
    await page.getByLabel(/email/i).fill(email)
    await page.getByLabel(/password/i).fill('TestPassword123!')

    await page.getByRole('button', { name: /create account|sign up/i }).click()

    // Assert confirmation message
    await expect(page.getByText(/check your inbox/i)).toBeVisible({ timeout: 10000 })
  })

  test('password reset shows confirmation message', async ({ page }) => {
    await page.goto('/')

    // Open auth modal
    await page.getByRole('button', { name: /sign in/i }).click()

    // Go to forgot password
    await page.getByRole('button', { name: /forgot password/i }).click()

    // Enter email
    await page.getByLabel(/email/i).fill('test@example.com')
    await page.getByRole('button', { name: /send reset|reset/i }).click()

    // Assert success message
    await expect(page.getByText(/reset.*sent|check your email/i)).toBeVisible({ timeout: 10000 })
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
