const { test, expect } = require('@playwright/test')
const h = require('./helpers')

test.describe('Inventory stock tracking', () => {
  test.beforeEach(async ({ context }) => {
    h.seed('reset')
    await h.blockPopstate(context)
  })

  test('purchasing a stock-tracked product decrements stock_quantity', async ({ page }) => {
    expect(h.productStock(h.PRODUCT_STOCK)).toBe(10)
    await h.login(page)
    await h.startPurchase(page, h.PRODUCT_STOCK)
    // Single-price product starts at quantity 1.
    await h.selectCheckoutTab(page)
    await h.confirmPurchase(page)
    await expect(page.locator('.main-panel')).toHaveClass(/active/, { timeout: 10_000 })
    expect(h.countPurchases()).toBe(1)
    expect(h.productStock(h.PRODUCT_STOCK)).toBe(9)
  })

  test('stock decrements by the purchased quantity', async ({ page }) => {
    await h.login(page)
    await h.startPurchase(page, h.PRODUCT_STOCK)
    // Buy 3 units.
    await page.locator('.checkout-quantity .quantity-button.increase').click()
    await page.locator('.checkout-quantity .quantity-button.increase').click()
    await h.selectCheckoutTab(page)
    await h.confirmPurchase(page)
    await expect(page.locator('.main-panel')).toHaveClass(/active/, { timeout: 10_000 })
    expect(h.productStock(h.PRODUCT_STOCK)).toBe(7) // 10 - 3
  })

  test('a cash purchase also decrements stock', async ({ page }) => {
    h.setSetting('cash_enabled', 'true')
    await h.login(page)
    await h.startPurchase(page, h.PRODUCT_STOCK)
    // Set regular quantity to 0, cash to 2.
    await h.setQuantity(page, '#quantity-out', '0')
    await page.locator('.checkout-quantity:has(#quantity-cash) .quantity-button.increase').click()
    await page.locator('.checkout-quantity:has(#quantity-cash) .quantity-button.increase').click()
    await h.selectCheckoutTab(page)
    await h.confirmPurchase(page)
    await expect(page.locator('.main-panel')).toHaveClass(/active/, { timeout: 10_000 })
    expect(h.tabBalance(h.TAB)).toBe(0.00) // cash = no balance move
    expect(h.productStock(h.PRODUCT_STOCK)).toBe(8) // 10 - 2 (stock still decremented)
  })
})
