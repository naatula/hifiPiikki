const { test, expect } = require('@playwright/test')
const h = require('./helpers')

test.describe('Simple tab lists', () => {
  test.beforeEach(async ({ context }) => {
    h.seed('reset')
    await h.blockPopstate(context)
  })
  // Settings persist across reset(); leave the default (off) for other specs.
  test.afterEach(() => { h.setSetting('simple_tab_lists', 'false') })

  test('letter index and recent list are shown by default', async ({ page }) => {
    await h.login(page)
    await h.startPurchase(page)
    await expect(page.locator('.checkout-panel .tab-list .alphabet')).toBeVisible()
    await expect(page.locator('.checkout-panel .tab-list .suggestions')).toBeVisible()
  })

  test('simple_tab_lists hides the index and recents, listing names alphabetically', async ({ page }) => {
    h.setSetting('simple_tab_lists', 'true')
    await h.login(page)
    await h.startPurchase(page)
    await expect(page.locator('.checkout-panel .tab-list .alphabet-container')).toBeHidden()
    await expect(page.locator('.checkout-panel .tab-list > h3')).toBeHidden()
    await expect(page.locator('.tab-column-header h2')).toHaveText('Piikki')
    const tabs = page.locator('.checkout-panel .tab-list .tabs > div')
    await expect(tabs.first()).toBeVisible()
    const names = await tabs.allTextContents()
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'fi')))
    await h.selectCheckoutTab(page)

  })

  test('simple_tab_lists applies to the session tab picker', async ({ page }) => {
    h.setSetting('simple_tab_lists', 'true')
    await h.login(page)
    await page.locator('#session-info').click()
    await expect(page.locator('.session-panel')).toHaveClass(/active/)
    await expect(page.locator('#session-tab-list .alphabet-container')).toBeHidden()
    await expect(page.locator('#session-tab-list .tabs > div', { hasText: h.TAB }).first()).toBeVisible()
  })
})
