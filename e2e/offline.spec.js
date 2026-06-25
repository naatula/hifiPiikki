const { test, expect } = require('@playwright/test')
const h = require('./helpers')

test.describe('Offline mode', () => {
  test.beforeEach(async ({ context }) => {
    h.seed('reset')
    await h.blockPopstate(context)
  })

  test('a purchase made offline is queued', async ({ page }) => {
    await h.login(page)
    await h.goOffline(page)
    await h.startPurchase(page)
    await h.selectCheckoutTab(page)
    await h.confirmPurchase(page)
    await expect(page.locator('.main-panel')).toHaveClass(/active/, { timeout: 10_000 })
    const q = await h.queue(page)
    expect(q.length).toBe(1)
    expect(q[0].status).toBe('pending')
    await expect(page.locator('#offline-indicator')).toHaveClass(/active/)
    expect(h.countPurchases()).toBe(0)
  })

  test('the queue syncs and drains when connectivity returns', async ({ page }) => {
    await h.login(page)
    await h.goOffline(page)
    await h.startPurchase(page)
    await h.selectCheckoutTab(page)
    await h.confirmPurchase(page)
    await expect(page.locator('.main-panel')).toHaveClass(/active/, { timeout: 10_000 })
    expect((await h.queue(page)).length).toBe(1)
    expect(h.countPurchases()).toBe(0)

    await h.goOnline(page)
    await page.evaluate(() => PiikkiOffline.sync())
    await h.expectQueueEmpty(page)
    expect(h.countPurchases()).toBe(1)
  })

  test('PIN tabs are non-selectable offline and statistics shows local balances', async ({ page }) => {
    await h.login(page)
    await h.goOffline(page)
    await h.startPurchase(page)
    await expect(
      page.locator('.checkout-panel .tab-list .tabs > div', { hasText: h.PIN_TAB }).first()
    ).toHaveClass(/pin-disabled/)
    await page.locator('.checkout-panel .back').click()
    await expect(page.locator('.main-panel')).toHaveClass(/active/)
    await expect(page.locator('#statistics-button')).toBeVisible()
    await expect(page.locator('#offline-indicator')).toHaveClass(/active/)
  })

  test('offline state and queue survive a reload', async ({ page }) => {
    await h.login(page)
    await h.goOffline(page)
    await h.startPurchase(page)
    await h.selectCheckoutTab(page)
    await h.confirmPurchase(page)
    await expect(page.locator('.main-panel')).toHaveClass(/active/, { timeout: 10_000 })
    expect((await h.queue(page)).length).toBe(1)

    await h.goOffline(page)
    await page.reload()
    await expect(page.locator('.main-panel')).toHaveClass(/active/, { timeout: 10_000 })
    const q = await h.queue(page)
    expect(q.length).toBe(1)
    await expect(page.locator('#offline-indicator')).toHaveClass(/active/)
    expect(h.countPurchases()).toBe(0)
  })

  test('a permanently-rejected item is marked failed and dismissable', async ({ page }) => {
    await h.login(page)
    await page.evaluate(() => {
      PiikkiOffline.enqueue(PiikkiOffline.makePurchaseBundle(
        { tab: 999999, product: null, items: [{ quantity: 1, total: '3.00', price_type: null, client_uuid: crypto.randomUUID() }] },
        'Fake', 'Fake Tab'
      ))
    })
    expect((await h.queue(page)).length).toBe(1)

    await page.evaluate(async () => {
      const poll = () => new Promise(r => setTimeout(r, 200))
      for (let i = 0; i < 10; i++) {
        const result = await PiikkiOffline.sync()
        if (result.ran) return result
        await poll()
      }
    })
    await expect.poll(
      async () => (await h.queue(page)).find(i => i.status === 'failed'),
      { timeout: 10_000 }
    ).toBeTruthy()

    await expect(page.locator('#offline-indicator')).toHaveClass(/active/)
    await page.locator('#statistics-button').click()
    await expect(page.locator('.statistics-panel')).toHaveClass(/active/)
    await expect(page.locator('.offline-queue-item.failed')).toBeVisible()
    await expect(page.locator('.offline-item-dismiss')).toBeVisible()

    await page.locator('.offline-item-dismiss').click()
    await expect(page.locator('.offline-queue-item')).toHaveCount(0)
    expect((await h.queue(page)).length).toBe(0)
  })
})
