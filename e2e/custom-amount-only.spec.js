const { test, expect } = require('@playwright/test')
const h = require('./helpers')

// h.login waits for the product view, which this mode never shows.
async function loginCustomOnly(page) {
  await page.goto('/static/index.html')
  await page.locator('#username').fill(h.USER)
  await page.locator('#password').fill(h.PASSWORD)
  await page.locator('#login').click()
  await expect(page.locator('.checkout-panel')).toHaveClass(/active/, { timeout: 10_000 })
  await page.waitForLoadState('networkidle')
}

test.describe('Custom amount only mode', () => {
  test.beforeEach(async ({ context }) => {
    h.seed('reset')
    await h.blockPopstate(context)
  })
  // Settings persist across reset(); leave the default (off) for other specs.
  test.afterEach(() => { h.setSetting('custom_amount_only_enabled', 'false') })

  test('header buttons are hidden when the mode is off', async ({ page }) => {
    await h.login(page)
    await h.startPurchase(page)
    await expect(page.locator('.custom-only-header-buttons')).toBeHidden()
    await expect(page.locator('.checkout-panel > .top-bar > .back')).toBeVisible()
  })

  test('opens checkout without a slide and the session button has width', async ({ page }) => {
    h.setSetting('custom_amount_only_enabled', 'true')
    await loginCustomOnly(page)
    const checkout = page.locator('.checkout-panel')
    await expect(checkout).toHaveClass(/active/)
    expect(await checkout.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s')
    const btn = page.locator('#session-info-custom')
    await expect(btn).toBeVisible()
    expect((await btn.boundingBox()).width).toBeGreaterThan(100)
  })

  test('the session panel opens above the checkout and is usable', async ({ page }) => {
    h.setSetting('custom_amount_only_enabled', 'true')
    await loginCustomOnly(page)
    await page.locator('#session-info-custom').click()
    await expect(page.locator('.session-panel')).toHaveClass(/active/)
    await expect(page.locator('.session-panel')).not.toHaveClass(/opening/)
    await page.locator('#session-tab-list .tabs > div', { hasText: h.TAB }).first().click()
    await expect(page.locator('#session-confirm')).not.toHaveClass(/disabled/)
    await page.locator('#session-confirm').click()
    await expect(page.locator('#session-info-custom')).toHaveClass(/active/)
    expect(h.countActiveSessions()).toBe(1)
  })
})
