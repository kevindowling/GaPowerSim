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
 * `--no-sandbox` because these containers run as root, and Chromium refuses to
 * start its zygote sandbox as root. The pages under test are our own static
 * build, so there is no untrusted content to sandbox away from.
 */
const launchOptions = { executablePath, args: ['--no-sandbox'] }

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
      use: { ...devices['Desktop Chrome'], launchOptions },
      // The mobile layout is a different arrangement, not a narrower one, so it
      // gets its own project rather than doubling every desktop test.
      testIgnore: '**/mobile.spec.ts',
    },
    {
      name: 'mobile',
      testMatch: '**/mobile.spec.ts',
      // iPhone 13's device profile defaults to WebKit, which isn't installed
      // here. We want its viewport, DPR and touch flags, not its engine.
      use: { ...devices['iPhone 13'], browserName: 'chromium', launchOptions },
    },
  ],
  webServer: {
    // `--host 127.0.0.1` is load-bearing. Left to its default, vite preview binds
    // to "localhost", which on a GitHub runner resolves to ::1 first while
    // Playwright polls 127.0.0.1 — the server comes up healthy and the wait times
    // out anyway. Binding explicitly to the address being polled removes the
    // ambiguity.
    command: 'npm run build && npx vite preview --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Surface the build and server output. Without this a failure to start is
    // reported only as a timeout, with no indication of why.
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
