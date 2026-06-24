const { test, expect } = require('@playwright/test')
const h = require('./helpers')

test.describe('PIN flows', () => {
  test.beforeEach(async ({ context }) => {
    h.seed('reset')
    await h.blockPopstate(context)
  })

  test('purchase to a PIN tab with the correct PIN succeeds', async ({ page }) => {
    await h.login(page)
    await h.startPurchase(page)
    await h.selectCheckoutTab(page, h.PIN_TAB)
    await h.confirmPurchase(page)
    await expect(page.locator('#confirmation')).toHaveClass(/pin-mode/)
    await h.enterPin(page, h.PIN_CODE)
    await expect(page.locator('.main-panel')).toHaveClass(/active/, { timeout: 10_000 })
    expect(h.countPurchases()).toBe(1)
  })

  test('a wrong PIN is rejected and bumps the attempt counter', async ({ page }) => {
    await h.login(page)
    await h.startPurchase(page)
    await h.selectCheckoutTab(page, h.PIN_TAB)
    await h.confirmPurchase(page)
    await expect(page.locator('#confirmation')).toHaveClass(/pin-mode/)
    await h.enterPin(page, '000000')
    await expect(page.locator('#pinpad .pin-attempts')).toContainText('Väärä PIN-koodi. Yrityksiä: 1')
    expect(h.countPurchases()).toBe(0)
    expect(h.pinAttempts(h.PIN_TAB)).toBe(1)
  })

  test('too many wrong PINs locks the tab', async ({ page }) => {
    await h.login(page)
    await h.startPurchase(page)
    await h.selectCheckoutTab(page, h.PIN_TAB)
    await h.confirmPurchase(page)
    await expect(page.locator('#confirmation')).toHaveClass(/pin-mode/)

    for (let i = 0; i < h.PIN_LOCKOUT_THRESHOLD; i++) {
      await h.enterPin(page, '000000')
      await expect(page.locator('#pinpad .pin-attempts')).toContainText(`Yrityksiä: ${i + 1}`)
      if (i < h.PIN_LOCKOUT_THRESHOLD - 1) {
        await expect(page.locator('#pinpad .pin-key[data-digit="1"]')).toBeEnabled()
      }
    }

    await expect(page.locator('#pinpad .pin-locked')).toHaveClass(/active/)
    expect(h.countPurchases()).toBe(0)
  })

  test('a PIN purchase recovers inline when the session expires', async ({ page, context }) => {
    await h.login(page, { remember: true })
    await h.startPurchase(page)
    await h.selectCheckoutTab(page, h.PIN_TAB)
    await h.confirmPurchase(page)
    await expect(page.locator('#confirmation')).toHaveClass(/pin-mode/)

    await h.expireSession(context)
    await h.enterPin(page, h.PIN_CODE)

    await expect(page.locator('.main-panel')).toHaveClass(/active/, { timeout: 15_000 })
    await expect.poll(() => h.countPurchases(), { timeout: 15_000 }).toBe(1)
    await page.waitForTimeout(500)
    expect(h.countPurchases()).toBe(1)
    expect(await h.loginShown(page)).toBe(false)
  })

  test('set_pin_required toggles a tab PIN from statistics', async ({ page }) => {
    await h.login(page)
    await page.locator('#statistics-button').click()
    await expect(page.locator('.statistics-panel')).toHaveClass(/active/)
    await page.locator('.statistics-tabs > div', { hasText: h.PIN_TAB }).click()
    await expect(page.locator('.statistics-detail-view')).toBeVisible()

    const checkbox = page.locator('#statistics-pin-required')
    const wasChecked = await checkbox.isChecked()
    await page.locator('#statistics-pin-control .ios-toggle').click()
    await expect(page.locator('#statistics-pin-overlay')).toHaveClass(/active/)
    await h.enterPin(page, h.PIN_CODE, '#statistics-pinpad')
    await expect(page.locator('#statistics-pin-overlay')).not.toHaveClass(/active/)
    expect(await checkbox.isChecked()).toBe(!wasChecked)
  })
})
