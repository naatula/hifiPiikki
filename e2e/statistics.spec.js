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

  test('shows "Viimeisin suoritus" when a tab has an adjustment', async ({ page }) => {
    h.tabAdjust(h.TAB, '10.00', 'korjaus')
    await h.login(page)
    await page.locator('#statistics-button').click()
    await expect(page.locator('.statistics-panel')).toHaveClass(/active/)
    await page.locator('.statistics-tabs > div', { hasText: h.TAB }).first().click()
    await expect(page.locator('.statistics-detail-view')).toBeVisible()
    await expect(page.locator('#statistics-tab-adjustment')).toContainText('Viimeisin suoritus')
  })

  test('shows "Ei suorituksia" when a tab has no adjustments', async ({ page }) => {
    await h.login(page)
    await page.locator('#statistics-button').click()
    await expect(page.locator('.statistics-panel')).toHaveClass(/active/)
    await page.locator('.statistics-tabs > div', { hasText: h.TAB }).first().click()
    await expect(page.locator('.statistics-detail-view')).toBeVisible()
    await expect(page.locator('#statistics-tab-adjustment')).toContainText('Ei suorituksia')
  })

  test('an inactive tab shows "Poistettu käytöstä" and the .inactive class', async ({ page }) => {
    await h.login(page)
    await page.locator('#statistics-button').click()
    await expect(page.locator('.statistics-panel')).toHaveClass(/active/)
    // The inactive tab should still appear in the list (tabs/all includes inactive with balance).
    const row = page.locator('.statistics-tabs > div', { hasText: h.INACTIVE_TAB })
    await expect(row).toBeVisible()
    await expect(row).toHaveClass(/inactive/)
    await row.click()
    await expect(page.locator('.statistics-detail-view')).toBeVisible()
    await expect(page.locator('#statistics-tab-status')).toContainText('Poistettu käytöstä')
  })

  test('shows recent purchases and "Ei ostoksia" when empty', async ({ page }) => {
    await h.login(page)

    // Tab with no purchases → empty state.
    await page.locator('#statistics-button').click()
    await expect(page.locator('.statistics-panel')).toHaveClass(/active/)
    await page.locator('.statistics-tabs > div', { hasText: h.TAB }).first().click()
    await expect(page.locator('.statistics-detail-view')).toBeVisible()
    await expect(page.locator('.statistics-purchases .no-purchases')).toContainText('Ei ostoksia viimeisen viikon aikana')
  })

  test('shows purchase rows after a purchase is made', async ({ page }) => {
    await h.login(page)
    // Make a purchase first.
    await h.startPurchase(page)
    await h.selectCheckoutTab(page)
    await h.confirmPurchase(page)
    await expect(page.locator('.main-panel')).toHaveClass(/active/, { timeout: 10_000 })
    expect(h.countPurchases()).toBe(1)

    await page.locator('#statistics-button').click()
    await expect(page.locator('.statistics-panel')).toHaveClass(/active/)
    await page.locator('.statistics-tabs > div', { hasText: h.TAB }).first().click()
    await expect(page.locator('.statistics-detail-view')).toBeVisible()
    await expect(page.locator('.statistics-purchases .purchase-product').first()).toContainText(h.PRODUCT)
    await expect(page.locator('.statistics-purchases .purchase-total').first()).toBeVisible()
  })
})
