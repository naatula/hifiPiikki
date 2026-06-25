const { test, expect } = require('@playwright/test')
const h = require('./helpers')

test.describe('Host sessions (happy path)', () => {
  test.beforeEach(async ({ context }) => {
    h.seed('reset')
    await h.blockPopstate(context)
  })

  test('start a host session, then end it', async ({ page }) => {
    await h.login(page)

    // Start
    await page.locator('#session-info').click()
    await expect(page.locator('.session-panel')).toHaveClass(/active/)
    await expect(page.locator('.session-panel')).not.toHaveClass(/opening/)
    await page.locator('#session-tab-list .tabs > div', { hasText: h.TAB }).first().click()
    await expect(page.locator('#session-confirm')).not.toHaveClass(/disabled/)
    await page.locator('#session-confirm').click()
    await expect(page.locator('#session-info')).toHaveClass(/active/)
    expect(h.countActiveSessions()).toBe(1)

    // End
    await page.locator('#session-info').click()
    await expect(page.locator('.session-panel')).toHaveClass(/active/)
    await page.locator('#session-people').fill('5')
    await page.locator('#session-comment').fill('e2e')
    await page.locator('#session-end').click()
    await expect(page.locator('#session-info')).not.toHaveClass(/active/)
    expect(h.countActiveSessions()).toBe(0)
    expect(h.countSessions()).toBe(1)
  })

  test('ending a session validates people and comment', async ({ page }) => {
    await h.login(page)

    // Start a session.
    await page.locator('#session-info').click()
    await expect(page.locator('.session-panel')).toHaveClass(/active/)
    await expect(page.locator('.session-panel')).not.toHaveClass(/opening/)
    await page.locator('#session-tab-list .tabs > div', { hasText: h.TAB }).first().click()
    await page.locator('#session-confirm').click()
    await expect(page.locator('#session-info')).toHaveClass(/active/)
    expect(h.countActiveSessions()).toBe(1)

    // Try to end without people → error.
    await page.locator('#session-info').click()
    await expect(page.locator('.session-panel')).toHaveClass(/active/)
    await page.locator('#session-comment').fill('e2e')
    await page.locator('#session-end').click()
    await expect(page.locator('#session-people')).toHaveClass(/error/)
    expect(h.countActiveSessions()).toBe(1) // still active

    // Fill people but clear comment → comment error.
    await page.locator('#session-people').fill('5')
    await page.locator('#session-comment').fill('')
    await page.locator('#session-end').click()
    await expect(page.locator('#session-comment')).toHaveClass(/error/)
    expect(h.countActiveSessions()).toBe(1) // still active

    // Fill both → succeeds.
    await page.locator('#session-people').fill('5')
    await page.locator('#session-comment').fill('ok')
    await page.locator('#session-end').click()
    await expect(page.locator('#session-info')).not.toHaveClass(/active/)
    expect(h.countActiveSessions()).toBe(0)
    expect(h.countSessions()).toBe(1)
  })

  test('session summary shows host and total amounts', async ({ page }) => {
    await h.login(page)

    // Start a session on TAB.
    await page.locator('#session-info').click()
    await expect(page.locator('.session-panel')).toHaveClass(/active/)
    await expect(page.locator('.session-panel')).not.toHaveClass(/opening/)
    await page.locator('#session-tab-list .tabs > div', { hasText: h.TAB }).first().click()
    await page.locator('#session-confirm').click()
    await expect(page.locator('#session-info')).toHaveClass(/active/)

    // Make a purchase to TAB (the session host).
    await h.startPurchase(page)
    await h.selectCheckoutTab(page)
    await h.confirmPurchase(page)
    await expect(page.locator('.main-panel')).toHaveClass(/active/, { timeout: 10_000 })
    expect(h.countPurchases()).toBe(1)

    // Reopen session panel — should show summary totals.
    await page.locator('#session-info').click()
    await expect(page.locator('.session-panel')).toHaveClass(/active/)
    await expect(page.locator('.session-panel')).not.toHaveClass(/opening/)
    await expect(page.locator('#session-name')).toHaveText(h.TAB)
    await expect(page.locator('#session-total-host')).toContainText('3')
    await expect(page.locator('#session-total-all')).toContainText('3')
  })
})
