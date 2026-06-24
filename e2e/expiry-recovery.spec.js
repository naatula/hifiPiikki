// Regression guard for the "session expires right as you act" cases: every
// mutation must be recovered (buffered → silent re-auth → idempotent replay)
// without losing data, double-charging, or popping the login dialog.
//
// We assert on the server-side outcome (poll the row count) rather than the
// client queue: a purchase is enqueued inside a 500ms timeout, so the queue is
// briefly empty *before* buffering — polling it would pass prematurely.
const { test, expect } = require('@playwright/test')
const h = require('./helpers')

const POLL = { timeout: 15_000 }

test.describe('Mutation recovery on session expiry', () => {
  test.beforeEach(async ({ context }) => {
    h.seed('reset')
    await h.blockPopstate(context)
  })

  test('a purchase made as the session expires is buffered, re-authed and charged exactly once', async ({ page, context }) => {
    await h.login(page, { remember: true })
    await h.startPurchase(page)
    await h.selectCheckoutTab(page)

    await h.expireSession(context)
    await h.confirmPurchase(page)

    await expect.poll(() => h.countPurchases(), POLL).toBe(1) // recovered & replayed
    await h.expectQueueEmpty(page)
    await page.waitForTimeout(500)
    expect(h.countPurchases()).toBe(1)                        // still exactly once — no double-charge
    expect(await h.loginShown(page)).toBe(false)              // recovered silently
  })

  test('starting a host session as the session expires recovers and persists', async ({ page, context }) => {
    await h.login(page, { remember: true })
    await page.locator('#session-info').click()
    await expect(page.locator('.session-panel')).toHaveClass(/active/)
    await page.locator('#session-tab-list .tabs > div', { hasText: h.TAB }).first().click()
    await expect(page.locator('#session-confirm')).not.toHaveClass(/disabled/)

    await h.expireSession(context)
    await page.locator('#session-confirm').click()

    await expect.poll(() => h.countActiveSessions(), POLL).toBe(1)
    expect(await h.loginShown(page)).toBe(false)
    await expect(page.locator('#session-info')).toHaveClass(/active/) // host indicator shows
  })

  test('ending a host session as the session expires recovers and persists', async ({ page, context }) => {
    await h.login(page, { remember: true })
    // Establish an active session first (authenticated).
    await page.locator('#session-info').click()
    await expect(page.locator('.session-panel')).toHaveClass(/active/)
    await page.locator('#session-tab-list .tabs > div', { hasText: h.TAB }).first().click()
    await page.locator('#session-confirm').click()
    await expect(page.locator('#session-info')).toHaveClass(/active/)
    await expect.poll(() => h.countActiveSessions(), POLL).toBe(1)

    // Now end it just as the session expires.
    await page.locator('#session-info').click()
    await expect(page.locator('.session-panel')).toHaveClass(/active/)
    await page.locator('#session-people').fill('7')
    await page.locator('#session-comment').fill('illan hostaus')

    await h.expireSession(context)
    await page.locator('#session-end').click()

    await expect.poll(() => h.countActiveSessions(), POLL).toBe(0) // ended on the server
    expect(h.countSessions()).toBe(1)                              // exactly one session, not duplicated
    expect(await h.loginShown(page)).toBe(false)
    await expect(page.locator('#session-info')).not.toHaveClass(/active/)
  })
})
