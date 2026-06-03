document.addEventListener("DOMContentLoaded", async () => {

    var checkoutProduct = null
    var checkoutTab = null
    var activeHost = null
    var busy = false
    var csrftoken = null

    const tabsById = {}
    var enteredPin = ''

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

    const checkResponse = (response) => {
        if(response.status !== 200) {
            return false
        }
        return true
    }

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
        return items
    }

    const getTab = () => {
        const tab = checkoutTab
        if(tab === null) {
            return null
        }
        return tab
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
        if(message) {
            document.querySelector('.login-panel p').innerHTML = message
        }
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

    // Click handler for the confirm button. For PIN-protected tabs the first
    // press reveals the keypad instead of completing the purchase.
    const onConfirmClick = () => {
        if(busy) return
        const button = document.querySelector('#confirmation .button')
        if(button.classList.contains('disabled')) return
        const tab = getTab()
        if(tab !== null && tab.pin_required) {
            revealPinpad(tab)
            return
        }
        confirmPurchase()
    }

    // POST a single purchase line item. PIN is included only when provided.
    const postPurchase = (item, pin, token, tab) => {
        const body = {
            "tab": tab.id,
            "quantity": item.quantity,
            "total": item.total,
            "product": checkoutProduct?.id,
        }
        if(item.price_type) body.price_type = item.price_type
        if(pin !== null) body.pin = pin
        return fetch('../api/purchases/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': token
            },
            body: JSON.stringify(body)
        })
    }

    const confirmPurchase = async () => {
        if(busy) return
        const items = getLineItems()
        const tab = getTab()
        if(items.length === 0 || tab === null) return
        busy = true
        const token = await getCsrfToken()
        const requests = items.map((item) => postPurchase(item, null, token, tab))
        document.querySelector('#confirmation').classList.add('ok')
        audio.play()
        setTimeout( async () => {
            const responses = await Promise.all(requests)
            if(responses.every(checkResponse)) {
                busy = false
                toMain()
            } else {
                busy = false
                document.querySelector('#confirmation').classList.remove('ok')
                const errorEl = document.querySelector('#purchase-error')
                document.querySelector('#purchase-error .purchase-error-msg').innerHTML = 'Oston kirjaaminen epäonnistui. Lataa sivu uudelleen ja yritä uudestaan.'
                errorEl.style.display = ''
                errorEl.classList.add('active')
            }
        }, 500)
    }

    const submitPinPurchase = async (pin) => {
        if(busy) return
        const items = getLineItems()
        const tab = getTab()
        if(items.length === 0 || tab === null) return
        const token = await getCsrfToken()
        // Send the items one at a time so a wrong PIN aborts before any purchase
        // is made (and the attempt counter is only bumped once).
        var response = null
        for(const item of items) {
            response = await postPurchase(item, pin, token, tab)
            if(response.status !== 200) break
        }
        if(response && response.status === 200) {
            busy = true
            document.querySelector('#confirmation').classList.add('ok')
            audio.play()
            setTimeout(() => {
                toMain()
            }, 500)
            return
        }
        // 403: wrong pin or locked
        var body = {}
        try {
            body = await response.json()
        } catch(e) {
            body = {}
        }
        enteredPin = ''
        document.querySelectorAll('#pinpad .pin-dot').forEach((dot) => dot.classList.remove('filled'))
        const attempts = body.pin_attempts || 0
        if(tab.pin_attempts !== undefined) tab.pin_attempts = attempts
        const attemptsElement = document.querySelector('#pinpad .pin-attempts')
        if(attemptsElement) {
            attemptsElement.innerHTML = attempts > 0 ? `Väärä PIN-koodi. Yrityksiä: ${attempts}` : ''
        }
        if(body.pin_locked) {
            if(tab.pin_locked !== undefined) tab.pin_locked = true
            const lockedElement = document.querySelector('#pinpad .pin-locked')
            if(lockedElement) lockedElement.classList.add('active')
            const card = document.querySelector('#pinpad .pin-card')
            if(card) card.classList.add('locked')
        }
        // The attempts / locked message changes the card height; re-anchor it
        // above the confirm button so it stays put.
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
        const tab = getTab()
        const button = document.querySelector('#confirmation .button')
        const confirmation = document.querySelector('#confirmation')
        if(items.length === 0 || tab === null) {
            div.innerHTML = ``
            button.classList.add('disabled')
        } else {
            div.innerHTML = `
                <div>${tab.name}</div>
                <div>←</div>
                <div>${currency(total)}</div>
            `
            button.classList.remove('disabled')
        }

        // The PIN keypad is only revealed by pressing the confirm button.
        // Any change to the tab or transaction hides it (and the "Syötä PIN"
        // overlay) again.
        confirmation.classList.remove('pin-mode')
        enteredPin = ''

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
        element.classList.add('selected')
        const f_price_out = currency(product.price_out)
        const f_price_in = currency(product.price_in)
        const fetchTabsPromise = fetchTabs()
        const descriptionElement = document.querySelector('#checkout-description')
        document.querySelector('#checkout-title').innerHTML = product.name
        if(product.note || product.description) {
            descriptionElement.innerHTML = `<h2>${product.note || ''}</h2><p>${product.description || ''}</p>`
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
        else if(product.price_in === product.price_out) {
            // Single price: one quantity input with the price shown beside it.
            options.innerHTML = quantityRowHtml('quantity-out', 'Määrä', f_price_out, 1)
        } else {
            // Separate in/out prices: a quantity input for each, both starting at 0.
            options.innerHTML = quantityRowHtml('quantity-in', 'Sisään', f_price_in, 0) +
                quantityRowHtml('quantity-out', 'Ulos', f_price_out, 0)
        }
        wireQuantityRows()
        updateConfirmation()
        await fetchTabsPromise
        document.querySelector('.main-panel').classList.remove('active')
        document.querySelector('.checkout-panel').classList.add('active')
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


    const toMain = () => {
        fetchProducts()
        document.querySelector('.main-panel').classList.add('active')
        document.querySelector('.checkout-panel').classList.remove('active')
        document.querySelectorAll('.product-column .selected, .quick-payment.selected').forEach((x) => x.classList.remove('selected'))
        setTimeout(() => {
            document.querySelector('#confirmation').classList.remove('ok')
            document.querySelector('#confirmation').classList.remove('pin-mode')
            const purchaseError = document.querySelector('#purchase-error')
            purchaseError.style.display = 'none'
            purchaseError.classList.remove('active')
            enteredPin = ''
            document.querySelector('.checkout-panel main').scroll(0, 0)
            document.querySelector('.checkout-panel .tab-list').scroll(0, 0)
            document.querySelector('.checkout-column .options').innerHTML = ''
            busy = false
        }, 250)
        checkoutProduct = null
        checkoutTab = null
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
        document.querySelectorAll('.checkout-panel .tab-list .tabs > div, .checkout-panel .tab-list .suggestions > div').forEach((x) => x.classList.remove('selected'))
        element.classList.add('selected')
        const id = parseInt(element.dataset.id)
        const tab = tabsById[id]
        checkoutTab = {
            "id": id,
            "name": element.innerHTML,
            "pin_required": tab ? !!tab.pin_required : false,
            "pin_attempts": tab ? (tab.pin_attempts || 0) : 0,
            "pin_locked": tab ? !!tab.pin_locked : false
        }
        updateConfirmation()
    }

    const selectSessionTab = (element) => {
        document.querySelectorAll('#session-tab-list .tabs > div, #session-tab-list .suggestions > div').forEach((x) => x.classList.remove('selected'))
        element.classList.add('selected')
        document.querySelector('#session-confirm').classList.remove('disabled')
    }

    const fetchTabs = async () => {

        const response = await fetch('../api/tabs/')
        if(!checkResponse(response)) {
            toLogin()
            return false
        }
        const tabs = await response.json()
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
            element.innerHTML = x.name
            document.querySelector('.checkout-panel .tab-list .tabs').appendChild(element)
            document.querySelector('#session-tab-list').appendChild(element.cloneNode(true))
            element.addEventListener('click', () => selectTab(element))
        })
        // Add most recently used (updated_at) tabs to suggestions
        tabs.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 6).forEach((x) => {
            const element = document.createElement('div')
            element.dataset.id = x.id
            element.innerHTML = x.name
            document.querySelector('.checkout-panel .tab-list .suggestions').appendChild(element)
            element.addEventListener('click', () => selectTab(element))
        })
        alphabet.split('').forEach((x) => {
            const element = document.createElement('div')
            if(Array.from(document.querySelectorAll('.checkout-panel .tab-list .tabs > div')).filter((y) => y.innerHTML[0].toUpperCase() === x).length === 0){
                element.classList.add('disabled')
            } else {
                element.addEventListener('click', () => {
                    // Find first tab with the correct letter and scroll into view
                    const matches = Array.from(document.querySelectorAll('.checkout-panel .tab-list .tabs > div')).filter((y) => y.innerHTML[0].toUpperCase() === x)
                    const first = matches[0]
                    if(first) first.scrollIntoView()
                    matches.forEach((y) => blink(y))
                })
            }
            element.innerHTML = x
            alphabetContainer.appendChild(element)
        })
        // Clone tab list to session window
        document.querySelector('#session-tab-list').innerHTML = document.querySelector('.checkout-panel .tab-list').innerHTML
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
        return true
    }

    const fetchProducts = async () => {
        const response = await fetch('../api/products/')
        if(!checkResponse(response)) {
            toLogin()
            return false
        }
        const products = await response.json()

        document.querySelector('.product-column').innerHTML = ''

        document.querySelector('.navigation').innerHTML = document.querySelector('.navigation').firstElementChild.outerHTML
        products.forEach(group => {
            if(group.products.filter((x) => x.in_stock).length === 0) return
            const div = document.createElement('div')
            div.id = `category-${group.id}`
            div.classList.add('category')
            const title = document.createElement('h2')
            title.innerHTML = group.name
            div.appendChild(title)

            const productsDiv = document.createElement('div')
            productsDiv.classList.add('products')
            div.appendChild(productsDiv)

            group.products.filter((x) => x.in_stock).sort((a, b) => a.name.localeCompare(b.name)).forEach(product => {
                const productDiv = document.createElement('div')
                productDiv.id = `product-${product.id}`
                const price = product.price_out === product.price_in ? `${product.price_out.replace(".",",")} €` : `${product.price_in.replace(".",",")} € / ${product.price_out.replace(".",",")} €`
                productDiv.innerHTML =
                `<h3>${product.name}</h3>
                <div><span class="note">${product.note || ''}</span><span class="price">${price}</span>`
                productsDiv.appendChild(productDiv)

                productDiv.addEventListener('click', () => {
                    toCheckout(product, productDiv)
                })
            })

            document.querySelector('.product-column').appendChild(div)
            const a = document.createElement('a')
            a.href = `#category-${group.id}`
            a.dataset.id = group.id
            a.innerHTML = group.name
            document.querySelector('.navigation').appendChild(a)
        })
        // Add footer to product list
        const footer = document.createElement('footer')
        footer.textContent = 'hifiPiikki — Simo Naatula — 2026'
        document.querySelector('.product-column').appendChild(footer)
        updateMarker()
        return true
    }

    const getCsrfToken = async () => {
        // Get token from ../api/csrf/ endpoint to use in requests as required by Django
        // Sort of unsafe, but it's fine for this project
        const response = await fetch('../api/csrf/', {
            method: 'GET'
        })

        if(response.status === 200) {
            const body = await response.text()
            const token = body.split('value="')[1].split('"')[0]
            return token
        }
        return null
    }


    const handleLogin = async () => {
        // Log in using Django SessionAuthentication
        const errorField = document.querySelector('.login-panel p')
        const username = document.querySelector('.login-panel input[name="username"]').value
        const password = document.querySelector('.login-panel input[name="password"]').value
        const formData = new FormData();
        formData.append('username', username);
        formData.append('password', password);

        const request = fetch('../api/auth/login/', {
            method: 'POST',
            headers: {
                'X-CSRFToken': await getCsrfToken()
            },
            body: formData
        }).then(async (response) => {
            if(await fetchProducts()) {
                errorField.innerHTML = ''
                document.querySelector('.login-panel').classList.remove('active')
                busy = false
                updateActiveSession()
                fetchTabs()
                toMain()
            } else {
                errorField.innerHTML = response.status == 200 ? 'Väärä käyttäjätunnus tai salasana?' : 'Palvelinvirhe?'
            }
        })
    }

    const updateActiveSession = async () => {
        const response = await fetch('../api/sessions/active/')
        if(!checkResponse(response)) {
            toLogin()
            return false
        }
        const session = await response.json()
        const container = document.querySelector('#session-info')
        if(session.id !== null) {
            container.innerHTML = `${session.tab_name}`
            container.classList.add('active')
            container.classList.remove('none')
            activeHost = session
        } else {
            container.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3"><path d="M480-120v-80h280v-560H480v-80h280q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H480Zm-80-160-55-58 102-102H120v-80h327L345-622l55-58 200 200-200 200Z"/></svg>`
            container.classList.add('none')
            container.classList.remove('active')
            activeHost = null
        }
        return true
    }

    const openSessionWindow = async () => {
        document.querySelector('.session-panel').classList.add('active')
        document.querySelector('.session-panel').classList.add('opening')
        document.querySelector('#session-tab-list').scroll(0, 0)
        if(activeHost !== null) {
            await updateActiveSession()
            document.querySelector('.session-details').style = ''
            document.querySelector('.session-selection').style = 'display: none;'
            document.querySelector('#session-name').innerHTML = activeHost.tab_name
            document.querySelector('#session-started-at').innerHTML = new Date(activeHost.started_at).toLocaleString('fi-FI', {weekday: 'short', month: "numeric", day: "numeric", hour: "numeric", minute: "numeric"})
            document.querySelector('#session-total-host').innerHTML = currency(activeHost.total_host)
            document.querySelector('#session-total-all').innerHTML = currency(activeHost.total_all)


        } else {
            document.querySelector('.session-details').style = 'display: none;'
            document.querySelector('.session-selection').style = ''
            await fetchTabs()
        }
        document.querySelector('.session-panel').classList.remove('opening')
    }

    const closeSessionWindow = () => {
        document.querySelector('.session-panel').classList.add('closing')
        setTimeout(() => {
            document.querySelector('.session-panel').classList.remove('active')
            document.querySelector('.session-panel').classList.remove('closing')
            document.querySelectorAll('#session-tab-list .selected').forEach((x) => x.classList.remove('selected'))
            document.querySelector('#session-confirm').classList.add('disabled')
            document.querySelectorAll('.session-end-form input').forEach(input => input.classList.remove('error'));
        }, 200)

    }

    const confirmSession = async () => {
        const tab = document.querySelector('#session-tab-list .selected')
        if(tab === null) return
        const response = await fetch('../api/sessions/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': await getCsrfToken()
            },
            body: JSON.stringify({
                "tab": parseInt(tab.dataset.id)
            })
        })
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

        const response = await fetch(`../api/sessions/${id}/end/`, {
            method: 'POST',
            headers: {
                'X-CSRFToken': await getCsrfToken(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                "people": people,
                "comment": comment
            })
        })
        if(checkResponse(response)) {
            peopleInput.value = ''
            commentInput.value = ''
            updateActiveSession()
            fetchProducts()
            closeSessionWindow()
        }
    }


    document.querySelector('#session-confirm').addEventListener('click', confirmSession)
    document.querySelector('#session-end').addEventListener('click', endSession)

    document.querySelectorAll('.session-panel .close, .session-panel').forEach((x) => x.addEventListener('click', (e) => {
        if(e.target !== e.currentTarget) return
        closeSessionWindow()
    }))
    document.querySelector('#session-info').addEventListener('click', openSessionWindow)

    // Statistics panel functions
    const openStatisticsWindow = async () => {
        document.querySelector('.statistics-panel').classList.add('active')
        document.querySelector('.statistics-panel').classList.add('opening')
        document.querySelector('.statistics-list-view').style = ''
        document.querySelector('.statistics-detail-view').style = 'display: none;'

        // Fetch all tabs
        const response = await fetch('../api/tabs/all/')
        if(!checkResponse(response)) {
            toLogin()
            return
        }
        const tabs = await response.json()

        const container = document.querySelector('.statistics-tabs')
        container.innerHTML = ''

        tabs.forEach((tab) => {
            const element = document.createElement('div')
            element.dataset.id = tab.id
            if(!tab.active) element.classList.add('inactive')

            const balanceClass = tab.balance > 0 ? 'positive' : (tab.balance < 0 ? 'negative' : '')
            element.innerHTML = `
                <span class="tab-name">${tab.name}</span>
                <span class="tab-balance ${balanceClass}">${currency(tab.balance)}</span>
            `
            element.addEventListener('click', () => {
                // Add loading highlight
                document.querySelectorAll('.statistics-tabs > div').forEach(el => el.classList.remove('selected'))
                element.classList.add('selected')
                openTabDetail(tab.id)
            })
            container.appendChild(element)
        })

        document.querySelector('.statistics-panel').classList.remove('opening')
    }

    const openTabDetail = async (tabId) => {
        const response = await fetch(`../api/tabs/${tabId}/`)
        if(!checkResponse(response)) {
            toLogin()
            return
        }
        const tab = await response.json()

        document.querySelector('#statistics-tab-name').innerHTML = tab.name
        document.querySelector('#statistics-tab-status').innerHTML = tab.active
        ? '<span class="active-status">Aktiivinen</span>'
        : '<span class="inactive-status">Ei aktiivinen</span>'
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
                element.innerHTML = `
                    <div class="purchase-info">
                        <span class="purchase-product">${purchase.quantity}x ${purchase.product_name || 'tuote'}</span>
                        <span class="purchase-date">${date}</span>
                    </div>
                    <span class="purchase-total">${currency(purchase.total)}</span>
                `
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
            submitStatisticsPin(statisticsEnteredPin)
        }
    }

    // Send the entered PIN + desired setting to the server. On success the
    // toggle reflects the new value; otherwise the same wrong-attempt / locked
    // feedback as the checkout keypad is shown.
    const submitStatisticsPin = async (pin) => {
        const tab = statisticsPinTab
        if(!tab) return
        const token = await getCsrfToken()
        const response = await fetch(`../api/tabs/${tab.id}/set_pin_required/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': token
            },
            body: JSON.stringify({ pin: pin, pin_required: statisticsDesiredPinRequired })
        })
        if(response.status === 200) {
            const updated = await response.json()
            tab.pin_required = !!updated.pin_required
            tab.pin_attempts = updated.pin_attempts || 0
            tab.pin_locked = !!updated.pin_locked
            closeStatisticsPinPad()
            return
        }
        // 403: wrong pin or locked
        var body = {}
        try {
            body = await response.json()
        } catch(e) {
            body = {}
        }
        statisticsEnteredPin = ''
        document.querySelectorAll('#statistics-pinpad .pin-dot').forEach((dot) => dot.classList.remove('filled'))
        const attempts = body.pin_attempts || 0
        tab.pin_attempts = attempts
        const attemptsElement = document.querySelector('#statistics-pinpad .pin-attempts')
        if(attemptsElement) {
            attemptsElement.innerHTML = attempts > 0 ? `Väärä PIN-koodi. Yrityksiä: ${attempts}` : ''
        }
        if(body.pin_locked) {
            tab.pin_locked = true
            const lockedElement = document.querySelector('#statistics-pinpad .pin-locked')
            if(lockedElement) lockedElement.classList.add('active')
            const card = document.querySelector('#statistics-pinpad .pin-card')
            if(card) card.classList.add('locked')
        }
    }

    const closeStatisticsWindow = () => {
        closeStatisticsPinPad()
        statisticsPinTab = null
        document.querySelector('.statistics-panel').classList.add('closing')
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

    document.querySelector('#statistics-button').addEventListener('click', openStatisticsWindow)
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

    document.querySelector('#login').addEventListener('click', handleLogin)

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

    enableQuickPayment()
    if(await fetchTabs()) {
        await updateActiveSession()
        toMain()
    }
})
