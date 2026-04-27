import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
  timeout: 30000,
  projects: [
    {
      name: 'desktop',
      use: { viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 5'],
      },
    },
  ],
})
