// SCAFFOLD — offline/PWA behaviour. Simulate an outage by aborting /api/ routes
// (and/or context.setOffline) rather than clearing cookies (that is auth-expiry,
// covered in expiry-recovery.spec.js). The connectivity probe hits GET /api/csrf/.
const { test } = require('@playwright/test')
const h = require('./helpers')

test.describe('Offline mode', () => {
  test.beforeEach(() => { h.seed('reset') })

  // While offline, a purchase is queued (sound on queue), the red offline button
  // shows with a pending count, and isOffline() stays true.
  test.fixme('a purchase made offline is queued', async ({ page, context }) => {})

  // Restore connectivity -> the queue replays automatically and drains; the
  // purchase is persisted exactly once.
  test.fixme('the queue syncs and drains when connectivity returns', async ({ page, context }) => {})

  // Offline restrictions: PIN-protected tabs are non-selectable, the statistics
  // panel is unreachable.
  test.fixme('PIN tabs are non-selectable and statistics is unreachable offline', async ({ page, context }) => {})

  // Offline state survives a page reload (the queue persists in localStorage).
  test.fixme('offline state and queue survive a reload', async ({ page, context }) => {})

  // A failed (4xx) queued item becomes "failed", is individually dismissable,
  // and is not hammered by the periodic ping.
  test.fixme('a permanently-rejected item is marked failed and dismissable', async ({ page, context }) => {})
})
