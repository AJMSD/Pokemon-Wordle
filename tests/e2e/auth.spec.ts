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
})
