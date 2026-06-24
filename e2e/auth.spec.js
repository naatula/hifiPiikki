const { test, expect } = require('@playwright/test')
const h = require('./helpers')

test.describe('Authentication', () => {
  test('first load shows a clean login dialog (no false "expired" message)', async ({ page }) => {
    await page.goto('/static/index.html')
    await expect(page.locator('.login-panel')).toHaveClass(/active/)
    await expect(page.locator('.toast', { hasText: 'vanhentunut' })).toHaveCount(0)
  })

  test('wrong credentials show an error toast and stay on login', async ({ page }) => {
    await page.goto('/static/index.html')
    await page.locator('#username').fill('claude')
    await page.locator('#password').fill('nope')
    await page.locator('#login').click()
    await expect(page.locator('.toast', { hasText: 'Väärä käyttäjätunnus tai salasana' })).toBeVisible()
    await expect(page.locator('.main-panel')).not.toHaveClass(/active/)
  })

  test('successful login enters the app and stores credentials when "remember" is checked', async ({ page }) => {
    await h.login(page, { remember: true })
    expect(await h.storedCreds(page)).toContain('claude')
    expect(await page.evaluate(() => localStorage.getItem('piikki.loggedIn'))).toBe('1')
  })

  test('login without "remember" does not store credentials', async ({ page }) => {
    await h.login(page, { remember: false })
    expect(await h.storedCreds(page)).toBeNull()
  })

  test('a read after the session expires silently re-auths (stored creds)', async ({ page, context }) => {
    await h.login(page, { remember: true })
    await h.expireSession(context)
    // Opening statistics fires GET /api/tabs/all/, which 403s then recovers.
    await page.locator('#statistics-button').click()
    await expect(page.locator('.statistics-panel')).toHaveClass(/active/, { timeout: 10_000 })
    expect(await h.loginShown(page)).toBe(false)
  })

  test('a read after expiry with no stored creds falls back to the login dialog', async ({ page, context }) => {
    await h.login(page, { remember: false })
    await h.expireSession(context)
    await page.locator('#statistics-button').click()
    await expect(page.locator('.login-panel')).toHaveClass(/active/, { timeout: 10_000 })
  })
})
