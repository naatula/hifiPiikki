const { test, expect } = require('@playwright/test')
const h = require('./helpers')

test.describe('Statistics', () => {
  test.beforeEach(async ({ context }) => {
    h.seed('reset')
    await h.blockPopstate(context)
  })

  test('lists all tabs with balances', async ({ page }) => {
    await h.login(page)
    await page.locator('#statistics-button').click()
    await expect(page.locator('.statistics-panel')).toHaveClass(/active/)
    await expect(page.locator('.statistics-tabs > div', { hasText: h.TAB }).first()).toBeVisible()
    await expect(page.locator('.statistics-tabs > div', { hasText: h.PIN_TAB })).toBeVisible()
    await expect(page.locator('.statistics-tabs .tab-balance').first()).toBeVisible()
  })

  test('opens a tab detail view', async ({ page }) => {
    await h.login(page)
    await page.locator('#statistics-button').click()
    await expect(page.locator('.statistics-panel')).toHaveClass(/active/)
    await page.locator('.statistics-tabs > div', { hasText: h.TAB }).first().click()
    await expect(page.locator('.statistics-detail-view')).toBeVisible()
    await expect(page.locator('#statistics-tab-name')).toHaveText(h.TAB)
    await expect(page.locator('#statistics-tab-status')).toContainText('Käytössä')
    await expect(page.locator('#statistics-tab-balance')).toContainText('€')
  })

  test('adjusts a tab balance', async ({ page }) => {
    await h.login(page)
    await h.startPurchase(page)
    await h.selectCheckoutTab(page)
    await h.confirmPurchase(page)
    await expect(page.locator('.main-panel')).toHaveClass(/active/, { timeout: 10_000 })
    expect(h.countPurchases()).toBe(1)

    await page.locator('#statistics-button').click()
    await expect(page.locator('.statistics-panel')).toHaveClass(/active/)
    await page.locator('.statistics-tabs > div', { hasText: h.TAB }).first().click()
    await expect(page.locator('.statistics-detail-view')).toBeVisible()
    await expect(page.locator('#statistics-tab-balance')).toContainText('-')
    await expect(page.locator('.statistics-purchases > div').first()).toContainText(h.PRODUCT)
  })
})
