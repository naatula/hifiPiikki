const PiikkiOffline = (() => {
    const KEYS = {
        queue: 'piikki.queue',
        tabs: 'piikki.cache.tabs',
        products: 'piikki.cache.products',
        session: 'piikki.cache.session',
        config: 'piikki.cache.config',
        updatedAt: 'piikki.cache.updatedAt',
        loggedIn: 'piikki.loggedIn',
        creds: 'piikki.creds',
    }
    const FETCH_TIMEOUT = 8000

    let connected = true
    let syncing = false
    let pingTimer = null
    let lastUiOffline = false
    let onOfflineChange = null
    let onLoginNeeded = null

    // Behavioural offline: no connectivity, or buffered work still waiting to
    // sync. Stays true across a page refresh because the queue lives in
    // localStorage — the app keeps buffering until the backlog drains.
    const isOffline = () => !connected || hasPending()

    const setCache = (key, data) => {
        localStorage.setItem(KEYS[key], JSON.stringify(data))
        localStorage.setItem(KEYS.updatedAt, new Date().toISOString())
    }

    const getCache = (key) => {
        const raw = localStorage.getItem(KEYS[key])
        if (!raw) return null
        try { return JSON.parse(raw) } catch { return null }
    }

    const getUpdatedAt = () => localStorage.getItem(KEYS.updatedAt)

    const setLoggedIn = (val) => {
        if (val) localStorage.setItem(KEYS.loggedIn, '1')
        else localStorage.removeItem(KEYS.loggedIn)
    }
    const wasLoggedIn = () => localStorage.getItem(KEYS.loggedIn) === '1'

    // Opt-in credential storage for silent re-auth after a session expires on an
    // always-on tablet. Stored in plaintext localStorage — only persisted when
    // the operator ticks "Pysy kirjautuneena", and cleared once the password is
    // proven stale (a re-auth that fails on bad credentials). The point of this
    // is convenience on a single-purpose kiosk; use a dedicated POS account.
    const setCredentials = (username, password) => {
        localStorage.setItem(KEYS.creds, JSON.stringify({ username, password }))
    }
    const getCredentials = () => {
        const raw = localStorage.getItem(KEYS.creds)
        if (!raw) return null
        try {
            const c = JSON.parse(raw)
            return (c && c.username) ? c : null
        } catch { return null }
    }
    const clearCredentials = () => localStorage.removeItem(KEYS.creds)

    // Recompute UI + ping based on connectivity and queue contents. The offline
    // button stays visible while ANY buffered item remains (so failed leftovers
    // can be inspected/dismissed), while behavioural offline mode releases once
    // no pending work is left.
    const applyOfflineState = () => {
        if (!connected || hasPending()) startPing()
        else stopPing()
        updateOfflineUI()
        const off = isOffline()
        if (off !== lastUiOffline) {
            lastUiOffline = off
            if (onOfflineChange) onOfflineChange(off)
        }
    }

    const goOffline = () => {
        if (!connected) return
        connected = false
        applyOfflineState()
    }

    const goOnline = () => {
        if (connected) return
        connected = true
        applyOfflineState()
        autoSync({ retryFailed: true })
    }

    // Verify the server is actually reachable (the browser 'online' event and
    // navigator.onLine only reflect link state, not server availability), then
    // reconcile connectivity and drain the queue.
    const probe = async () => {
        try {
            const r = await fetch('../api/csrf/', { method: 'GET', cache: 'no-store' })
            if (!r.ok) throw new Error('probe')
        } catch {
            goOffline()
            return
        }
        const wasConnected = connected
        connected = true
        if (!wasConnected) {
            // Connectivity just restored — refresh UI and retry everything,
            // including items that failed during an earlier outage.
            applyOfflineState()
            autoSync({ retryFailed: true })
        } else {
            // Connected but backlog persists — keep draining pending items
            // without hammering permanently-rejected (4xx) ones.
            autoSync({ retryFailed: false })
        }
    }

    const startPing = () => {
        if (pingTimer) return
        pingTimer = setInterval(probe, 15000)
    }

    const stopPing = () => {
        if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
    }

    const apiFetch = async (url, opts = {}) => {
        if (!navigator.onLine) {
            goOffline()
            return { offline: true, response: null }
        }
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
        try {
            const response = await fetch(url, { ...opts, signal: controller.signal })
            clearTimeout(timer)
            goOnline()
            return { offline: false, response }
        } catch (e) {
            clearTimeout(timer)
            goOffline()
            return { offline: true, response: null }
        }
    }

    // ---- Queue management ----

    // In-memory mirror of the persisted queue. isOffline()/hasPending() are
    // called frequently (per-tab during rendering), so avoid re-parsing
    // localStorage on every call.
    let cachedQueue = null

    const loadQueue = () => {
        if (cachedQueue) return cachedQueue
        const raw = localStorage.getItem(KEYS.queue)
        try { cachedQueue = raw ? JSON.parse(raw) : [] } catch { cachedQueue = [] }
        return cachedQueue
    }

    const saveQueue = (q) => {
        cachedQueue = q
        localStorage.setItem(KEYS.queue, JSON.stringify(q))
    }

    const hasPending = () => loadQueue().some(i => i.status === 'pending')

    const enqueue = (item) => {
        const q = loadQueue()
        q.push(item)
        saveQueue(q)
        applyOfflineState()
    }

    const removeFromQueue = (id) => {
        const q = loadQueue().filter(i => i.id !== id)
        saveQueue(q)
        // Recompute offline state: clearing the last item while connected must
        // drop offline mode (and hide the button), not just re-render the list.
        applyOfflineState()
    }

    const dismissFailed = (id) => {
        removeFromQueue(id)
    }

    const getQueueSize = () => loadQueue().length

    const makePurchaseBundle = (body, productName, tabName) => {
        const occurredAt = new Date().toISOString()
        const items = (body.items || []).map(it => ({
            ...it,
            client_uuid: it.client_uuid || crypto.randomUUID(),
        }))
        return {
            id: crypto.randomUUID(),
            type: 'purchase',
            body: { tab: body.tab, product: body.product, occurred_at: occurredAt, items },
            productName,
            tabName,
            occurredAt,
            status: 'pending',
            error: null,
        }
    }

    const makeSessionStartItem = (tabId, tabName, clientUuid) => ({
        id: crypto.randomUUID(),
        type: 'session_start',
        // Reuse a client_uuid already minted for an online attempt (so a start
        // buffered after the online POST timed out replays under the same id and
        // dedupes against the session the server may have already created);
        // mint a fresh one for a purely offline start.
        body: {
            tab: tabId,
            client_uuid: clientUuid || crypto.randomUUID(),
            started_at: new Date().toISOString(),
        },
        tabName,
        occurredAt: new Date().toISOString(),
        status: 'pending',
        error: null,
    })

    const makeSessionEndItem = (sessionId, startRef, people, comment) => {
        // If this ends a session that was started offline and hasn't synced yet,
        // its "id" is the queued start item's id, not a server id. Link via
        // startRef so sync resolves the real server id once the start replays,
        // instead of POSTing to a non-existent /sessions/{uuid}/end/.
        if (sessionId && loadQueue().some(i => i.type === 'session_start' && i.id === sessionId)) {
            startRef = sessionId
            sessionId = null
        }
        return {
            id: crypto.randomUUID(),
            type: 'session_end',
            sessionId: sessionId || null,
            startRef: startRef || null,
            body: {
                people,
                comment,
                client_uuid: crypto.randomUUID(),
                ended_at: new Date().toISOString(),
            },
            occurredAt: new Date().toISOString(),
            status: 'pending',
            error: null,
        }
    }

    // ---- Sync ----

    // retryFailed: also re-attempt items previously marked 'failed' (a permanent
    // 4xx rejection). Used on reconnect and manual sync; the periodic ping passes
    // false so it keeps draining pending work without re-POSTing rejected items.
    const sync = async ({ retryFailed = true } = {}) => {
        if (syncing) return { ran: false, busy: true }
        syncing = true

        // Probe connectivity first (this also yields the CSRF token used for
        // replays). Doing it before the empty-queue check means a manual sync
        // re-detects that the server is reachable and leaves offline mode even
        // when there is nothing to send.
        let csrfToken = null
        try {
            const r = await fetch('../api/csrf/', { method: 'GET', cache: 'no-store' })
            if (!r.ok) throw new Error('csrf')
            const body = await r.text()
            csrfToken = body.split('value="')[1].split('"')[0]
            connected = true // reaching the server proves connectivity
        } catch {
            syncing = false
            goOffline()
            return { ran: false, authNeeded: false }
        }

        const q = loadQueue()
        if (q.length === 0) {
            syncing = false
            applyOfflineState()
            return { ran: true, ok: 0, failed: 0 }
        }

        const startRefMap = {}
        let okCount = 0
        let failCount = 0
        let authFailed = false
        let connLost = false

        // Pre-merge: if a session_end references a session_start still in the
        // queue, fold end data into the start item so they sync as one request.
        const endByStartRef = new Map()
        for (const item of q) {
            if (item.type === 'session_end' && item.startRef && item.status !== 'synced') {
                endByStartRef.set(item.startRef, item)
            }
        }
        for (const item of q) {
            if (item.type !== 'session_start' || item.status === 'synced') continue
            const endItem = endByStartRef.get(item.id)
            if (!endItem) continue
            item._mergedEnd = endItem
        }

        for (const item of q) {
            if (authFailed || connLost) break
            if (item.status === 'failed' && !retryFailed) continue
            if (item.type === 'session_end' && q.some(s => s._mergedEnd === item)) continue

            try {
                const result = await syncOne(item, csrfToken, startRefMap)
                if (result.ok) {
                    item.status = 'synced'
                    item.error = null
                    okCount++
                    if (item._mergedEnd) {
                        item._mergedEnd.status = 'synced'
                        item._mergedEnd.error = null
                        okCount++
                    }
                } else if (result.authNeeded) {
                    authFailed = true
                } else if (result.transient) {
                    item.status = 'pending'
                    connLost = true
                } else {
                    item.status = 'failed'
                    item.error = result.error || 'Tuntematon virhe'
                    failCount++
                    if (item._mergedEnd) {
                        item._mergedEnd.status = 'failed'
                        item._mergedEnd.error = item.error
                        failCount++
                    }
                }
            } catch {
                item.status = 'pending'
                connLost = true
            }
        }

        // Remove the synced items by id from the *current* queue rather than
        // overwriting with the snapshot — otherwise an item dismissed or
        // enqueued while this sync was in flight would be clobbered.
        const syncedIds = new Set(q.filter(i => i.status === 'synced').map(i => i.id))
        const remaining = loadQueue().filter(i => !syncedIds.has(i.id))
        saveQueue(remaining)
        syncing = false

        if (authFailed && onLoginNeeded) {
            onLoginNeeded()
        }
        if (connLost) goOffline()

        renderPanel()
        applyOfflineState()
        return { ran: true, ok: okCount, failed: failCount, authNeeded: authFailed }
    }

    const syncOne = async (item, csrfToken, startRefMap) => {
        const headers = { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken }

        if (item.type === 'purchase') {
            const r = await fetch('../api/purchases/', {
                method: 'POST', headers, body: JSON.stringify(item.body),
            })
            if (r.ok) return { ok: true }
            if (r.status >= 500) return { ok: false, transient: true }
            let body = {}
            try { body = await r.clone().json() } catch {}
            if (body.error === 'balance_limit') {
                return { ok: false, error: 'Saldon raja ylitetty' }
            }
            if (r.status === 401 || r.status === 403) {
                if (body.error === 'wrong_pin' || body.error === 'locked') {
                    return { ok: false, error: 'PIN-virhe' }
                }
                return { ok: false, authNeeded: true }
            }
            return { ok: false, error: await extractError(r) }
        }

        if (item.type === 'session_start') {
            const body = { ...item.body }
            if (item._mergedEnd) {
                body.people = item._mergedEnd.body.people
                body.comment = item._mergedEnd.body.comment
                body.ended_at = item._mergedEnd.body.ended_at
            }
            const r = await fetch('../api/sessions/', {
                method: 'POST', headers, body: JSON.stringify(body),
            })
            if (r.ok) {
                const data = await r.json()
                startRefMap[item.id] = data.id
                const cached = getCache('session')
                if (cached && cached.id === item.id) {
                    cached.id = data.id
                    setCache('session', cached)
                }
                return { ok: true }
            }
            if (r.status >= 500) return { ok: false, transient: true }
            if (r.status === 401 || r.status === 403) return { ok: false, authNeeded: true }
            return { ok: false, error: await extractError(r) }
        }

        if (item.type === 'session_end') {
            let sessionId = item.sessionId || startRefMap[item.startRef]
            if (sessionId && String(sessionId) !== String(parseInt(sessionId, 10))) {
                sessionId = startRefMap[sessionId] || null
            }
            if (!sessionId) {
                try {
                    const ar = await fetch('../api/sessions/active/', { headers })
                    if (ar.ok) {
                        const active = await ar.json()
                        if (active.id) sessionId = active.id
                    }
                } catch {}
            }
            if (!sessionId) {
                return { ok: false, error: 'Hostauksen aloitus epäonnistui' }
            }
            const r = await fetch(`../api/sessions/${sessionId}/end/`, {
                method: 'POST', headers, body: JSON.stringify(item.body),
            })
            if (r.ok) return { ok: true }
            if (r.status >= 500) return { ok: false, transient: true }
            if (r.status === 401 || r.status === 403) return { ok: false, authNeeded: true }
            return { ok: false, error: await extractError(r) }
        }

        return { ok: false, error: 'Tuntematon toiminto' }
    }

    const extractError = async (response) => {
        try {
            const body = await response.json()
            if (body.error) return body.error
            const first = Object.values(body)[0]
            if (Array.isArray(first)) return first[0]
            return `Virhe ${response.status}`
        } catch {
            return `Virhe ${response.status}`
        }
    }

    const autoSync = (opts) => {
        if (getQueueSize() === 0) return
        sync(opts)
    }

    // ---- UI ----

    const humanizeTime = (isoString) => {
        if (!isoString) return 'ei tiedossa'
        const now = new Date()
        const date = new Date(isoString)
        const diff = Math.floor((now - date) / 1000)
        if (diff < 60) return 'juuri äsken'
        if (diff < 3600) return `${Math.floor(diff / 60)} min sitten`
        if (diff < 86400) return `${Math.floor(diff / 3600)} h sitten`
        return `${Math.floor(diff / 86400)} pv sitten`
    }

    const currency = (n) => parseFloat(n).toFixed(2).replace('.', ',') + ' €'

    const describeItem = (item) => {
        if (item.type === 'purchase') {
            const items = item.body.items || []
            const qty = items.reduce((s, it) => s + parseFloat(it.quantity), 0)
            const total = items.reduce((s, it) => s + parseFloat(it.total), 0)
            const product = item.productName || 'tuote'
            const tab = item.tabName || '?'
            return `${qty}× ${product} → ${tab} (${currency(total)})`
        }
        if (item.type === 'session_start') {
            return `Hostaus alkoi: ${item.tabName || '?'}`
        }
        if (item.type === 'session_end') {
            const people = item.body.people || '?'
            return `Hostaus loppui (${people} hlöä)`
        }
        return 'Tuntematon'
    }

    const renderPanel = () => {
        const section = document.querySelector('#offline-queue-section')
        if (!section) return

        const showSection = !connected || getQueueSize() > 0
        section.style.display = showSection ? '' : 'none'
        if (!showSection) return

        const q = loadQueue()
        const updatedAt = getUpdatedAt()

        const lastUpdateEl = section.querySelector('.offline-last-update')
        const countEl = section.querySelector('.offline-queue-count')
        const listEl = section.querySelector('.offline-queue-list')

        if (lastUpdateEl) lastUpdateEl.textContent = `Viimeisin yhteys: ${humanizeTime(updatedAt)}`
        if (countEl) countEl.textContent = q.length > 0 ? `Jonossa: ${q.length}` : ''

        if (listEl) {
            listEl.innerHTML = ''
            q.forEach(item => {
                const div = document.createElement('div')
                div.className = 'offline-queue-item' + (item.status === 'failed' ? ' failed' : '')
                const desc = document.createElement('span')
                desc.className = 'offline-item-desc'
                desc.textContent = describeItem(item)
                div.appendChild(desc)
                if (item.status === 'failed') {
                    const err = document.createElement('span')
                    err.className = 'offline-item-error'
                    err.textContent = item.error || ''
                    div.appendChild(err)
                    const dismiss = document.createElement('button')
                    dismiss.className = 'offline-item-dismiss'
                    dismiss.textContent = '✕'
                    dismiss.addEventListener('click', (e) => {
                        e.stopPropagation()
                        dismissFailed(item.id)
                    })
                    div.appendChild(dismiss)
                }
                listEl.appendChild(div)
            })
        }
    }

    const updateOfflineUI = () => {
        const showOffline = !connected || getQueueSize() > 0
        const indicator = document.querySelector('#offline-indicator')
        if (indicator) {
            indicator.classList.toggle('active', showOffline)
            indicator.innerHTML = showOffline
                ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M792-56 686-160H260q-92 0-156-64T40-380q0-77 47.5-137T210-594q3-8 6-15.5t6-16.5L56-792l56-56 736 736-56 56ZM260-240h346L284-562q-2 11-3 21t-1 21h-20q-58 0-99 41t-41 99q0 58 41 99t99 41Zm185-161Zm419 191-58-56q17-14 25.5-32.5T840-340q0-42-29-71t-71-29h-60v-80q0-83-58.5-141.5T480-720q-27 0-52 6.5T380-693l-58-58q35-24 74.5-36.5T480-800q117 0 198.5 81.5T760-520q69 8 114.5 59.5T920-340q0 39-15 72.5T864-210ZM593-479Z"/></svg>'
                : ''
        }
        renderPanel()
    }

    // ---- Init ----

    const init = (callbacks) => {
        onOfflineChange = callbacks.onOfflineChange || null
        onLoginNeeded = callbacks.onLoginNeeded || null

        window.addEventListener('online', () => probe())
        window.addEventListener('offline', () => goOffline())

        // Reflect any buffered work left over from a previous load, then try to
        // drain it (retrying past failures). If we're really offline the CSRF
        // fetch fails harmlessly and the ping keeps retrying.
        lastUiOffline = isOffline()
        if (!connected || hasPending()) startPing()
        updateOfflineUI()
        renderPanel()
        if (getQueueSize() > 0) autoSync({ retryFailed: true })
    }

    return {
        init,
        apiFetch,
        isOffline,
        getCache,
        setCache,
        setLoggedIn,
        wasLoggedIn,
        setCredentials,
        getCredentials,
        clearCredentials,
        getUpdatedAt,
        enqueue,
        makePurchaseBundle,
        makeSessionStartItem,
        makeSessionEndItem,
        sync,
        getQueueSize,
        renderPanel,
        goOffline,
        goOnline,
    }
})()
