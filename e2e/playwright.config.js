// End-to-end tests: a REAL browser drives the REAL frontend, which talks to the REAL backend and a REAL (throwaway) database.
//
// Playwright starts its own copy of the whole stack, on different ports from your dev servers:
//     backend  http://localhost:8100   database: e2e/.tmp/e2e.db   (deleted and rebuilt on every run)
//     frontend http://localhost:4300   (its /api proxy points at the port-8100 backend)
// so running the tests never touches your development data, and no real email can ever be sent.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, 'e2e', '.tmp')
const API_PORT = 8100
const WEB_PORT = 4300
const db = path.join(tmp, 'e2e.db')

// Use a Chromium-based browser that is already installed (no big download). Override with E2E_BROWSER=/path/to/browser.
const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
]
const executablePath = process.env.E2E_BROWSER ?? CANDIDATES.find((p) => fs.existsSync(p))

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1, // the tests share one database and one stock level per product, so they run one after another
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'desktop', testIgnore: /mobile\.spec/, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'mobile', testMatch: /mobile\.spec/, use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      // 1) wipe last run's database and emails, 2) start the API. It migrates and seeds itself on startup.
      command: `rm -rf "${tmp}" && mkdir -p "${tmp}" && exec ${root}/backend/.venv/bin/uvicorn app.main:app --port ${API_PORT}`,
      cwd: path.join(root, 'backend'),
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 90_000,
      env: {
        DATABASE_URL: `sqlite:///${db}`,
        OUTBOX_DIR: path.join(tmp, 'outbox'),
        SECRET_KEY: 'e2e-only-secret-key-0123456789abcdef',
        GATEWAY_WEBHOOK_SECRET: 'whsec_e2e_only',
        ADMIN_EMAILS: 'admin@zestora.dev',
        SMTP_USER: '', // empty on purpose: even if backend/.env has real Gmail settings, tests must never send real email
        SMTP_PASSWORD: '',
        DEV_INBOX: '1',
      },
    },
    {
      command: `npm run dev -- --port ${WEB_PORT} --strictPort`,
      cwd: path.join(root, 'frontend'),
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 90_000,
      env: { API_URL: `http://localhost:${API_PORT}` },
    },
  ],
})
