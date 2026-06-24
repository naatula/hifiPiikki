const { test, expect } = require('@playwright/test')
const h = require('./helpers')

test.describe('Host sessions (happy path)', () => {
  test.beforeEach(() => { h.seed('reset') })

  test('start a host session, then end it', async ({ page }) => {
    await h.login(page)

    // Start
    await page.locator('#session-info').click()
    await expect(page.locator('.session-panel')).toHaveClass(/active/)
    await page.locator('#session-tab-list .tabs > div', { hasText: h.TAB }).first().click()
    await page.locator('#session-confirm').click()
    await expect(page.locator('#session-info')).toHaveClass(/active/)
    expect(h.countActiveSessions()).toBe(1)

    // End
    await page.locator('#session-info').click()
    await expect(page.locator('.session-panel')).toHaveClass(/active/)
    await page.locator('#session-people').fill('5')
    await page.locator('#session-comment').fill('e2e')
    await page.locator('#session-end').click()
    await expect(page.locator('#session-info')).not.toHaveClass(/active/)
    expect(h.countActiveSessions()).toBe(0)
    expect(h.countSessions()).toBe(1)
  })
})
