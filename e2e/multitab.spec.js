// SCAFFOLD — multi-tab purchase flows. Needs a second non-PIN tab fixture
// (extend e2e/seed.py baseline() with e.g. "E2E Testi 2" before implementing).
const { test } = require('@playwright/test')
const h = require('./helpers')

test.describe('Multi-tab purchases', () => {
  test.beforeEach(() => { h.seed('reset') })

  // Toggle #multi-tab-toggle, select two non-PIN tabs, confirm -> a purchase is
  // recorded for each tab; assert countPurchases() === 2.
  test.fixme('one purchase splits across several selected tabs', async ({ page }) => {})

  // Include a PIN tab in the selection (verify its PIN first), confirm -> all
  // tabs charged.
  test.fixme('multi-tab purchase including a PIN tab', async ({ page }) => {})

  // Expire the session mid multi-tab purchase -> recovers via inline re-auth +
  // retry (PINs in memory), each tab charged exactly once, no login dialog.
  test.fixme('multi-tab purchase recovers when the session expires', async ({ page, context }) => {})
})
