const { test, expect } = require('@playwright/test')
const h = require('./helpers')

test.describe('Cash checkout', () => {
  test.beforeEach(async ({ context }) => {
    h.seed('reset')
    await h.blockPopstate(context)
  })

  test('the cash row appears when cash_enabled is true', async ({ page }) => {
    h.setSetting('cash_enabled', 'true')
    await h.login(page)
    await h.startPurchase(page)
    await expect(page.locator('#quantity-cash')).toBeVisible()
    await expect(page.locator('.checkout-quantity', { hasText: 'Käteinen' })).toBeVisible()
  })

  test('the cash row is absent when cash_enabled is false (default)', async ({ page }) => {
    await h.login(page)
    await h.startPurchase(page)
    await expect(page.locator('#quantity-cash')).toHaveCount(0)
  })

  test('a cash purchase records the purchase but does not move the tab balance', async ({ page }) => {
    h.setSetting('cash_enabled', 'true')
    await h.login(page)
    await h.startPurchase(page)
    // Set regular quantity to 0 and cash to 1.
    await h.setQuantity(page, '#quantity-out', '0')
    await page.locator('.checkout-quantity:has(#quantity-cash) .quantity-button.increase').click()
    await h.selectCheckoutTab(page)
    await h.confirmPurchase(page)
    await expect(page.locator('.main-panel')).toHaveClass(/active/, { timeout: 10_000 })
    expect(h.countPurchases()).toBe(1)
    expect(h.tabBalance(h.TAB)).toBe(0.00) // cash = free, no balance move
  })
})
