// Shared helpers + fixtures for the e2e specs.
const { expect } = require('@playwright/test')
const { execFileSync } = require('child_process')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const PY = path.join(ROOT, 'venv', 'bin', 'python')

// Fixture names — must match e2e/seed.py.
const USER = 'claude'
const PASSWORD = 'claude'
const PRODUCT = 'E2E Olut'
const TAB = 'E2E Testi'        // non-PIN tab
const TAB2 = 'E2E Testi 2'    // second non-PIN tab (for multi-tab tests)
const PIN_TAB = 'E2E PIN'      // PIN-protected tab
const PIN_CODE = '123456'
const PIN_LOCKOUT_THRESHOLD = 3

// Run a seed.py command and return its trimmed stdout (e.g. seed('reset'),
// Number(seed('purchase-count'))).
function seed(...args) {
  return execFileSync(PY, [path.join('e2e', 'seed.py'), ...args], { cwd: ROOT }).toString().trim()
}
const countPurchases = () => Number(seed('purchase-count'))
const countSessions = () => Number(seed('session-count'))
const countActiveSessions = () => Number(seed('active-session-count'))
const tabBalance = (name) => parseFloat(seed('tab-balance', name))
const pinAttempts = (name) => Number(seed('pin-attempts', name))

// localStorage probes.
const queue = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('piikki.queue') || '[]'))
const storedCreds = (page) => page.evaluate(() => localStorage.getItem('piikki.creds'))
const loginShown = (page) => page.evaluate(() => document.querySelector('.login-panel').classList.contains('active'))

// Simulate the server session expiring: drop all cookies so the next API call
// is unauthenticated (403). The link stays up, so it's an auth lapse, not offline.
const expireSession = (context) => context.clearCookies()

async function login(page, { remember = true } = {}) {
  await page.goto('/static/index.html')
  await page.locator('#username').fill(USER)
  await page.locator('#password').fill(PASSWORD)
  if (!remember) await page.locator('#login-remember').uncheck()
  await page.locator('#login').click()
  await expect(page.locator('.main-panel')).toHaveClass(/active/, { timeout: 10_000 })
}

// Open checkout for a product and select a tab so the confirm button enables.
async function startPurchase(page, product = PRODUCT) {
  await page.locator('.product-column .products > div', { hasText: product }).first().click()
  await expect(page.locator('.checkout-panel')).toHaveClass(/active/)
}
async function selectCheckoutTab(page, tab = TAB) {
  await page.locator('.checkout-panel .tab-list .tabs > div', { hasText: tab }).first().click()
  await expect(page.locator('#confirmation .button')).not.toHaveClass(/disabled/)
}
const confirmPurchase = (page) => page.locator('#confirmation .button').click()

// Type a 6-digit PIN on whichever keypad is visible.
async function enterPin(page, pin, selector = '#pinpad') {
  for (const digit of pin) {
    await page.locator(`${selector} .pin-key[data-digit="${digit}"]`).click()
  }
}

// Wait until the offline queue has fully drained (recovery complete).
async function expectQueueEmpty(page, timeout = 15_000) {
  await expect
    .poll(async () => (await queue(page)).length, { timeout })
    .toBe(0)
}

// Block all /api/ requests to simulate offline.
async function goOffline(page) {
  await page.route('**/api/**', route => route.abort('connectionrefused'))
}

async function goOnline(page) {
  await page.unroute('**/api/**')
}

// Chromium automation fires a spurious popstate event that races with
// PiikkiBack's history-based overlay tracking, closing panels immediately
// after they open. Call before login on tests that open overlay panels.
async function blockPopstate(context) {
  await context.addInitScript(() => {
    window.addEventListener('popstate', e => e.stopImmediatePropagation(), true)
  })
}

module.exports = {
  USER, PASSWORD, PRODUCT, TAB, TAB2, PIN_TAB, PIN_CODE, PIN_LOCKOUT_THRESHOLD,
  seed, countPurchases, countSessions, countActiveSessions, tabBalance, pinAttempts,
  queue, storedCreds, loginShown, expireSession,
  login, startPurchase, selectCheckoutTab, confirmPurchase, enterPin,
  expectQueueEmpty, goOffline, goOnline, blockPopstate,
}
