import { chromium, defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'

// Use an installed browser when the pinned build is missing.
const INSTALLED = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium', '/usr/bin/google-chrome']
const pinned = existsSync(chromium.executablePath())
const executablePath = pinned ? undefined : INSTALLED.find((p) => existsSync(p))

// CI containers run as root, where the Chromium sandbox will not start.
const launchOptions = { executablePath, args: ['--no-sandbox'] }

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './tests/.artifacts',
  fullyParallel: true,
  reporter: process.env.CI ? 'line' : 'list',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    // Recording every test slows all of them.
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions },
      testIgnore: '**/mobile.spec.ts',
    },
    {
      name: 'mobile',
      testMatch: '**/mobile.spec.ts',
      use: { ...devices['iPhone 13'], browserName: 'chromium', launchOptions },
    },
  ],
  webServer: {
    // CI typechecks in its own job.
    command: `${process.env.CI ? 'npx vite build' : 'npm run build'} && npx vite preview --port 4173 --strictPort --host 127.0.0.1`,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
