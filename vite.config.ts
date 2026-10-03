import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // Vite 8 bundles with Rolldown: manualChunks must be a function.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react-vendor'
          if (/node_modules[\\/]@supabase[\\/]/.test(id)) return 'supabase-vendor'
          return undefined
        },
      },
    },
  },
})
