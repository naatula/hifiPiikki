# e2e — Playwright end-to-end tests

Browser tests that drive the real SPA against a running Django dev server.

## Prerequisites

- The dev environment is set up (`venv/` with deps installed, migrations applied,
  and a `.env` with `DEBUG=True` and `FORCE_SCRIPT_NAME=` per the root README).
- Google Chrome installed (the suite uses `channel: 'chrome'`, so no Playwright
  browser download is needed).
- Node.js.

## Install

```bash
cd e2e
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install
```

## Run

```bash
cd e2e
npm test            # headless
npm run test:headed # watch it drive a real browser
npm run report      # open the last HTML report
```

Playwright starts the Django server itself (`webServer` in `playwright.config.js`,
reusing one if already running). `global-setup.js` applies migrations and seeds
the baseline fixtures (the `claude` user + e2e tabs/products) via `seed.py`.

Tests run **serially** (`workers: 1`) because they share one SQLite dev DB and
one server session. Specs that mutate data call `seed('reset')` in `beforeEach`.
Don't run anything else against the same dev server/DB while the suite runs —
concurrent writes break the exact row-count assertions.

> ⚠️ These run against the **dev database** and create/delete rows in it
> (purchases, sessions, and the `E2E …` fixtures). Don't point them at anything
> you care about.

## Layout

| File | Status | Covers |
|------|--------|--------|
| `auth.spec.js` | ✅ | login render, wrong creds, success + credential storage, silent re-auth on read expiry, login fallback without creds |
| `expiry-recovery.spec.js` | ✅ | the regression guard — purchase / session start / session end while the session expires; buffered → re-authed → replayed once, no double-charge |
| `purchases.spec.js` | ✅ | single + custom-amount purchase happy paths |
| `sessions.spec.js` | ✅ | start + end a host session |
| `pin.spec.js` | ✅ | PIN purchase (correct/wrong/locked), PIN-tab expiry recovery, set_pin_required |
| `multitab.spec.js` | ✅ | multi-tab split, with-PIN, expiry recovery |
| `statistics.spec.js` | ✅ | tab list, detail, balance adjustment |
| `offline.spec.js` | ✅ | queue offline, sync on reconnect, offline restrictions, persistence, failed-item handling |

## Helpers (`helpers.js`)

- `login(page, { remember })`, `startPurchase`, `selectCheckoutTab`, `confirmPurchase`
- `enterPin(page, pin, selector)` — types a 6-digit PIN on whichever keypad is visible
- `goOffline(page)` / `goOnline(page)` — route-level network simulation (aborts `/api/**`)
- `expireSession(context)` — drops cookies to simulate a server-side session expiry (an auth lapse, not an offline outage)
- `expectQueueEmpty(page)` — waits for the offline queue to drain (recovery done)
- `blockPopstate(context)` — neutralises Chromium's spurious popstate events that close PiikkiBack-tracked overlay panels
- `seed(...)`, `countPurchases()`, `countSessions()`, `countActiveSessions()`, `tabBalance(name)`, `pinAttempts(name)` — server-side assertions via `seed.py`
