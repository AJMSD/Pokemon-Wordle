import { test, expect } from '@playwright/test'

test.describe('Guest game flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for the app to load
    await page.waitForLoadState('networkidle')
  })

  test('game board renders with guess input', async ({ page }) => {
    await expect(page.locator('.guess-input')).toBeVisible()
    await expect(page.locator('.guess-input')).toBeEnabled()
  })

  test('submitting a guess shows a colored tile row', async ({ page }) => {
    const input = page.locator('.guess-input')
    await input.fill('pikachu')

    // Submit via the form button or Enter key
    await input.press('Enter')

    // Wait for a guess item to appear
    await expect(page.locator('.guess-item').first()).toBeVisible({ timeout: 10000 })

    // At least one letter block should be rendered
    await expect(page.locator('.letter-block').first()).toBeVisible()
  })

  test('ability hint is not revealed before 3rd guess', async ({ page }) => {
    const input = page.locator('.guess-input')

    // Submit 2 guesses
    await input.fill('pikachu')
    await input.press('Enter')
    await page.waitForTimeout(1500)

    await input.fill('bulbasaur')
    await input.press('Enter')
    await page.waitForTimeout(1500)

    // Ability hint should still be hidden after 2 guesses
    const hiddenValue = page.locator('.hidden-value')
    await expect(hiddenValue).toBeVisible()
  })

  test('ability hint is revealed after 3rd guess', async ({ page }) => {
    const input = page.locator('.guess-input')

    const guesses = ['pikachu', 'bulbasaur', 'charmander']
    for (const g of guesses) {
      await input.fill(g)
      await input.press('Enter')
      await page.waitForTimeout(1500)
    }

    // After 3 guesses, ability hint should appear as revealed
    await expect(page.locator('.revealed-value').first()).toBeVisible({ timeout: 5000 })
  })
})
