const { test, expect } = require('@playwright/test')
const h = require('./helpers')

test.describe('Multi-tab purchases', () => {
  test.beforeEach(async ({ context }) => {
    h.seed('reset')
    await h.blockPopstate(context)
  })

  test('one purchase splits across several selected tabs', async ({ page }) => {
    await h.login(page)
    await h.startPurchase(page)
    await page.locator('#multi-tab-toggle').click()
    await expect(page.locator('#multi-tab-toggle')).toHaveClass(/active/)
    await page.locator('.checkout-panel .tab-list .tabs > div', { hasText: h.TAB }).first().click()
    await page.locator('.checkout-panel .tab-list .tabs > div', { hasText: h.TAB2 }).first().click()
    await h.confirmPurchase(page)
    await expect(page.locator('.main-panel')).toHaveClass(/active/, { timeout: 10_000 })
    expect(h.countPurchases()).toBe(2)
  })

  test('multi-tab purchase including a PIN tab', async ({ page }) => {
    await h.login(page)
    await h.startPurchase(page)
    await page.locator('#multi-tab-toggle').click()
    await expect(page.locator('#multi-tab-toggle')).toHaveClass(/active/)
    await page.locator('.checkout-panel .tab-list .tabs > div', { hasText: h.TAB }).first().click()
    await page.locator('.checkout-panel .tab-list .tabs > div', { hasText: h.PIN_TAB }).first().click()
    await expect(page.locator('#confirmation')).toHaveClass(/pin-mode/)
    await h.enterPin(page, h.PIN_CODE)
    await expect(page.locator('#confirmation')).not.toHaveClass(/pin-mode/, { timeout: 5_000 })
    await h.confirmPurchase(page)
    await expect(page.locator('.main-panel')).toHaveClass(/active/, { timeout: 10_000 })
    expect(h.countPurchases()).toBe(2)
  })

  test('multi-tab purchase recovers when the session expires', async ({ page, context }) => {
    await h.login(page, { remember: true })
    await h.startPurchase(page)
    await page.locator('#multi-tab-toggle').click()
    await page.locator('.checkout-panel .tab-list .tabs > div', { hasText: h.TAB }).first().click()
    await page.locator('.checkout-panel .tab-list .tabs > div', { hasText: h.TAB2 }).first().click()

    await h.expireSession(context)
    await h.confirmPurchase(page)

    await expect.poll(() => h.countPurchases(), { timeout: 15_000 }).toBe(2)
    await h.expectQueueEmpty(page)
    await page.waitForTimeout(500)
    expect(h.countPurchases()).toBe(2)
    expect(await h.loginShown(page)).toBe(false)
  })
})
