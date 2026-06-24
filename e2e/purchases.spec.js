const { test, expect } = require('@playwright/test')
const h = require('./helpers')

test.describe('Purchases (happy path)', () => {
  test.beforeEach(async ({ context }) => {
    h.seed('reset')
    await h.blockPopstate(context)
  })

  test('a single product purchase is recorded once', async ({ page }) => {
    await h.login(page)
    await h.startPurchase(page)
    await h.selectCheckoutTab(page)
    await h.confirmPurchase(page)
    // Confirm animation + POST; the app returns to the main panel on success.
    await expect(page.locator('.main-panel')).toHaveClass(/active/, { timeout: 10_000 })
    expect(h.countPurchases()).toBe(1)
  })

  test('a custom-amount purchase ("Oma summa") is recorded', async ({ page }) => {
    await h.login(page)
    await page.locator('.quick-payment').click()
    await expect(page.locator('.checkout-panel')).toHaveClass(/active/)
    await page.locator('#custom-price').fill('4,50')
    await page.locator('.checkout-panel .tab-list .tabs > div', { hasText: h.TAB }).first().click()
    await expect(page.locator('#confirmation .button')).not.toHaveClass(/disabled/)
    await h.confirmPurchase(page)
    await expect(page.locator('.main-panel')).toHaveClass(/active/, { timeout: 10_000 })
    expect(h.countPurchases()).toBe(1)
  })
})
