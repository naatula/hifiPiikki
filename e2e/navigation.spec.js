const { test, expect } = require('@playwright/test')
const h = require('./helpers')

test.describe('Navigation and panel controls', () => {
  test.beforeEach(async ({ context }) => {
    h.seed('reset')
    await h.blockPopstate(context)
  })

  test('checkout back arrow returns to the main panel', async ({ page }) => {
    await h.login(page)
    await h.startPurchase(page)
    await expect(page.locator('.checkout-panel')).toHaveClass(/active/)
    await page.locator('.checkout-panel .back').click()
    await expect(page.locator('.main-panel')).toHaveClass(/active/)
  })

  test('session panel close button dismisses the panel', async ({ page }) => {
    await h.login(page)
    await page.locator('#session-info').click()
    await expect(page.locator('.session-panel')).toHaveClass(/active/)
    await expect(page.locator('.session-panel')).not.toHaveClass(/opening/)
    // The selection view is visible (no active session); its close button is the
    // one the user sees. Both .close buttons fire closeSessionWindow.
    await page.locator('.session-selection .close').click()
    await expect(page.locator('.session-panel')).not.toHaveClass(/active/)
  })

  test('statistics panel close button dismisses the panel', async ({ page }) => {
    await h.login(page)
    await page.locator('#statistics-button').click()
    await expect(page.locator('.statistics-panel')).toHaveClass(/active/)
    await expect(page.locator('.statistics-panel')).not.toHaveClass(/opening/)
    // The list view is visible on open; detail view (and its close) is hidden.
    await page.locator('.statistics-list-view .close').click()
    await expect(page.locator('.statistics-panel')).not.toHaveClass(/active/)
  })

  test('statistics detail back arrow returns to the tab list', async ({ page }) => {
    await h.login(page)
    await page.locator('#statistics-button').click()
    await expect(page.locator('.statistics-panel')).toHaveClass(/active/)
    await page.locator('.statistics-tabs > div', { hasText: h.TAB }).first().click()
    await expect(page.locator('.statistics-detail-view')).toBeVisible()
    await page.locator('.statistics-detail-header .back').click()
    await expect(page.locator('.statistics-list-view')).toBeVisible()
    await expect(page.locator('.statistics-detail-view')).not.toBeVisible()
  })
})

test.describe('Config-driven visibility', () => {
  test.beforeEach(async ({ context }) => {
    h.seed('reset')
    await h.blockPopstate(context)
  })

  test('"Oma summa" is visible by default (custom_amount_enabled=true)', async ({ page }) => {
    await h.login(page)
    await expect(page.locator('.quick-payment')).toBeVisible()
  })

  test('"Oma summa" is hidden when custom_amount_enabled is false', async ({ page }) => {
    h.setSetting('custom_amount_enabled', 'false')
    await h.login(page)
    await expect(page.locator('.quick-payment')).not.toBeVisible()
  })
})
