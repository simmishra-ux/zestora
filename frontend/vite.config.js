import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// The "@" alias lets us write `@/components/Navbar` instead of `../../components/Navbar`.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 4200,
    // Browser calls /api/... on port 4200 and Vite forwards it to FastAPI on 8000.
    // Same origin for the browser = no CORS headaches in development.
    // API_URL lets the end-to-end tests point the same app at a throwaway backend (see e2e/playwright.config.js).
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:8000' },
  },
})
