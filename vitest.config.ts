import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: [
      '**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'supabase/functions/_shared/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/tests/e2e/**'],
  },
})
