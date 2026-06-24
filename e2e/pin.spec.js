// SCAFFOLD — PIN-protected tab flows. Fill these in (remove test.fixme) as needed.
// Fixtures: tab "E2E PIN" (h.PIN_TAB) with PIN h.PIN_CODE ('123456').
const { test } = require('@playwright/test')
const h = require('./helpers')

test.describe('PIN flows', () => {
  test.beforeEach(() => { h.seed('reset') })

  // Select PIN tab -> keypad appears -> confirm reveals pinpad -> enter PIN ->
  // purchase succeeds; assert countPurchases() === 1.
  test.fixme('purchase to a PIN tab with the correct PIN succeeds', async ({ page }) => {})

  // Enter a wrong PIN -> "Väärä PIN-koodi. Yrityksiä: N" shown, attempts bump,
  // no purchase recorded.
  test.fixme('a wrong PIN is rejected and bumps the attempt counter', async ({ page }) => {})

  // Exceed the allowed attempts -> the pin card shows the locked state.
  test.fixme('too many wrong PINs locks the tab', async ({ page }) => {})

  // Mid PIN purchase, expire the session: it must recover via inline silent
  // re-auth (PIN kept in memory, never buffered) and charge exactly once;
  // login dialog must NOT appear when creds are stored.
  test.fixme('a PIN purchase recovers inline when the session expires', async ({ page, context }) => {})

  // Statistics -> open a tab -> toggle "PIN required" -> enter PIN -> persists.
  test.fixme('set_pin_required toggles a tab PIN from statistics', async ({ page }) => {})
})
