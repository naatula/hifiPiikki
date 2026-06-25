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

  test('buying multiples via the stepper records the total', async ({ page }) => {
    await h.login(page)
    await h.startPurchase(page)
    // Step quantity from 1 to 3 (two clicks on +).
    await page.locator('.checkout-quantity .quantity-button.increase').click()
    await page.locator('.checkout-quantity .quantity-button.increase').click()
    await h.selectCheckoutTab(page)
    await h.confirmPurchase(page)
    await expect(page.locator('.main-panel')).toHaveClass(/active/, { timeout: 10_000 })
    expect(h.countPurchases()).toBe(1)
    expect(h.tabBalance(h.TAB)).toBe(-9.00) // 3 × 3.00
  })

  test('a decimal quantity is handled correctly', async ({ page }) => {
    await h.login(page)
    await h.startPurchase(page)
    await h.setQuantity(page, '#quantity-out', '1.5')
    await h.selectCheckoutTab(page)
    await h.confirmPurchase(page)
    await expect(page.locator('.main-panel')).toHaveClass(/active/, { timeout: 10_000 })
    expect(h.countPurchases()).toBe(1)
    expect(h.tabBalance(h.TAB)).toBe(-4.50) // 1.5 × 3.00
  })

  test('a dual-price product shows separate in/out quantity inputs', async ({ page }) => {
    await h.login(page)
    await h.startPurchase(page, h.PRODUCT_INOUT)
    // Dual-price products show two rows: "Sisään" and "Ulos", both starting at 0.
    await expect(page.locator('#quantity-in')).toBeVisible()
    await expect(page.locator('#quantity-out')).toBeVisible()
    await expect(page.locator('.checkout-quantity', { hasText: 'Sisään' })).toBeVisible()
    await expect(page.locator('.checkout-quantity', { hasText: 'Ulos' })).toBeVisible()
    // Set out to 1 and confirm — a single-direction purchase.
    await page.locator('.checkout-quantity:has(#quantity-out) .quantity-button.increase').click()
    await h.selectCheckoutTab(page)
    await h.confirmPurchase(page)
    await expect(page.locator('.main-panel')).toHaveClass(/active/, { timeout: 10_000 })
    expect(h.countPurchases()).toBe(1)
    expect(h.tabBalance(h.TAB)).toBe(-4.00) // 1 × 4.00 (out price)
  })
})
