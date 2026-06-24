// SCAFFOLD — statistics panel (tab list, detail, adjustments).
const { test } = require('@playwright/test')
const h = require('./helpers')

test.describe('Statistics', () => {
  test.beforeEach(() => { h.seed('reset') })

  // Click #statistics-button -> list shows the e2e tabs with balances.
  test.fixme('lists all tabs with balances', async ({ page }) => {})

  // Open a tab -> detail view shows name, status, balance, purchase history.
  test.fixme('opens a tab detail view', async ({ page }) => {})

  // Apply a balance adjustment from the detail view -> balance updates.
  test.fixme('adjusts a tab balance', async ({ page }) => {})
})
