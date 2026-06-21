# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

hifiPiikki is a Finnish association point-of-sale and tab management system ("piikki"). The frontend SPA is entirely in Finnish — keep all UI text in Finnish.

## Dev setup

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
cp .env.example .env
python manage.py runserver
```

- Frontend SPA in Django debug mode: `http://localhost:8000/static/index.html` (not the root `/`)
- Admin panel: `http://localhost:8000/admin/`

No need to run collectstatic in dev — static files are served directly from the app.

## Production deploy

After each deploy, run before restarting the app server:

```bash
python manage.py migrate
python manage.py collectstatic --noinput
```

`collectstatic` is required because `static/` is gitignored — skipping it breaks CSS and JS (charts, styling) in production.

When any client asset changes (e.g. `app.js`, `offline.js`, `styles.css`, `index.html`), bump the service worker `CACHE_VERSION` constant in `api/static/sw.js`. This re-precaches the shell and triggers the in-app "Uusi versio saatavilla" update toast on clients; without it, the service worker keeps serving the old cached assets.

## Environment variables

- `DEBUG` — Django debug mode (default `False`)
- `FORCE_SCRIPT_NAME` — reverse proxy path prefix (default `/hifiPiikki`); set empty for local dev

## Architecture notes

- **Soft deletes only**: All models inherit from `ParanoidModel` (django-paranoid). Never hard-delete — calling `.delete()` soft-deletes; use `.delete(force_policy=HARD_DELETE)` only if explicitly required.
- **Shelly integration config**: Shelly Cloud credentials (`shelly_cloud_server`, `shelly_cloud_key`, `shelly_cloud_device`) are stored in the `Setting` model in the database, not in env vars.
- **No test suite**: `api/tests.py` is intentionally empty. Do not add a test framework unless explicitly asked.
- **Event time vs audit time**: `Purchase.occurred_at` (default `timezone.now`) is the authoritative *event time* and drives all time-window logic (24h/7d/90d filters, session totals, `api/analytics.py`). `created_at` (`auto_now_add`) stays an untouched server-insert audit trail. Offline replays send a past `occurred_at`; online creates get ≈now for free. Session event time uses the existing explicit `started_at`/`ended_at` fields. When adding purchase time queries, filter on `occurred_at`, not `created_at`.
- **Idempotent sync**: `Purchase` and `Session` carry a nullable-unique `client_uuid`. The viewsets deduplicate on it (returning the existing row, with an `IntegrityError` race guard) so a buffered request whose response was lost can be safely retried without double-charging. Session `create`/`end` are idempotent and **skip Shelly** when a `client_uuid` is present (a replayed historical action must not toggle the relay hours late).
- **Long-lived session cookie**: `SESSION_COOKIE_AGE` is 30 days with `SESSION_SAVE_EVERY_REQUEST = True`, so an always-on tablet stays authenticated across long offline stretches. On a sync hitting 401/403 the client aborts and re-prompts login.

## Offline mode (PWA)

The SPA is a service-worker PWA that tolerates intermittent/indefinite outages — it runs on an Android tablet on flaky bar Wi-Fi. Two client files own this:

- **`api/static/sw.js`** — service worker. Precaches the app shell (`CACHE_VERSION`-keyed); navigations are network-first with cache fallback, other in-scope GETs are stale-while-revalidate. Registered with a *relative* URL and `updateViaCache: 'none'` so it works under both the dev (`/static/`) and prod (`/hifiPiikki/static/`) prefixes and re-checks itself each navigation. `/api/` is outside the SW scope and is never cached by it — `localStorage` is the single source of truth for offline data. Updates are user-confirmed via the toast (no `skipWaiting` on install).
- **`api/static/offline.js`** — the `PiikkiOffline` module that `app.js` routes all network calls through. It buffers mutations (purchases, session start/end) to a `localStorage` queue, caches the last good tabs/products/session reads for offline rendering, and replays the queue (FIFO, resolving session start→end dependencies via `client_uuid`) when connectivity returns.

Behavioural rules to preserve when touching this code:

- **Offline state** is `!connected || hasPending()` — it stays active across a page refresh (the queue persists in `localStorage`) until every *pending* item is synced. The red offline button additionally stays visible while *any* item remains (incl. failed) so the panel is reachable to retry/dismiss.
- **Failure handling**: transient errors (network drop, 5xx) keep an item `pending` for automatic retry on the next reconnect/ping; permanent 4xx rejections become `failed` (shown with a reason, individually dismissable) and are retried only on reconnect or manual sync — not hammered by the periodic ping.
- **Offline restrictions**: PIN-protected tabs are non-selectable (PIN is server-only) and the statistics panel is unreachable. The purchase confirmation sound plays when an action is *queued*, not on later sync.
- Connectivity is verified by an actual server probe (`GET /api/csrf/`), not just `navigator.onLine`/the `online` event, which only reflect link state.
