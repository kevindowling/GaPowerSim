import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'

/**
 * Use a preinstalled Chromium when one is present. Sandboxed CI images often ship
 * a browser build that doesn't match the pinned Playwright revision, and
 * downloading is either blocked or wasteful — pointing at the existing binary is
 * both faster and the only option when egress is restricted.
 */
const PREINSTALLED_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const executablePath = existsSync(PREINSTALLED_CHROME) ? PREINSTALLED_CHROME : undefined

/**
 * Chromium is preinstalled in this environment at PLAYWRIGHT_BROWSERS_PATH, so
 * there is never a reason to run `playwright install` here.
 *
 * The web server builds first and serves `dist/`, which means the smoke tests
 * exercise the same static output the iframe embed will actually load —
 * including the vendored data files.
 */
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './tests/.artifacts',
  fullyParallel: true,
  reporter: process.env.CI ? 'line' : 'list',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } },
    },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
