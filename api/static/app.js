document.addEventListener("DOMContentLoaded", async () => {

    var checkoutProduct = null
    var checkoutTab = null
    var activeHost = null
    var busy = false
    var csrftoken = null

    // Client config from GET /api/config/ (cached for offline). Drives the
    // optional "Käteinen" (cash) checkout row and the "Oma summa" button.
    // custom_amount defaults on so an outage before the first config load keeps
    // the long-standing feature visible.
    var appConfig = { cash_enabled: false, custom_amount_enabled: true, negative_balance_limit: null }

    const tabsById = {}
    var enteredPin = ''

    // Multi-tab purchase state
    var multiTabMode = false
    // Map<tabId, { tab: {id,name,pin_required,...}, pin: string|null }>
    const selectedTabs = new Map()
    var multiTabPinPendingTab = null

    // State for the statistics-panel PIN-required toggle (separate from the
    // checkout keypad so the two flows never interfere).
    var statisticsPinTab = null
    var statisticsEnteredPin = ''
    var statisticsDesiredPinRequired = false

    const audio = new Audio('purchase.m4a')


    const currency = (n) => {
        return parseFloat(n).toFixed(2).replace('.',',') + ' €'
    }

    const humanizeTime = (dateString) => {
        const now = new Date()
        const date = new Date(dateString)
        const diffInSeconds = Math.floor((now - date) / 1000)

        if (diffInSeconds < 60) {
            return diffInSeconds === 1 ? '1 sekunti sitten' : `${diffInSeconds} sekuntia sitten`
        }

        const diffInMinutes = Math.floor(diffInSeconds / 60)
        if (diffInMinutes < 60) {
            return diffInMinutes === 1 ? '1 minuutti sitten' : `${diffInMinutes} minuuttia sitten`
        }

        const diffInHours = Math.floor(diffInMinutes / 60)
        if (diffInHours < 24) {
            return diffInHours === 1 ? '1 tunti sitten' : `${diffInHours} tuntia sitten`
        }

        const diffInDays = Math.floor(diffInHours / 24)
        if (diffInDays < 7) {
            return diffInDays === 1 ? '1 päivä sitten' : `${diffInDays} päivää sitten`
        }

        const diffInWeeks = Math.floor(diffInDays / 7)
        if (diffInDays < 30) {
            return diffInWeeks === 1 ? '1 viikko sitten' : `${diffInWeeks} viikkoa sitten`
        }

        const diffInMonths = Math.floor(diffInDays / 30)
        if (diffInMonths < 12) {
            return diffInMonths === 1 ? '1 kuukausi sitten' : `${diffInMonths} kuukautta sitten`
        }

        const diffInYears = Math.floor(diffInDays / 365)
        return diffInYears === 1 ? '1 vuosi sitten' : `${diffInYears} vuotta sitten`
    }

    const checkResponse = (response) => response.ok

    // Read a quantity input as a non-negative decimal count (0.01 precision, 0–99.99).
    const readCount = (input) => {
        if(!input) return 0
        const value = Math.round(parseFloat(input.value.replace(',', '.')) * 100) / 100
        if(isNaN(value) || value < 0 || value >= 100) return 0
        return value
    }

    // Build the purchase line items for the current checkout selection. A custom
    // amount yields a single item; a single-price product yields one item from
    // its count; a product with separate in/out prices yields one item per
    // non-zero count, so both prices can be purchased at once.
    const getLineItems = () => {
        if(checkoutProduct === null) return []
        const customPrice = document.querySelector('#custom-price')
        if(customPrice) {
            const value = parseFloat(customPrice.value.replace(',', '.'))
            if(isNaN(value) || value <= 0 || value >= 1000) return []
            return [{ quantity: 1, total: value.toFixed(2) }]
        }
        const items = []
        // Only tag in/out when the product actually has two distinct prices;
        // a single-price product is left untagged (price_type empty).
        const hasDistinctPrices = checkoutProduct.price_in !== checkoutProduct.price_out
        const inCount = readCount(document.querySelector('#quantity-in'))
        if(inCount > 0) {
            items.push({ quantity: inCount, total: (inCount * parseFloat(checkoutProduct.price_in)).toFixed(2), price_type: 'in' })
        }
        const outCount = readCount(document.querySelector('#quantity-out'))
        if(outCount > 0) {
            const item = { quantity: outCount, total: (outCount * parseFloat(checkoutProduct.price_out)).toFixed(2) }
            if(hasDistinctPrices) item.price_type = 'out'
            items.push(item)
        }
        // Cash sales are free in the system (0,00) but still record the quantity
        // sold (which decrements stock server-side).
        const cashCount = readCount(document.querySelector('#quantity-cash'))
        if(cashCount > 0) {
            items.push({ quantity: cashCount, total: '0.00', price_type: 'cash' })
        }
        return items
    }

    const getTab = () => {
        const tab = checkoutTab
        if(tab === null) {
            return null
        }
        return tab
    }

    const wouldExceedBalanceLimit = (tab, items) => {
        const limit = appConfig.negative_balance_limit
        if (limit == null) return false
        const tabData = tabsById[tab.id]
        if (!tabData || tabData.ignore_balance_limit) return false
        const total = items.reduce((s, it) => s + parseFloat(it.total), 0)
        return (parseFloat(tabData.balance) - total) < parseFloat(limit)
    }

    const showBalanceLimitToast = () => {
        PiikkiToast.show({
            id: 'purchase-error',
            message: 'Saldo ylittyy — ostoa ei voitu tehdä',
            variant: 'error', icon: 'error', duration: 4000, dismissible: true,
        })
    }

    const deductLocalBalance = (tabId, items) => {
        const tabData = tabsById[tabId]
        if (!tabData) return
        const total = items.reduce((s, it) => s + parseFloat(it.total), 0)
        tabData.balance = (parseFloat(tabData.balance) - total).toFixed(2)
    }

    // Clamp a quantity input to a decimal in 0–99.99 (0.01 precision).
    const normalizeCount = (input) => {
        let value = Math.round(parseFloat(input.value.replace(',', '.')) * 100) / 100
        if(isNaN(value) || value < 0) value = 0
        if(value > 99.99) value = 99.99
        input.value = value
    }

    // Step a quantity input by the given amount (used by the − and + buttons).
    const stepCount = (input, difference) => {
        let value = Math.round(parseFloat(input.value.replace(',', '.')) * 100) / 100
        if(isNaN(value)) value = 0
        value = Math.round(Math.min(99.99, Math.max(0, value + difference)) * 100) / 100
        input.value = value
        updateConfirmation()
    }

    const toLogin = (message = null) => {
        document.querySelector('.login-panel').classList.add('active')
        setLoginBusy(false)
        showLoginError(message)
    }

    // Reveal the PIN keypad above the confirm button. The button itself
    // becomes disabled and the "Syötä PIN" overlay (driven by the pin-mode
    // class) shows until a PIN is entered.
    const revealPinpad = (tab) => {
        const confirmation = document.querySelector('#confirmation')
        if(confirmation.classList.contains('pin-mode')) return
        renderPinpad(tab)
        confirmation.classList.add('pin-mode')
        document.querySelector('#confirmation .button').classList.add('disabled')
        positionPinpad()
    }

    // The keypad is position: fixed so it escapes the overflow clipping of the
    // checkout columns and can overlap any other content. Anchor it just above
    // the confirm button, aligned to its right edge, and clamp it to the
    // viewport so it never spills off the left or top.
    const positionPinpad = () => {
        const confirmation = document.querySelector('#confirmation')
        if(!confirmation.classList.contains('pin-mode')) return
        const pinpad = document.querySelector('#pinpad')
        const card = pinpad && pinpad.querySelector('.pin-card')
        const button = document.querySelector('#confirmation .button')
        if(!card || !button) return
        const gap = 8
        const margin = 8
        const buttonRect = button.getBoundingClientRect()
        const cardRect = card.getBoundingClientRect()
        let left = buttonRect.right - cardRect.width
        let top = buttonRect.top - gap - cardRect.height
        left = Math.max(margin, Math.min(left, window.innerWidth - cardRect.width - margin))
        top = Math.max(margin, top)
        pinpad.style.left = `${left}px`
        pinpad.style.top = `${top}px`
    }

    window.addEventListener('resize', positionPinpad)

    // Cancel PIN entry: hide the keypad and restore the normal confirm button.
    const hidePinpad = () => {
        const confirmation = document.querySelector('#confirmation')
        confirmation.classList.remove('pin-mode')
        document.querySelector('#confirmation .button').classList.remove('disabled')
        enteredPin = ''
    }

    // Clear all multi-tab selections and visual highlights.
    const clearMultiTabState = () => {
        selectedTabs.clear()
        multiTabPinPendingTab = null
        document.querySelectorAll(
            '.checkout-panel .tab-list .tabs > div.selected, ' +
            '.checkout-panel .tab-list .suggestions > div.selected'
        ).forEach(el => el.classList.remove('selected'))
    }

    const renderPinpadMultiTab = (tab) => {
        const pinpad = document.querySelector('#pinpad')
        enteredPin = ''
        renderPinCard(pinpad, tab, pinKeyPressedMultiTab)
    }

    const revealMultiTabPinpad = (tab) => {
        const confirmation = document.querySelector('#confirmation')
        if (confirmation.classList.contains('pin-mode')) return
        multiTabPinPendingTab = tab
        renderPinpadMultiTab(tab)
        confirmation.classList.add('pin-mode')
        document.querySelector('#confirmation .button').classList.add('disabled')
        positionPinpad()
    }

    const pinKeyPressedMultiTab = (key) => {
        if (busy) return
        if (key === 'cancel') { cancelMultiTabPin(); return }
        const tab = multiTabPinPendingTab
        if (!tab || tab.pin_locked) return
        if (key === 'backspace') {
            enteredPin = enteredPin.slice(0, -1)
        } else if (enteredPin.length < 6) {
            enteredPin += key
        }
        document.querySelectorAll('#pinpad .pin-dot').forEach((dot, i) => {
            dot.classList.toggle('filled', i < enteredPin.length)
        })
        if (enteredPin.length === 6) {
            document.querySelectorAll('#pinpad .pin-key').forEach(btn => btn.disabled = true)
            verifyPinForTabSelection(enteredPin)
        }
    }

    const cancelMultiTabPin = () => {
        hidePinpad()
        multiTabPinPendingTab = null
        updateConfirmation()
    }

    // Apply wrong-PIN / lockout feedback to any pin card. Updates the tab object
    // in place and reflects attempt count + locked state in the DOM.
    const applyPinError = (pinpadSelector, tab, body) => {
        const attempts = body.pin_attempts || 0
        tab.pin_attempts = attempts
        document.querySelectorAll(`${pinpadSelector} .pin-dot`).forEach(dot => dot.classList.remove('filled'))
        document.querySelectorAll(`${pinpadSelector} .pin-key`).forEach(btn => btn.disabled = false)
        const attemptsEl = document.querySelector(`${pinpadSelector} .pin-attempts`)
        if(attemptsEl) attemptsEl.textContent = attempts > 0 ? `Väärä PIN-koodi. Yrityksiä: ${attempts}` : ''
        if(body.pin_locked) {
            tab.pin_locked = true
            const lockedEl = document.querySelector(`${pinpadSelector} .pin-locked`)
            if(lockedEl) lockedEl.classList.add('active')
            const card = document.querySelector(`${pinpadSelector} .pin-card`)
            if(card) card.classList.add('locked')
        }
    }

    const verifyPinForTabSelection = async (pin, allowReauth = true) => {
        const tab = multiTabPinPendingTab
        if (!tab) return
        let response
        try {
            const token = await getCsrfToken()
            response = await fetch(`../api/tabs/${tab.id}/verify_pin/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': token },
                body: JSON.stringify({ pin })
            })
        } catch (e) {
            enteredPin = ''
            document.querySelectorAll('#pinpad .pin-dot').forEach(dot => dot.classList.remove('filled'))
            document.querySelectorAll('#pinpad .pin-key').forEach(btn => btn.disabled = false)
            PiikkiToast.show({ id: 'pin-error', message: 'Yhteys palvelimeen epäonnistui', variant: 'error', icon: 'error', duration: 4000, dismissible: true })
            return
        }
        if (response.status === 200) {
            selectedTabs.set(tab.id, { tab, pin })
            if (tabsById[tab.id]) tabsById[tab.id].pin_attempts = 0
            document.querySelectorAll(
                `.checkout-panel .tab-list .tabs > div[data-id="${tab.id}"],` +
                `.checkout-panel .tab-list .suggestions > div[data-id="${tab.id}"]`
            ).forEach(el => el.classList.add('selected'))
            hidePinpad()
            multiTabPinPendingTab = null
            updateConfirmation()
            return
        }
        const cls = await classifyMutation(response)
        if (cls.kind === 'auth') {
            if (allowReauth && await trySilentReauth()) {
                csrftoken = null
                return verifyPinForTabSelection(pin, false)
            }
            toLogin('Istunto vanhentunut — kirjaudu uudelleen')
            return
        }
        enteredPin = ''
        applyPinError('#pinpad', tab, cls.body || {})
        positionPinpad()
    }

    const toggleMultiTabMode = () => {
        if (multiTabPinPendingTab !== null) cancelMultiTabPin()
        multiTabMode = !multiTabMode
        document.querySelector('#multi-tab-toggle').classList.toggle('active', multiTabMode)
        clearMultiTabState()
        checkoutTab = null
        updateConfirmation()
    }

    const confirmMultiTabPurchase = async () => {
        if (busy) return
        const items = getLineItems()
        if (items.length === 0 || selectedTabs.size === 0) return

        const blockedTabs = [...selectedTabs.values()].filter(({ tab }) => wouldExceedBalanceLimit(tab, items))
        if (blockedTabs.length) {
            const names = blockedTabs.map(({ tab }) => tab.name).join(', ')
            PiikkiToast.show({
                id: 'purchase-error',
                message: `Piikkejä, joiden saldo ei riitä, ei veloitettu: ${names}`,
                variant: 'error', icon: 'error', duration: 0, dismissible: true,
            })
            toMain()
            return
        }

        busy = true

        if (PiikkiOffline.isOffline()) {
            for (const { tab, pin } of selectedTabs.values()) {
                enqueuePurchaseItems(items, tab, pin)
                deductLocalBalance(tab.id, items)
            }
            document.querySelector('#confirmation').classList.add('ok')
            audio.play()
            setTimeout(() => { busy = false; toMain() }, 500)
            return
        }

        const token = await getCsrfToken()
        if (!token) {
            for (const { tab, pin } of selectedTabs.values()) {
                enqueuePurchaseItems(items, tab, pin)
                deductLocalBalance(tab.id, items)
            }
            document.querySelector('#confirmation').classList.add('ok')
            audio.play()
            setTimeout(() => { busy = false; toMain() }, 500)
            return
        }
        document.querySelector('#confirmation').classList.add('ok')
        audio.play()
        const bundles = []
        for (const { tab, pin } of selectedTabs.values()) {
            const taggedItems = items.map(it => ({ ...it, client_uuid: crypto.randomUUID() }))
            bundles.push({ tab, pin, items: taggedItems })
        }
        setTimeout(async () => {
            let result
            try {
                result = await runPurchaseAttempts(bundles, true)
            } catch {
                for (const b of bundles) {
                    enqueuePurchaseItems(b.items, b.tab, b.pin)
                    deductLocalBalance(b.tab.id, b.items)
                }
                busy = false
                toMain()
                return
            }
            busy = false
            if (!result.ok) {
                document.querySelector('#confirmation').classList.remove('ok')
                if (result.kind === 'auth') {
                    toLogin('Istunto vanhentunut — kirjaudu uudelleen')
                } else if (result.kind === 'balance_limit') {
                    const names = [...result.balanceLimitedTabs].join(', ')
                    PiikkiToast.show({
                        id: 'purchase-error',
                        message: `Piikkejä, joiden saldo ei riitä, ei veloitettu: ${names}`,
                        variant: 'error', icon: 'error', duration: 0, dismissible: true,
                    })
                } else {
                    PiikkiToast.show({
                        id: 'purchase-error',
                        message: 'Osto epäonnistui osalle piikeistä — tarkista tilanne historiasta',
                        variant: 'error', icon: 'error', duration: 0, dismissible: true,
                    })
                }
            } else {
                for (const b of bundles) deductLocalBalance(b.tab.id, b.items)
            }
            toMain()
        }, 500)
    }

    // Click handler for the confirm button. For PIN-protected tabs the first
    // press reveals the keypad instead of completing the purchase.
    const onConfirmClick = () => {
        if(busy) return
        const button = document.querySelector('#confirmation .button')
        if(button.classList.contains('disabled')) return
        if (multiTabMode) {
            confirmMultiTabPurchase()
            return
        }
        const tab = getTab()
        if(tab !== null && tab.pin_required) {
            revealPinpad(tab)
            return
        }
        confirmPurchase()
    }

    const postPurchases = (items, pin, token, tab) => {
        const body = {
            tab: tab.id,
            product: checkoutProduct?.id,
            items: items.map(it => ({
                quantity: it.quantity,
                total: it.total,
                price_type: it.price_type || null,
                client_uuid: it.client_uuid,
            })),
        }
        if (pin !== null) body.pin = pin
        return fetch('../api/purchases/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': token },
            body: JSON.stringify(body),
        })
    }

    const enqueuePurchaseItems = (items, tab, pin = null) => {
        const productName = checkoutProduct ? checkoutProduct.name : 'Oma summa'
        const body = {
            tab: tab.id,
            product: checkoutProduct?.id,
            items: items.map(it => ({
                quantity: it.quantity, total: it.total,
                price_type: it.price_type || null,
                client_uuid: it.client_uuid || crypto.randomUUID(),
            })),
        }
        if (pin != null) body.pin = pin
        PiikkiOffline.enqueue(PiikkiOffline.makePurchaseBundle(body, productName, tab.name))
    }

    const confirmPurchase = async () => {
        if(busy) return
        const items = getLineItems().map((it) => ({ ...it, client_uuid: crypto.randomUUID() }))
        const tab = getTab()
        if(items.length === 0 || tab === null) return

        if (wouldExceedBalanceLimit(tab, items)) { showBalanceLimitToast(); return }
        busy = true

        if (PiikkiOffline.isOffline()) {
            enqueuePurchaseItems(items, tab)
            deductLocalBalance(tab.id, items)
            document.querySelector('#confirmation').classList.add('ok')
            audio.play()
            setTimeout(() => { busy = false; toMain() }, 500)
            return
        }

        const token = await getCsrfToken()
        if (!token) {
            enqueuePurchaseItems(items, tab)
            deductLocalBalance(tab.id, items)
            document.querySelector('#confirmation').classList.add('ok')
            audio.play()
            setTimeout(() => { busy = false; toMain() }, 500)
            return
        }
        document.querySelector('#confirmation').classList.add('ok')
        audio.play()
        setTimeout(async () => {
            try {
                const response = await postPurchases(items, null, token, tab)
                busy = false
                if (response.ok) {
                    deductLocalBalance(tab.id, items)
                    toMain()
                    return
                }
                const cls = await classifyMutation(response)
                document.querySelector('#confirmation').classList.remove('ok')
                if (cls.kind === 'balance_limit') {
                    showBalanceLimitToast()
                } else if (cls.kind === 'auth') {
                    enqueuePurchaseItems(items, tab)
                    deductLocalBalance(tab.id, items)
                    trySilentReauth()
                    toMain()
                } else {
                    PiikkiToast.show({
                        id: 'purchase-error',
                        message: 'Osto epäonnistui — tarkista tilanne historiasta',
                        variant: 'error', icon: 'error', duration: 0, dismissible: true,
                    })
                    toMain()
                }
            } catch {
                enqueuePurchaseItems(items, tab)
                deductLocalBalance(tab.id, items)
                busy = false
                toMain()
            }
        }, 500)
    }

    const submitPinPurchase = async (pin, items = null, allowReauth = true) => {
        if(busy) return
        if (!items) items = getLineItems().map((it) => ({ ...it, client_uuid: crypto.randomUUID() }))
        const tab = getTab()
        if(items.length === 0 || tab === null) return

        if (wouldExceedBalanceLimit(tab, items)) {
            hidePinpad()
            showBalanceLimitToast()
            return
        }

        let response
        try {
            const token = await getCsrfToken()
            response = await postPurchases(items, pin, token, tab)
        } catch (e) {
            enteredPin = ''
            document.querySelectorAll('#pinpad .pin-dot').forEach(dot => dot.classList.remove('filled'))
            document.querySelectorAll('#pinpad .pin-key').forEach(btn => btn.disabled = false)
            PiikkiToast.show({ id: 'pin-error', message: 'Yhteys palvelimeen epäonnistui', variant: 'error', icon: 'error', duration: 4000, dismissible: true })
            return
        }
        if (response.ok) {
            busy = true
            hidePinpad()
            deductLocalBalance(tab.id, items)
            document.querySelector('#confirmation').classList.add('ok')
            audio.play()
            setTimeout(() => { toMain() }, 500)
            return
        }
        const cls = await classifyMutation(response)
        if (cls.kind === 'balance_limit') {
            hidePinpad()
            showBalanceLimitToast()
            return
        }
        if (cls.kind === 'auth') {
            if (allowReauth && await trySilentReauth()) {
                csrftoken = null
                return submitPinPurchase(pin, items, false)
            }
            toLogin('Istunto vanhentunut — kirjaudu uudelleen')
            return
        }
        enteredPin = ''
        applyPinError('#pinpad', tab, cls.body || {})
        positionPinpad()
    }

    const pinKeyPressed = (key) => {
        if(busy) return
        if(key === 'cancel') {
            hidePinpad()
            return
        }
        const tab = getTab()
        if(tab === null || tab.pin_locked) return
        if(key === 'backspace') {
            enteredPin = enteredPin.slice(0, -1)
        } else if(enteredPin.length < 6) {
            enteredPin += key
        }
        document.querySelectorAll('#pinpad .pin-dot').forEach((dot, index) => {
            if(index < enteredPin.length) {
                dot.classList.add('filled')
            } else {
                dot.classList.remove('filled')
            }
        })
        if(enteredPin.length === 6) {
            document.querySelectorAll('#pinpad .pin-key').forEach(btn => btn.disabled = true)
            submitPinPurchase(enteredPin)
        }
    }

    // The 12 keypad buttons (digits, cancel ✕, backspace ⌫).
    const pinKeysHtml = () => {
        const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'cancel', '0', 'backspace']
        return keys.map((key) => {
            if(key === 'backspace') {
                return `<button class="pin-key backspace" data-digit="backspace">⌫</button>`
            }
            if(key === 'cancel') {
                return `<button class="pin-key cancel" data-digit="cancel">✕</button>`
            }
            return `<button class="pin-key" data-digit="${key}">${key}</button>`
        }).join('')
    }

    // Build a full PIN card (attempt counter, six dots, locked message, keypad)
    // for the given tab. Shared by the checkout keypad and the statistics
    // PIN-required toggle. `onKey` is wired to every key button.
    const renderPinCard = (container, tab, onKey) => {
        const attempts = tab.pin_attempts || 0
        const attemptsText = attempts > 0 ? `Väärä PIN-koodi. Yrityksiä: ${attempts}` : ''
        container.innerHTML = `
            <div class="pin-card${tab.pin_locked ? ' locked' : ''}">
                <div class="pin-attempts">${attemptsText}</div>
                <div class="pin-dots">
                    <div class="pin-dot"></div>
                    <div class="pin-dot"></div>
                    <div class="pin-dot"></div>
                    <div class="pin-dot"></div>
                    <div class="pin-dot"></div>
                    <div class="pin-dot"></div>
                </div>
                <div class="pin-locked${tab.pin_locked ? ' active' : ''}">Piikki on lukittu liian monen väärän yrityksen vuoksi.</div>
                <div class="pin-keys">${pinKeysHtml()}</div>
            </div>
        `
        container.querySelectorAll('.pin-key[data-digit]').forEach((button) => {
            button.addEventListener('click', () => onKey(button.dataset.digit))
        })
    }

    const renderPinpad = (tab) => {
        var pinpad = document.querySelector('#pinpad')
        if(!pinpad) {
            pinpad = document.createElement('div')
            pinpad.id = 'pinpad'
            document.querySelector('#confirmation').appendChild(pinpad)
        }
        enteredPin = ''
        renderPinCard(pinpad, tab, pinKeyPressed)
    }

    const updateConfirmation = () => {
        if(busy) return
        const items = getLineItems()
        const total = items.reduce((sum, item) => sum + parseFloat(item.total), 0)
        const div = document.querySelector('#confirmation .summary')
        const button = document.querySelector('#confirmation .button')
        const confirmation = document.querySelector('#confirmation')

        let displayName = null
        let hasSelection = false

        if (multiTabMode) {
            const count = selectedTabs.size
            if (count === 1) {
                displayName = [...selectedTabs.values()][0].tab.name
            } else if (count > 1) {
                displayName = `${count}×`
            }
            hasSelection = count > 0
        } else {
            const tab = getTab()
            if (tab !== null) { displayName = tab.name; hasSelection = true }
        }

        if(items.length === 0 || !hasSelection) {
            div.innerHTML = ``
            button.classList.add('disabled')
        } else {
            div.innerHTML = ''
            const nameDiv = document.createElement('div')
            nameDiv.textContent = displayName
            const arrowDiv = document.createElement('div')
            arrowDiv.textContent = '←'
            const totalDiv = document.createElement('div')
            totalDiv.textContent = currency(total)
            div.append(nameDiv, arrowDiv, totalDiv)
            button.classList.remove('disabled')
        }

        // The PIN keypad is only revealed by pressing the confirm button (single-tab)
        // or by tapping a pin_required tab (multi-tab). Only reset it here for
        // single-tab mode; multi-tab mode manages the PIN pad separately.
        if (!multiTabMode) {
            confirmation.classList.remove('pin-mode')
            enteredPin = ''
        }
    }

    // Markup for one quantity row: a title, optional unit price, and a stepper
    // (− input +). Used for the single-price "Määrä" row and the in/out rows.
    const quantityRowHtml = (id, label, priceText, initial) => `
        <div class="checkout-quantity">
            <div class="row-header">
                <h2>${label}</h2>
                ${priceText ? `<span class="row-price">${priceText}</span>` : ''}
            </div>
            <div class="quantity-button decrease">−</div>
            <input class="quantity-input" id="${id}" type="number" inputmode="decimal" step="0.01" value="${initial}">
            <div class="quantity-button increase">+</div>
        </div>`

    // Wire the stepper buttons and input events for every rendered quantity row.
    const wireQuantityRows = () => {
        document.querySelectorAll('.checkout-quantity').forEach((row) => {
            const input = row.querySelector('.quantity-input')
            input.addEventListener('input', updateConfirmation)
            input.addEventListener('change', () => { normalizeCount(input); updateConfirmation() })
            row.querySelector('.decrease').addEventListener('click', () => stepCount(input, -1))
            row.querySelector('.increase').addEventListener('click', () => stepCount(input, 1))
        })
    }

    const toCheckout = async (product, element) => {
        if(checkoutProduct !== null) {
            return
        }
        checkoutProduct = product
        multiTabMode = false
        clearMultiTabState()
        const toggleBtnOnEntry = document.querySelector('#multi-tab-toggle')
        if (toggleBtnOnEntry) toggleBtnOnEntry.classList.remove('active')
        element.classList.add('selected')
        const f_price_out = currency(product.price_out)
        const f_price_in = currency(product.price_in)
        const fetchTabsPromise = fetchTabs()
        const descriptionElement = document.querySelector('#checkout-description')
        document.querySelector('#checkout-title').textContent = product.name
        if(product.note || product.description) {
            const noteH2 = document.createElement('h2')
            noteH2.textContent = product.note || ''
            const descP = document.createElement('p')
            descP.textContent = product.description || ''
            descriptionElement.innerHTML = ''
            descriptionElement.append(noteH2, descP)
            descriptionElement.style = 'display: block'
        } else {
            descriptionElement.style = 'display: none'
        }

        const options = document.querySelector('.checkout-column .options')
        if(product.id === null) {
            // Custom amount: a free-form price with no quantity.
            options.innerHTML = `<div id="checkout-price"><h2>Summa</h2><input type="text" id="custom-price" placeholder="0,00" step="0.01"><span style="font-size: 1.5rem">€</span></div>`
            document.querySelector('input#custom-price').addEventListener('input', updateConfirmation)
        }
        else {
            // Optional cash row (price-less): shown for any real product when
            // cash checkout is enabled. Cash is free in the system (0,00).
            const cashRow = appConfig.cash_enabled ? quantityRowHtml('quantity-cash', 'Käteinen', '', 0) : ''
            if(product.price_in === product.price_out) {
                // Single price: one quantity input with the price shown beside it.
                options.innerHTML = quantityRowHtml('quantity-out', 'Määrä', f_price_out, 1) + cashRow
            } else {
                // Separate in/out prices: a quantity input for each, both starting at 0.
                options.innerHTML = quantityRowHtml('quantity-in', 'Sisään', f_price_in, 0) +
                    quantityRowHtml('quantity-out', 'Ulos', f_price_out, 0) + cashRow
            }
        }
        wireQuantityRows()
        updateConfirmation()
        await fetchTabsPromise
        document.querySelector('.main-panel').classList.remove('active')
        document.querySelector('.checkout-panel').classList.add('active')
        PiikkiBack.sync()
    }

    const enableQuickPayment = () => {
        const button = document.querySelector('.quick-payment')
        button.addEventListener('click', () => {
            toCheckout({
                "id": null,
                "name": "Oma summa"
            }, button)
        })
    }

    // Reflect config-driven UI that lives outside the per-checkout render. The
    // "Oma summa" button is hidden when custom_amount_enabled is falsey; the
    // cash row is handled inline in toCheckout.
    const applyAppConfig = () => {
        const button = document.querySelector('.quick-payment')
        if (button) button.style.display = appConfig.custom_amount_enabled ? '' : 'none'
        const nav = document.querySelector('.navigation')
        if (nav) nav.style.marginBottom = appConfig.custom_amount_enabled ? '' : '1rem'
    }


    const toMain = () => {
        fetchProducts()
        document.querySelector('.main-panel').classList.add('active')
        document.querySelector('.checkout-panel').classList.remove('active')
        document.querySelectorAll('.product-column .selected, .quick-payment.selected').forEach((x) => x.classList.remove('selected'))
        setTimeout(() => {
            document.querySelector('#confirmation').classList.remove('ok')
            document.querySelector('#confirmation').classList.remove('pin-mode')
            enteredPin = ''
            document.querySelector('.checkout-panel main').scroll(0, 0)
            document.querySelector('.checkout-panel .tab-list').scroll(0, 0)
            document.querySelector('.checkout-column .options').innerHTML = ''
            busy = false
        }, 250)
        checkoutProduct = null
        checkoutTab = null
        multiTabMode = false
        clearMultiTabState()
        const toggleBtnOnExit = document.querySelector('#multi-tab-toggle')
        if (toggleBtnOnExit) toggleBtnOnExit.classList.remove('active')
        PiikkiBack.sync()
    }

    const handleBackButton = () => {
        if(busy) return
        busy = true
        toMain()
    }

    const blink = (element) => {
        if(element.classList.contains('blink')) return
        element.classList.add('blink')
        setTimeout(() => element.classList.remove('blink'), 2000)
    }

    const selectTab = (element) => {
        const id = parseInt(element.dataset.id)
        const tabData = tabsById[id]
        const tabObj = {
            "id": id,
            "name": element.textContent,
            "pin_required": tabData ? !!tabData.pin_required : false,
            "pin_attempts": tabData ? (tabData.pin_attempts || 0) : 0,
            "pin_locked": tabData ? !!tabData.pin_locked : false
        }

        if (PiikkiOffline.isOffline() && tabObj.pin_required) {
            PiikkiToast.show({ id: 'pin-offline', message: 'PIN-suojatut piikit eivät ole käytettävissä offline-tilassa', variant: 'error', icon: 'error', duration: 4000 })
            return
        }

        if (!multiTabMode) {
            document.querySelectorAll('.checkout-panel .tab-list .tabs > div, .checkout-panel .tab-list .suggestions > div').forEach((x) => x.classList.remove('selected'))
            element.classList.add('selected')
            checkoutTab = tabObj
            updateConfirmation()
            return
        }

        if (multiTabPinPendingTab !== null) cancelMultiTabPin()

        if (selectedTabs.has(id)) {
            selectedTabs.delete(id)
            element.classList.remove('selected')
            updateConfirmation()
            return
        }

        if (tabObj.pin_required) {
            revealMultiTabPinpad(tabObj)
            return
        }

        selectedTabs.set(id, { tab: tabObj, pin: null })
        element.classList.add('selected')
        updateConfirmation()
    }

    const selectSessionTab = (element) => {
        document.querySelectorAll('#session-tab-list .tabs > div, #session-tab-list .suggestions > div').forEach((x) => x.classList.remove('selected'))
        element.classList.add('selected')
        document.querySelector('#session-confirm').classList.remove('disabled')
    }

    const renderTabs = (tabs) => {
        const alphabetContainer = document.querySelector('.checkout-panel .alphabet')
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZÅÄÖ"

        Object.keys(tabsById).forEach((key) => delete tabsById[key])
        tabs.forEach((x) => { tabsById[x.id] = x })

        alphabetContainer.innerHTML = ''
        document.querySelector('.checkout-panel .tab-list .tabs').innerHTML = ''
        document.querySelector('.checkout-panel .tab-list .suggestions').innerHTML = ''

        tabs.forEach((x) => {
            const element = document.createElement('div')
            element.dataset.id = x.id
            element.textContent = x.name
            document.querySelector('.checkout-panel .tab-list .tabs').appendChild(element)
            element.addEventListener('click', () => selectTab(element))
        })
        tabs.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 6).forEach((x) => {
            const element = document.createElement('div')
            element.dataset.id = x.id
            element.textContent = x.name
            document.querySelector('.checkout-panel .tab-list .suggestions').appendChild(element)
            element.addEventListener('click', () => selectTab(element))
        })
        alphabet.split('').forEach((x) => {
            const element = document.createElement('div')
            if(Array.from(document.querySelectorAll('.checkout-panel .tab-list .tabs > div')).filter((y) => y.innerHTML[0].toUpperCase() === x).length === 0){
                element.classList.add('disabled')
            } else {
                element.addEventListener('click', () => {
                    const matches = Array.from(document.querySelectorAll('.checkout-panel .tab-list .tabs > div')).filter((y) => y.innerHTML[0].toUpperCase() === x)
                    const first = matches[0]
                    if(first) first.scrollIntoView()
                    matches.forEach((y) => blink(y))
                })
            }
            element.innerHTML = x
            alphabetContainer.appendChild(element)
        })
        document.querySelector('#session-tab-list').innerHTML = document.querySelector('.checkout-panel .tab-list').innerHTML
        document.querySelectorAll('#session-tab-list .pin-disabled').forEach(el => el.classList.remove('pin-disabled'))
        document.querySelectorAll('#session-tab-list .suggestions > div, #session-tab-list .tabs > div').forEach((x) => {
            x.addEventListener('click', () => selectSessionTab(x))
        })
        document.querySelectorAll('#session-tab-list .alphabet > div').forEach((x) => {
            x.addEventListener('click', (element) => {
                const matches = Array.from(document.querySelectorAll('#session-tab-list .tabs > div')).filter((y) => y.innerHTML[0].toUpperCase() === x.innerHTML)
                const first = matches[0]
                if(first) first.scrollIntoView()
                matches.forEach((y) => blink(y))
            })
        })
    }

    const fetchTabs = async (allowReauth = true) => {
        const { offline, response } = await PiikkiOffline.apiFetch('../api/tabs/')
        if (offline) {
            const cached = PiikkiOffline.getCache('tabs')
            if (cached) { renderTabs(cached); return true }
            return false
        }
        if(!response.ok) {
            return recoverFromFailure(response, allowReauth ? () => fetchTabs(false) : null)
        }
        const tabs = await response.json()
        PiikkiOffline.setCache('tabs', tabs)
        renderTabs(tabs)
        return true
    }

    const renderProducts = (products) => {
        document.querySelector('.product-column').innerHTML = ''
        document.querySelector('.navigation').innerHTML = document.querySelector('.navigation').firstElementChild.outerHTML
        products.forEach(group => {
            if(group.products.filter((x) => x.in_stock).length === 0) return
            const div = document.createElement('div')
            div.id = `category-${group.id}`
            div.classList.add('category')
            const title = document.createElement('h2')
            title.textContent = group.name
            div.appendChild(title)

            const productsDiv = document.createElement('div')
            productsDiv.classList.add('products')
            div.appendChild(productsDiv)

            group.products.filter((x) => x.in_stock).sort((a, b) => a.name.localeCompare(b.name)).forEach(product => {
                const productDiv = document.createElement('div')
                productDiv.id = `product-${product.id}`
                const price = product.price_out === product.price_in ? `${product.price_out.replace(".",",")} €` : `${product.price_in.replace(".",",")} € / ${product.price_out.replace(".",",")} €`
                const h3 = document.createElement('h3')
                h3.textContent = product.name
                const infoDiv = document.createElement('div')
                const noteSpan = document.createElement('span')
                noteSpan.className = 'note'
                noteSpan.textContent = product.note || ''
                const priceSpan = document.createElement('span')
                priceSpan.className = 'price'
                priceSpan.textContent = price
                infoDiv.append(noteSpan, priceSpan)
                productDiv.append(h3, infoDiv)
                productsDiv.appendChild(productDiv)

                productDiv.addEventListener('click', () => {
                    toCheckout(product, productDiv)
                })
            })

            document.querySelector('.product-column').appendChild(div)
            const a = document.createElement('a')
            a.href = `#category-${group.id}`
            a.dataset.id = group.id
            a.textContent = group.name
            document.querySelector('.navigation').appendChild(a)
        })
        // Add footer to product list
        const footer = document.createElement('footer')
        footer.textContent = 'hifiPiikki — Simo Naatula — 2026'
        document.querySelector('.product-column').appendChild(footer)
        updateMarker()
    }

    const fetchProducts = async (allowReauth = true) => {
        const { offline, response } = await PiikkiOffline.apiFetch('../api/products/')
        if (offline) {
            const cached = PiikkiOffline.getCache('products')
            if (cached) { renderProducts(cached); return true }
            return false
        }
        if(!response.ok) {
            return recoverFromFailure(response, allowReauth ? () => fetchProducts(false) : null)
        }
        const products = await response.json()
        PiikkiOffline.setCache('products', products)
        renderProducts(products)
        return true
    }

    // Load client config (cash_enabled, ...). Caches the last good read so the
    // Käteinen row still renders during an outage; falls back to the cached
    // value (or the safe default) when offline.
    const fetchConfig = async () => {
        const { offline, response } = await PiikkiOffline.apiFetch('../api/config/')
        if (offline) {
            const cached = PiikkiOffline.getCache('config')
            if (cached) appConfig = cached
            applyAppConfig()
            return
        }
        if(!checkResponse(response)) return
        appConfig = await response.json()
        PiikkiOffline.setCache('config', appConfig)
        applyAppConfig()
    }

    const getCsrfToken = async () => {
        if(csrftoken !== null) return csrftoken
        const { offline, response } = await PiikkiOffline.apiFetch('../api/csrf/', { method: 'GET' })
        if (offline) return null
        if(response.status === 200) {
            const body = await response.text()
            csrftoken = body.split('value="')[1].split('"')[0]
        }
        return csrftoken
    }


    // Surface a login error through the shared toast system (deduped by id so a
    // new error replaces the old). No-op on an empty message — toLogin() passes
    // null on a clean first-load prompt.
    const showLoginError = (msg) => {
        if (!msg) return
        PiikkiToast.show({ id: 'login-error', message: msg, variant: 'error', icon: 'error', duration: 4000 })
    }

    const setLoginBusy = (isBusy) => {
        const button = document.querySelector('#login')
        button.disabled = isBusy
        button.textContent = isBusy ? 'Kirjaudutaan…' : 'Kirjaudu'
        document.querySelectorAll('#login-form input').forEach((i) => { i.disabled = isBusy })
    }

    // True only for responses that re-logging-in can actually fix: an expired or
    // invalid session, or a CSRF/cookie failure. DRF SessionAuthentication
    // answers both with 403 (it would use 401 if it set a WWW-Authenticate
    // header). Anything else — 5xx, 404, a flaky proxy — is a general failure
    // that must NOT bounce the operator to the login screen.
    const isAuthFailure = (response) => !!response && (response.status === 401 || response.status === 403)

    // Run a session login. Resolves { ok: true, products } on success, or
    // { ok: false, reason } where reason is 'credentials' (server rejected the
    // username/password) or 'network' (server unreachable / error).
    const performLogin = async (username, password) => {
        // Force a fresh CSRF token: with CSRF_USE_SESSIONS the token lives in the
        // session, so a cached one is stale once the session has changed/expired
        // (which is exactly when a silent re-auth runs) — reusing it CSRF-fails
        // the login POST ("CSRF cookie not set").
        csrftoken = null
        let token
        try {
            token = await getCsrfToken()
        } catch {
            return { ok: false, reason: 'network' }
        }
        if (!token) return { ok: false, reason: 'network' }

        const formData = new FormData()
        formData.append('username', username)
        formData.append('password', password)

        try {
            // redirect: 'manual' — a correct login answers with a 302 to a page
            // we don't care about (Django's default /accounts/profile/, which
            // 404s here); following it would mask success as a failed response.
            // The Set-Cookie from the 302 still establishes the session.
            await fetch('../api/auth/login/', {
                method: 'POST',
                headers: { 'X-CSRFToken': token },
                body: formData,
                redirect: 'manual',
            })
        } catch {
            return { ok: false, reason: 'network' }
        }
        csrftoken = null

        // Success is confirmed by an authenticated probe, never by the login
        // POST's own status: a correct login 302-redirects, while a wrong one
        // re-renders the browsable-API form with 200 — so the status is useless.
        const { offline, response: probe } = await PiikkiOffline.apiFetch('../api/products/')
        if (offline || !probe) return { ok: false, reason: 'network' }
        if (!probe.ok) return { ok: false, reason: isAuthFailure(probe) ? 'credentials' : 'network' }

        const products = await probe.json()
        PiikkiOffline.setCache('products', products)
        return { ok: true, products }
    }

    // Coalesced silent re-auth: when stored credentials exist, transparently
    // re-establish the session after it expires. Concurrent callers (several
    // reads 403-ing at once, plus a buffered mutation) share one in-flight
    // attempt — critical because re-auth and the queue sync both fetch CSRF, and
    // running them concurrently against the cookie-less session races on the
    // anonymous session cookie ("CSRF token incorrect"). So the queue is drained
    // only here, AFTER the single login completes and the session is restored.
    // Stale credentials are dropped so we don't keep retrying a dead password.
    let reauthPromise = null
    const trySilentReauth = () => {
        const creds = PiikkiOffline.getCredentials()
        if (!creds) return Promise.resolve(false)
        if (!reauthPromise) {
            reauthPromise = performLogin(creds.username, creds.password)
                .then((result) => {
                    if (!result.ok && result.reason === 'credentials') {
                        PiikkiOffline.clearCredentials()
                    }
                    if (result.ok) PiikkiOffline.sync({ retryFailed: true })
                    return result.ok
                })
                .catch(() => false)
                .finally(() => { reauthPromise = null })
        }
        return reauthPromise
    }

    // React to a non-ok response on a read request. On an auth failure, try a
    // silent re-login and re-run `retry` once; failing that (or with no stored
    // credentials), show the login dialog. On any other failure, surface a toast
    // and stay put — a transient server/proxy error must never log the operator
    // out. Returns true only if the read ultimately succeeded via the retry.
    const recoverFromFailure = async (response, retry) => {
        if (isAuthFailure(response)) {
            if (retry && await trySilentReauth()) return await retry()
            // Only call it an expiry if there was actually a session to lose; a
            // first-ever load just needs a clean login prompt, not a scare.
            toLogin(PiikkiOffline.wasLoggedIn() ? 'Istunto vanhentunut — kirjaudu uudelleen' : null)
            return false
        }
        PiikkiToast.show({ id: 'api-error', message: 'Palvelinvirhe — yritä uudelleen', variant: 'error', icon: 'error', duration: 4000 })
        return false
    }

    // Classify a non-2xx mutation (purchase / session) response. 'auth' = an
    // expired session or CSRF/cookie failure that re-login fixes; 'pin' = a
    // wrong/locked PIN (a legitimate rejection, never recovered); 'balance_limit'
    // = tab would exceed the negative balance cap; 'error' = anything else.
    // Reads a clone so the caller can still consume the body.
    const classifyMutation = async (response) => {
        if (!response) return { kind: 'error' }
        let body = {}
        try { body = await response.clone().json() } catch {}
        if (body.error === 'balance_limit') return { kind: 'balance_limit', body }
        if (response.status === 401 || response.status === 403) {
            if (body.error === 'wrong_pin' || body.error === 'locked') return { kind: 'pin', body }
            return { kind: 'auth', body }
        }
        return { kind: 'error' }
    }

    // Fire one bundled purchase request per tab in parallel. Each bundle
    // is { tab, pin, items }. Returns { ok, kind, balanceLimitedTabs? }.
    const runPurchaseAttempts = async (bundles, allowReauth) => {
        const token = await getCsrfToken()
        const responses = await Promise.all(bundles.map(b => postPurchases(b.items, b.pin, token, b.tab)))
        const failed = []
        let authLapse = false
        let otherError = false
        const balanceLimitedTabs = new Set()
        for (let i = 0; i < responses.length; i++) {
            if (responses[i].ok) continue
            const cls = await classifyMutation(responses[i])
            if (cls.kind === 'auth') { authLapse = true; failed.push(bundles[i]) }
            else if (cls.kind === 'balance_limit') balanceLimitedTabs.add(bundles[i].tab.name)
            else otherError = true
        }
        if (balanceLimitedTabs.size) return { ok: false, kind: 'balance_limit', balanceLimitedTabs }
        if (otherError) return { ok: false, kind: 'error' }
        if (authLapse) {
            if (allowReauth && await trySilentReauth()) {
                csrftoken = null
                return runPurchaseAttempts(failed, false)
            }
            return { ok: false, kind: 'auth' }
        }
        return { ok: true }
    }

    const handleLogin = async () => {
        const username = document.querySelector('.login-panel input[name="username"]').value.trim()
        const password = document.querySelector('.login-panel input[name="password"]').value
        const remember = document.querySelector('#login-remember').checked

        if (!username || !password) {
            showLoginError('Anna käyttäjätunnus ja salasana')
            return
        }

        showLoginError(null)
        setLoginBusy(true)
        const result = await performLogin(username, password)
        setLoginBusy(false)

        if (!result.ok) {
            showLoginError(result.reason === 'credentials'
                ? 'Väärä käyttäjätunnus tai salasana'
                : 'Palvelimeen ei saada yhteyttä')
            return
        }

        // Persist (or forget) credentials per the operator's choice. Used only
        // for silent re-auth after a session expires; see trySilentReauth.
        if (remember) PiikkiOffline.setCredentials(username, password)
        else PiikkiOffline.clearCredentials()

        renderProducts(result.products)
        PiikkiOffline.setLoggedIn(true)
        document.querySelector('.login-panel').classList.remove('active')
        document.querySelector('#password').value = ''
        busy = false
        // Drain anything buffered while the session was down (e.g. a purchase the
        // operator made just before being prompted to log back in).
        PiikkiOffline.sync({ retryFailed: true })
        updateActiveSession()
        fetchTabs()
        fetchConfig()
        toMain()
    }

    const renderActiveSession = (session) => {
        const container = document.querySelector('#session-info')
        if(session && session.id !== null) {
            container.textContent = session.tab_name
            container.classList.add('active')
            container.classList.remove('none')
            activeHost = session
        } else {
            container.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3"><path d="M480-120v-80h280v-560H480v-80h280q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H480Zm-80-160-55-58 102-102H120v-80h327L345-622l55-58 200 200-200 200Z"/></svg>`
            container.classList.add('none')
            container.classList.remove('active')
            activeHost = null
        }
    }

    const updateActiveSession = async (allowReauth = true) => {
        const { offline, response } = await PiikkiOffline.apiFetch('../api/sessions/active/')
        if (offline) {
            const cached = PiikkiOffline.getCache('session')
            renderActiveSession(cached)
            return true
        }
        if(!response.ok) {
            return recoverFromFailure(response, allowReauth ? () => updateActiveSession(false) : null)
        }
        const session = await response.json()
        PiikkiOffline.setCache('session', session)
        renderActiveSession(session)
        return true
    }

    const openSessionWindow = async () => {
        document.querySelector('.session-panel').classList.add('active')
        document.querySelector('.session-panel').classList.add('opening')
        PiikkiBack.sync()
        document.querySelector('#session-tab-list').scroll(0, 0)
        if(activeHost !== null) {
            if (!PiikkiOffline.isOffline()) await updateActiveSession()
            document.querySelector('.session-details').style = ''
            document.querySelector('.session-selection').style = 'display: none;'
            document.querySelector('#session-name').textContent = activeHost.tab_name
            document.querySelector('#session-started-at').innerHTML = new Date(activeHost.started_at).toLocaleString('fi-FI', {weekday: 'short', month: "numeric", day: "numeric", hour: "numeric", minute: "numeric"})
            document.querySelector('#session-total-host').innerHTML = currency(activeHost.total_host || 0)
            document.querySelector('#session-total-all').innerHTML = currency(activeHost.total_all || 0)
        } else {
            document.querySelector('.session-details').style = 'display: none;'
            document.querySelector('.session-selection').style = ''
            await fetchTabs()
        }
        document.querySelector('.session-panel').classList.remove('opening')
    }

    const closeSessionWindow = () => {
        document.querySelector('.session-panel').classList.add('closing')
        PiikkiBack.sync()
        setTimeout(() => {
            document.querySelector('.session-panel').classList.remove('active')
            document.querySelector('.session-panel').classList.remove('closing')
            document.querySelectorAll('#session-tab-list .selected').forEach((x) => x.classList.remove('selected'))
            document.querySelector('#session-confirm').classList.add('disabled')
            document.querySelector('#session-confirm').classList.remove('ok')
            document.querySelector('#session-end').classList.remove('ok')
            document.querySelectorAll('.session-end-form input').forEach(input => input.classList.remove('error'));
        }, 200)

    }

    const confirmSession = async () => {
        const tab = document.querySelector('#session-tab-list .selected')
        if(tab === null) return
        const tabId = parseInt(tab.dataset.id)
        const tabName = tab.textContent
        document.querySelector('#session-confirm').classList.add('ok')

        if (PiikkiOffline.isOffline()) {
            const item = PiikkiOffline.makeSessionStartItem(tabId, tabName)
            PiikkiOffline.enqueue(item)
            PiikkiOffline.setCache('session', { id: item.id, tab: tabId, tab_name: tabName, started_at: new Date().toISOString(), ended_at: null, total_host: 0, total_all: 0 })
            closeSessionWindow()
            updateActiveSession()
            return
        }

        // Mint the client_uuid up front and send it with the online attempt so
        // that if the response is lost (e.g. the request times out client-side
        // while the slow Shelly call delays the server), the buffered replay
        // below carries the same id and dedupes against the session the server
        // may have already created — instead of tripping "active session exists".
        const clientUuid = crypto.randomUUID()
        const { offline, response } = await PiikkiOffline.apiFetch('../api/sessions/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() },
            body: JSON.stringify({ "tab": tabId, "client_uuid": clientUuid })
        })
        // A 403 here means the session expired (the request was rejected before
        // any DB write) — buffer the start exactly like an offline one and kick a
        // sync, which silently re-auths and replays it. No data lost, no popup.
        const lapsed = !offline && response && isAuthFailure(response)
        if (offline || lapsed) {
            const item = PiikkiOffline.makeSessionStartItem(tabId, tabName, clientUuid)
            PiikkiOffline.enqueue(item)
            PiikkiOffline.setCache('session', { id: item.id, tab: tabId, tab_name: tabName, started_at: new Date().toISOString(), ended_at: null, total_host: 0, total_all: 0 })
            if (lapsed) trySilentReauth()   // re-auth, then drain the queue (no CSRF race)
            // Render the host from the cached buffered session, not a server
            // fetch — the replay hasn't landed yet, so the server would still
            // report "no active session" and clobber the indicator.
            renderActiveSession(PiikkiOffline.getCache('session'))
            closeSessionWindow()
            return
        }
        if (!response.ok) {
            document.querySelector('#session-confirm').classList.remove('ok')
            PiikkiToast.show({ id: 'session-error', message: 'Hostauksen aloitus epäonnistui', variant: 'error', icon: 'error', duration: 4000 })
            closeSessionWindow()
            return
        }
        const startData = await response.json()
        if (startData.shelly_ok === false) {
            PiikkiToast.show({ id: 'shelly-error', message: 'Ei yhteyttä katkaisijaan. Kytke virta päälle jatkojohdosta.', variant: 'error', icon: 'error', duration: 8000 })
        }
        closeSessionWindow()
        updateActiveSession()
        fetchProducts()
    }

    const endSession = async () => {
        document.querySelectorAll('.session-end-form input').forEach(input => input.classList.remove('error'));
        const id = activeHost.id
        const peopleInput = document.querySelector('#session-people')
        const people = parseInt(peopleInput.value)
        const commentInput = document.querySelector('#session-comment')
        const comment = commentInput.value
        var errors = false
        if(isNaN(people) || people < 1 || people > 100) {
            peopleInput.classList.add('error')
            errors = true
        }
        if(comment.length > 100 || comment.length < 1) {
            commentInput.classList.add('error')
            errors = true
        }
        if(errors) return
        document.querySelector('#session-end').classList.add('ok')

        if (PiikkiOffline.isOffline()) {
            PiikkiOffline.enqueue(PiikkiOffline.makeSessionEndItem(id, null, people, comment))
            PiikkiOffline.setCache('session', { id: null })
            peopleInput.value = ''
            commentInput.value = ''
            updateActiveSession()
            closeSessionWindow()
            return
        }

        const { offline, response } = await PiikkiOffline.apiFetch(`../api/sessions/${id}/end/`, {
            method: 'POST',
            headers: { 'X-CSRFToken': await getCsrfToken(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ "people": people, "comment": comment })
        })
        // A 403 here means the session expired — buffer the end exactly like an
        // offline one and kick a sync to silently re-auth and replay it.
        const lapsed = !offline && response && isAuthFailure(response)
        if (offline || lapsed) {
            PiikkiOffline.enqueue(PiikkiOffline.makeSessionEndItem(id, null, people, comment))
            PiikkiOffline.setCache('session', { id: null })
            peopleInput.value = ''
            commentInput.value = ''
            if (lapsed) trySilentReauth()   // re-auth, then drain the queue (no CSRF race)
            // Render "no host" from cache, not a server fetch — the end replay
            // hasn't landed, so the server would still report the session active.
            renderActiveSession(PiikkiOffline.getCache('session'))
            closeSessionWindow()
            return
        }
        if(response.ok) {
            const endData = await response.json()
            if (endData.shelly_ok === true) {
                PiikkiToast.show({ id: 'shelly-success', message: 'Hostaus lopetettu. Automaattinen virrankatkaisu 60s kuluttua.', variant: 'success', icon: 'success', duration: 8000 })
            } else if (endData.shelly_ok === false) {
                PiikkiToast.show({ id: 'shelly-error', message: 'Ei yhteyttä katkaisijaan. Katkaise virta jatkojohdosta.', variant: 'error', icon: 'error', duration: 8000 })
            }
            peopleInput.value = ''
            commentInput.value = ''
            updateActiveSession()
            fetchProducts()
            closeSessionWindow()
        } else {
            document.querySelector('#session-end').classList.remove('ok')
            PiikkiToast.show({ id: 'session-error', message: 'Hostauksen lopetus epäonnistui', variant: 'error', icon: 'error', duration: 4000 })
        }
    }


    document.querySelector('#session-confirm').addEventListener('click', confirmSession)
    document.querySelector('#session-end').addEventListener('click', endSession)

    document.querySelectorAll('.session-panel .close, .session-panel').forEach((x) => x.addEventListener('click', (e) => {
        if(e.target !== e.currentTarget) return
        closeSessionWindow()
    }))
    document.querySelector('#session-info').addEventListener('click', (e) => {
        e.preventDefault()
        openSessionWindow()
    })

    // Statistics panel functions
    const openStatisticsWindow = async (allowReauth = true) => {
        document.querySelector('.statistics-panel').classList.add('active')
        document.querySelector('.statistics-panel').classList.add('opening')
        PiikkiBack.sync()
        document.querySelector('.statistics-list-view').style = ''
        document.querySelector('.statistics-detail-view').style = 'display: none;'

        let tabs
        if (PiikkiOffline.isOffline()) {
            tabs = Object.values(tabsById).sort((a, b) => a.name.localeCompare(b.name))
        } else {
            const { offline, response } = await PiikkiOffline.apiFetch('../api/tabs/all/')
            if (offline) {
                tabs = Object.values(tabsById).sort((a, b) => a.name.localeCompare(b.name))
            } else if (!response.ok) {
                if (await recoverFromFailure(response, allowReauth ? () => openStatisticsWindow(false) : null)) return true
                closeStatisticsWindow()
                return false
            } else {
                tabs = await response.json()
            }
        }

        const container = document.querySelector('.statistics-tabs')
        const titleHtml = container.querySelector('h2')
        container.innerHTML = ''
        if (titleHtml) container.appendChild(titleHtml)
        else { const h = document.createElement('h2'); h.textContent = 'Kaikki piikit'; container.appendChild(h) }

        tabs.forEach((tab) => {
            const element = document.createElement('div')
            element.dataset.id = tab.id
            if(!tab.active) element.classList.add('inactive')

            const balanceClass = tab.balance > 0 ? 'positive' : (tab.balance < 0 ? 'negative' : '')
            const nameSpan = document.createElement('span')
            nameSpan.className = 'tab-name'
            nameSpan.textContent = tab.name
            const balSpan = document.createElement('span')
            balSpan.className = `tab-balance ${balanceClass}`
            balSpan.textContent = currency(tab.balance)
            element.append(nameSpan, balSpan)
            element.addEventListener('click', () => {
                if (PiikkiOffline.isOffline()) {
                    PiikkiToast.show({ id: 'offline-detail', message: 'Piikkitiedot eivät ole käytettävissä ilman yheyttä', variant: 'error', icon: 'error', duration: 4000 })
                    return
                }
                document.querySelectorAll('.statistics-tabs > div').forEach(el => el.classList.remove('selected'))
                element.classList.add('selected')
                openTabDetail(tab.id)
            })
            container.appendChild(element)
        })

        document.querySelector('.statistics-panel').classList.remove('opening')
        return true
    }

    const openTabDetail = async (tabId, allowReauth = true) => {
        const { offline, response } = await PiikkiOffline.apiFetch(`../api/tabs/${tabId}/`)
        if (offline || !response.ok) {
            if (!offline) return recoverFromFailure(response, allowReauth ? () => openTabDetail(tabId, false) : null)
            return false
        }
        const tab = await response.json()

        document.querySelector('#statistics-tab-name').textContent = tab.name
        document.querySelector('#statistics-tab-status').innerHTML = tab.active
        ? '<span class="active-status">Käytössä</span>'
        : '<span class="inactive-status">Poistettu käytöstä</span>'
        document.querySelector('#statistics-tab-balance').innerHTML = currency(tab.balance)

        // Update tab adjustment info
        const tabAdjustmentElement = document.querySelector('#statistics-tab-adjustment')
        if(tab.latest_tab_adjustment) {
            const tabAdjustmentDate = humanizeTime(tab.latest_tab_adjustment.created_at)
            tabAdjustmentElement.innerHTML = `Viimeisin suoritus: ${tabAdjustmentDate}`
        } else {
            tabAdjustmentElement.innerHTML = 'Ei suorituksia'
        }

        // PIN-required toggle: only shown for tabs that have a PIN set. The
        // server never sends the PIN itself, just whether one exists.
        closeStatisticsPinPad()
        const pinControl = document.querySelector('#statistics-pin-control')
        if(tab.has_pin) {
            statisticsPinTab = {
                id: tab.id,
                pin_required: !!tab.pin_required,
                pin_attempts: tab.pin_attempts || 0,
                pin_locked: !!tab.pin_locked
            }
            document.querySelector('#statistics-pin-required').checked = statisticsPinTab.pin_required
            const note = document.querySelector('#statistics-pin-lockout-note')
            if(tab.pin_lockout_threshold) {
                note.innerHTML = `Piikki lukittuu ${tab.pin_lockout_threshold} peräkkäisen väärän yrityksen jälkeen.`
                note.style.display = ''
            } else {
                note.innerHTML = ''
                note.style.display = 'none'
            }
            pinControl.style.display = ''
        } else {
            statisticsPinTab = null
            pinControl.style.display = 'none'
        }

        const purchasesContainer = document.querySelector('.statistics-purchases')
        purchasesContainer.innerHTML = ''

        if(tab.purchases && tab.purchases.length > 0) {
            tab.purchases.forEach((purchase) => {
                const element = document.createElement('div')
                const date = new Date(purchase.created_at).toLocaleString('fi-FI', {
                    day: 'numeric',
                    month: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: 'numeric'
                })
                const infoDiv = document.createElement('div')
                infoDiv.className = 'purchase-info'
                const productSpan = document.createElement('span')
                productSpan.className = 'purchase-product'
                productSpan.textContent = `${purchase.quantity}x ${purchase.product_name || 'tuote'}`
                const dateSpan = document.createElement('span')
                dateSpan.className = 'purchase-date'
                dateSpan.textContent = date
                infoDiv.append(productSpan, dateSpan)
                const totalSpan = document.createElement('span')
                totalSpan.className = 'purchase-total'
                totalSpan.textContent = currency(purchase.total)
                element.append(infoDiv, totalSpan)
                purchasesContainer.appendChild(element)
            })
        } else {
            purchasesContainer.innerHTML = '<div class="no-purchases">Ei ostoksia viimeisen viikon aikana</div>'
        }

        document.querySelector('.statistics-list-view').style = 'display: none;'
        document.querySelector('.statistics-detail-view').style = ''

        // Remove loading highlight from all tabs
        document.querySelectorAll('.statistics-tabs > div').forEach(el => el.classList.remove('selected'))
    }

    // Open the PIN keypad over the statistics window to confirm flipping the
    // PIN-required setting. `desired` is the value to apply once the PIN checks
    // out. The toggle itself stays at its current (unchanged) state until then.
    const openStatisticsPinPad = (desired) => {
        if(!statisticsPinTab) return
        statisticsDesiredPinRequired = desired
        statisticsEnteredPin = ''
        renderPinCard(document.querySelector('#statistics-pinpad'), statisticsPinTab, statisticsPinKeyPressed)
        document.querySelector('#statistics-pin-overlay').classList.add('active')
    }

    const closeStatisticsPinPad = () => {
        document.querySelector('#statistics-pin-overlay').classList.remove('active')
        statisticsEnteredPin = ''
        // Restore the toggle to the tab's actual (unchanged) state.
        document.querySelector('#statistics-pin-required').checked =
            statisticsPinTab ? !!statisticsPinTab.pin_required : false
    }

    const statisticsPinKeyPressed = (key) => {
        if(key === 'cancel') {
            closeStatisticsPinPad()
            return
        }
        if(!statisticsPinTab || statisticsPinTab.pin_locked) return
        if(key === 'backspace') {
            statisticsEnteredPin = statisticsEnteredPin.slice(0, -1)
        } else if(statisticsEnteredPin.length < 6) {
            statisticsEnteredPin += key
        }
        document.querySelectorAll('#statistics-pinpad .pin-dot').forEach((dot, index) => {
            if(index < statisticsEnteredPin.length) {
                dot.classList.add('filled')
            } else {
                dot.classList.remove('filled')
            }
        })
        if(statisticsEnteredPin.length === 6) {
            document.querySelectorAll('#statistics-pinpad .pin-key').forEach(btn => btn.disabled = true)
            submitStatisticsPin(statisticsEnteredPin)
        }
    }

    // Send the entered PIN + desired setting to the server. On success the
    // toggle reflects the new value; otherwise the same wrong-attempt / locked
    // feedback as the checkout keypad is shown.
    const submitStatisticsPin = async (pin, allowReauth = true) => {
        const tab = statisticsPinTab
        if(!tab) return
        let response
        try {
            const token = await getCsrfToken()
            response = await fetch(`../api/tabs/${tab.id}/set_pin_required/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': token
                },
                body: JSON.stringify({ pin: pin, pin_required: statisticsDesiredPinRequired })
            })
        } catch (e) {
            statisticsEnteredPin = ''
            document.querySelectorAll('#statistics-pinpad .pin-dot').forEach(dot => dot.classList.remove('filled'))
            document.querySelectorAll('#statistics-pinpad .pin-key').forEach(btn => btn.disabled = false)
            PiikkiToast.show({ id: 'pin-error', message: 'Yhteys palvelimeen epäonnistui', variant: 'error', icon: 'error', duration: 4000, dismissible: true })
            return
        }
        if(response.status === 200) {
            const updated = await response.json()
            tab.pin_required = !!updated.pin_required
            tab.pin_attempts = updated.pin_attempts || 0
            tab.pin_locked = !!updated.pin_locked
            closeStatisticsPinPad()
            return
        }
        const cls = await classifyMutation(response)
        if (cls.kind === 'auth') {
            if (allowReauth && await trySilentReauth()) {
                csrftoken = null
                return submitStatisticsPin(pin, false)
            }
            toLogin('Istunto vanhentunut — kirjaudu uudelleen')
            return
        }
        // 403: wrong pin or locked
        statisticsEnteredPin = ''
        applyPinError('#statistics-pinpad', tab, cls.body || {})
    }

    const closeStatisticsWindow = () => {
        closeStatisticsPinPad()
        statisticsPinTab = null
        document.querySelector('.statistics-panel').classList.add('closing')
        PiikkiBack.sync()
        setTimeout(() => {
            document.querySelector('.statistics-panel').classList.remove('active')
            document.querySelector('.statistics-panel').classList.remove('closing')
        }, 200)
    }

    const backToStatisticsList = () => {
        closeStatisticsPinPad()
        statisticsPinTab = null
        document.querySelector('.statistics-list-view').style = ''
        document.querySelector('.statistics-detail-view').style = 'display: none;'
    }

    document.querySelector('#statistics-button').addEventListener('click', () => {
        openStatisticsWindow()
    })
    document.querySelectorAll('.statistics-panel .close, .statistics-panel').forEach((x) => x.addEventListener('click', (e) => {
        if(e.target !== e.currentTarget) return
        closeStatisticsWindow()
    }))
    document.querySelector('.statistics-detail-header .back').addEventListener('click', backToStatisticsList)

    // Flipping the toggle doesn't apply immediately: it requires PIN confirmation.
    // Revert the visual state and open the keypad with the desired value.
    document.querySelector('#statistics-pin-required').addEventListener('change', (e) => {
        const desired = e.target.checked
        e.target.checked = statisticsPinTab ? !!statisticsPinTab.pin_required : false
        if(!statisticsPinTab) return
        openStatisticsPinPad(desired)
    })
    // Clicking the overlay backdrop (outside the card) cancels PIN entry.
    document.querySelector('#statistics-pin-overlay').addEventListener('click', (e) => {
        if(e.target !== e.currentTarget) return
        closeStatisticsPinPad()
    })


    document.querySelector('#confirmation .button').addEventListener('click', onConfirmClick)
    document.querySelector('.checkout-panel .back').addEventListener('click', handleBackButton)
    document.querySelector('#multi-tab-toggle').addEventListener('click', toggleMultiTabMode)

    document.querySelector('#login-form').addEventListener('submit', (e) => {
        e.preventDefault()
        handleLogin()
    })

    const updateMarker = (e) => {
        const pos = document.querySelector('.main-panel .product-column').scrollTop + 100
        const categoryPositions = Array.from(document.querySelectorAll('.category')).map(category => { return { id: category.id.split('-')[1], position: category.offsetTop } })
        const category = categoryPositions.filter(x => x.position <= pos)
        if(category.length > 0) {
            const result = category.pop().id
            const marker = document.querySelector('.navigation > div')
            const active = document.querySelector(`.navigation a[data-id="${result}"]`)
            marker.style = `top: ${active.offsetTop}px; height: ${active.offsetHeight}px`
        }
    }

    document.querySelector('.product-column').addEventListener('scroll', updateMarker)
    window.addEventListener('resize', updateMarker)

    document.querySelector('#offline-sync').addEventListener('click', async () => {
        const btn = document.querySelector('#offline-sync')
        btn.classList.add('disabled')
        btn.textContent = 'Synkronoidaan...'
        const result = await PiikkiOffline.sync()
        btn.classList.remove('disabled')
        btn.textContent = 'Yritä uudelleen'
        if (result.busy) return
        if (!result.ran) {
            PiikkiToast.show({
                id: 'sync-result',
                message: 'Ei yhteyttä palvelimeen',
                variant: 'error', icon: 'error', duration: 4000,
            })
            return
        }
        if (result.failed > 0) {
            PiikkiToast.show({
                id: 'sync-result',
                message: `Synkronointi: ${result.ok} onnistui, ${result.failed} epäonnistui`,
                variant: 'error', icon: 'error', duration: 4000,
            })
        } else if (result.ok > 0) {
            PiikkiToast.show({
                id: 'sync-result',
                message: `${result.ok} ${result.ok === 1 ? 'toiminto' : 'toimintoa'} synkronoitu`,
                variant: 'success', icon: 'success', duration: 4000,
            })
        }
        if (PiikkiOffline.getQueueSize() === 0 && !PiikkiOffline.isOffline()) {
            fetchProducts()
            fetchTabs()
            updateActiveSession()
        }
    })

    // --- Android / browser back button support ---
    // The hardware "back" should peel off whatever overlay sits on top (the PIN
    // pad, the statistics detail view, a panel, or the checkout view) instead of
    // leaving the app, and only exit once the bare home view is reached. We keep
    // the history primed with a single dummy entry whenever any overlay is open,
    // so a back press fires `popstate` (intercepted here) rather than unloading
    // the page; on the home view nothing is primed, so back exits as usual.
    const PiikkiBack = (() => {
        const isActive = (sel) => {
            const el = document.querySelector(sel)
            // A panel mid-close still carries `active` but also `closing`; treat
            // it as already gone so the priming logic stays in sync.
            return !!el && el.classList.contains('active') && !el.classList.contains('closing')
        }
        const statisticsDetailOpen = () =>
            isActive('.statistics-panel') &&
            document.querySelector('.statistics-detail-view').style.display !== 'none'

        // Topmost layer first — each close() peels exactly one level.
        const layers = [
            { open: () => document.querySelector('#statistics-pin-overlay').classList.contains('active'),
              close: () => closeStatisticsPinPad() },
            { open: statisticsDetailOpen, close: () => backToStatisticsList() },
            { open: () => isActive('.statistics-panel'), close: () => closeStatisticsWindow() },
            { open: () => isActive('.session-panel'), close: () => closeSessionWindow() },
            { open: () => isActive('.checkout-panel'), close: () => handleBackButton() },
        ]

        const anyOpen = () => layers.some(l => l.open())
        const isPrimed = () => !!(history.state && history.state.piikkiOverlay)
        const prime = () => { if (!isPrimed()) history.pushState({ piikkiOverlay: true }, '') }

        // Keep the dummy entry in lockstep with overlay visibility. Called after
        // every overlay open/close: pushes a dummy when one appears, and consumes
        // a now-stale dummy (so a later home-screen back exits on the first press)
        // when the last overlay is dismissed via the on-screen UI instead of back.
        const sync = () => {
            if (anyOpen()) prime()
            else if (isPrimed()) history.back()
        }

        window.addEventListener('popstate', () => {
            const layer = layers.find(l => l.open())
            if (layer) layer.close()
            // Re-prime while anything is still open — a nested layer, or a close
            // that no-op'd behind the checkout `busy` guard. Otherwise we're back
            // on the home view and the press falls through to exit the app.
            if (anyOpen()) prime()
        })

        return { sync }
    })()

    PiikkiOffline.init({
        onOfflineChange: (isOff) => {
            if (!isOff) {
                fetchProducts()
                fetchTabs()
                updateActiveSession()
            }
        },
        onLoginNeeded: async () => {
            // A queued mutation hit an auth failure on sync. Try to recover the
            // session silently with stored credentials and re-drain the queue;
            // only fall back to the login dialog if that fails.
            if (await trySilentReauth()) {
                PiikkiOffline.sync({ retryFailed: true })
                return
            }
            toLogin('Istunto vanhentunut — kirjaudu uudelleen')
        },
    })

    enableQuickPayment()

    // Cold start: if offline but previously logged in, boot from cache
    if (PiikkiOffline.isOffline() || !navigator.onLine) {
        if (PiikkiOffline.wasLoggedIn()) {
            const cachedTabs = PiikkiOffline.getCache('tabs')
            const cachedProducts = PiikkiOffline.getCache('products')
            if (cachedTabs && cachedProducts) {
                PiikkiOffline.goOffline()
                const cachedConfig = PiikkiOffline.getCache('config')
                if (cachedConfig) appConfig = cachedConfig
                applyAppConfig()
                renderTabs(cachedTabs)
                renderProducts(cachedProducts)
                renderActiveSession(PiikkiOffline.getCache('session'))
                toMain()
            } else {
                toLogin()
            }
        } else {
            toLogin()
        }
    } else if(await fetchTabs()) {
        PiikkiOffline.setLoggedIn(true)
        await fetchConfig()
        await updateActiveSession()
        toMain()
    } else if (!document.querySelector('.login-panel').classList.contains('active')) {
        // Initial load couldn't reach the app and recoverFromFailure didn't
        // already raise the dialog (e.g. server/network error with nothing
        // cached). At a cold start, login is the only way forward.
        toLogin()
    }
})
