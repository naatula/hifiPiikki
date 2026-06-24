// @ts-check
const { defineConfig, devices } = require('@playwright/test')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

/**
 * The SPA shares one SQLite dev DB and one server session, so tests run serially
 * (workers: 1) — parallel writes to the same tabs/sessions would interfere.
 * Uses the system Google Chrome (channel: 'chrome') so no browser download is
 * needed; install with PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1.
 */
module.exports = defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  globalSetup: require.resolve('./global-setup.js'),

  use: {
    baseURL: 'http://127.0.0.1:8000',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],

  // Launch the Django dev server for the run (reused if one is already up).
  // Requires a configured .env (DEBUG=True, FORCE_SCRIPT_NAME=) per the dev setup.
  webServer: {
    command: 'venv/bin/python manage.py runserver 127.0.0.1:8000',
    cwd: ROOT,
    url: 'http://127.0.0.1:8000/static/index.html',
    reuseExistingServer: true,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
