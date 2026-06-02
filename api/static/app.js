document.addEventListener("DOMContentLoaded", async () => {

    var checkoutProduct = null
    var checkoutTab = null
    var activeHost = null
    var busy = false
    var previousQuantity = 1
    var csrftoken = null

    const tabsById = {}
    var enteredPin = ''

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
        if (diffInWeeks < 4) {
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

    const getPrice = () => {
        if(document.querySelector('#custom-price')) {
            const value = parseFloat(document.querySelector('#custom-price').value.replace(',','.'))
            if(isNaN(value) || value <= 0 || value >= 1000) {
                return null
            }
            return value
        } else if(document.querySelector('input[name="price"]:checked')?.value === 'in') {
            return checkoutProduct.price_in
        } else if(document.querySelector('input[name="price"]:checked')?.value === 'out' ||
        document.querySelector('#single-price')) {
            return checkoutProduct.price_out
        }
        return null
    }

    const getTab = () => {
        const tab = checkoutTab
        if(tab === null) {
            return null
        }
        return tab
    }

    const getQuantity = () => {
        const quantity = parseInt(parseFloat(document.querySelector('#quantity').value) * 100) / 100
        if(isNaN(quantity) || quantity <= 0 || quantity >= 100) {
            return 1
        }
        return quantity
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
    }

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

    const confirmPurchase = async () => {
        if(busy) return
        const quantity = getQuantity()
        var price = getPrice()
        const total = (quantity * price).toFixed(2)
        const tab = getTab()
        if(price === null || quantity === null || isNaN(total) || tab === null) return
        busy = true
        const request = fetch('../api/purchases/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': await getCsrfToken()
            },
            body: JSON.stringify({
                "tab": tab.id,
                "quantity": quantity,
                "total": total,
                "product": checkoutProduct?.id,
            })
        })
        document.querySelector('#confirmation').classList.add('ok')
        audio.play()
        setTimeout( async () => {
            const response = await request
            if(checkResponse(response)) {
                busy = false
                toMain()
            } else {
                toLogin('Osto epäonnistui. Kirjaudu uudelleen sisään ja yritä uudelleen.')
            }
        }, 500)
    }

    const submitPinPurchase = async (pin) => {
        if(busy) return
        const quantity = getQuantity()
        var price = getPrice()
        const total = (quantity * price).toFixed(2)
        const tab = getTab()
        if(price === null || quantity === null || isNaN(total) || tab === null) return
        const response = await fetch('../api/purchases/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': await getCsrfToken()
            },
            body: JSON.stringify({
                "tab": tab.id,
                "quantity": quantity,
                "total": total,
                "product": checkoutProduct?.id,
                "pin": pin
            })
        })
        if(response.status === 200) {
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

    const renderPinpad = (tab) => {
        var pinpad = document.querySelector('#pinpad')
        if(!pinpad) {
            pinpad = document.createElement('div')
            pinpad.id = 'pinpad'
            document.querySelector('#confirmation').appendChild(pinpad)
        }
        enteredPin = ''

        const attempts = tab.pin_attempts || 0
        const attemptsText = attempts > 0 ? `Väärä PIN-koodi. Yrityksiä: ${attempts}` : ''

        const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'backspace', '0', 'cancel']
        const keysHtml = keys.map((key) => {
            if(key === 'backspace') {
                return `<button class="pin-key backspace" data-digit="backspace">⌫</button>`
            }
            if(key === 'cancel') {
                return `<button class="pin-key cancel" data-digit="cancel">✕</button>`
            }
            return `<button class="pin-key" data-digit="${key}">${key}</button>`
        }).join('')

        pinpad.innerHTML = `
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
                <div class="pin-keys">${keysHtml}</div>
            </div>
        `

        pinpad.querySelectorAll('.pin-key[data-digit]').forEach((button) => {
            button.addEventListener('click', () => pinKeyPressed(button.dataset.digit))
        })
    }

    const updateConfirmation = () => {
        if(busy) return
        const quantity = getQuantity()
        var price = getPrice()
        const total = (quantity * price).toFixed(2)
        const div = document.querySelector('#confirmation .summary')
        const tab = getTab()
        const button = document.querySelector('#confirmation .button')
        const confirmation = document.querySelector('#confirmation')
        if(price === null || tab === null) {
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

    const changeQuantity = (difference) => {
        const quantity = document.querySelector('#quantity')
        const newQuantity = Math.round(getQuantity() + difference)
        quantity.value = newQuantity
        formatQuantity().then(updateConfirmation)
    }

    const formatQuantity = async () =>{
        const input = document.querySelector('#quantity')
        const quantity = input.value.replace(',','.')
        input.value = quantity ? `${parseInt(parseFloat(quantity) * 100) / 100}` : previousQuantity
        if(input.value >= 100 || input.value <= 0 || isNaN(input.value.replace(',','.'))) {
            input.value = previousQuantity
        }
        previousQuantity = input.value
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

        document.querySelector('#checkout-quantity').style = ''
        const priceContainer = document.querySelector('#checkout-price')
        if(product.id === null) {
            // Display custom price input
            priceContainer.innerHTML = `<h2>Summa</h2><input type="text" id="custom-price" placeholder="0,00" step="0.01"><span style="font-size: 1.5rem">€</span>`
            document.querySelector('input#custom-price').addEventListener('input', updateConfirmation)
            // Hide quantity input
            document.querySelector('#checkout-quantity').style = 'display: none'
        }
        else if(product.price_in === product.price_out) {
            priceContainer.innerHTML = `<h2>Hinta</h2><span id="single-price">${f_price_out}</span>`
        } else {
            priceContainer.innerHTML = `<h2>Hinta</h2>
            <div id="price-choice">
                <input type="radio" name="price" id="in" value="in">
                <label for="in" class="radio-custom btn btn-white">
                    sisään ${f_price_in}
                </label>

                <input type="radio" name="price" id="out" value="out">
                <label for="out" class="radio-custom btn btn-white">
                    ulos ${f_price_out}
                </label>
            </div>`
        }

        document.querySelectorAll('input[type="radio"]').forEach(() => {
        addEventListener('change', updateConfirmation)
        })
        document.querySelector('#quantity').value = 1
        previousQuantity = 1
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
            enteredPin = ''
            document.querySelector('.checkout-panel main').scroll(0, 0)
            document.querySelector('.checkout-panel .tab-list').scroll(0, 0)
            document.querySelector('#checkout-price').innerHTML = ''
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

    const closeStatisticsWindow = () => {
        document.querySelector('.statistics-panel').classList.add('closing')
        setTimeout(() => {
            document.querySelector('.statistics-panel').classList.remove('active')
            document.querySelector('.statistics-panel').classList.remove('closing')
        }, 200)
    }

    const backToStatisticsList = () => {
        document.querySelector('.statistics-list-view').style = ''
        document.querySelector('.statistics-detail-view').style = 'display: none;'
    }

    document.querySelector('#statistics-button').addEventListener('click', openStatisticsWindow)
    document.querySelectorAll('.statistics-panel .close, .statistics-panel').forEach((x) => x.addEventListener('click', (e) => {
        if(e.target !== e.currentTarget) return
        closeStatisticsWindow()
    }))
    document.querySelector('.statistics-detail-header .back').addEventListener('click', backToStatisticsList)


    document.querySelector('#confirmation .button').addEventListener('click', onConfirmClick)
    document.querySelector('.checkout-panel .back').addEventListener('click', handleBackButton)

    document.querySelector('#quantity').addEventListener('change', formatQuantity)
    document.querySelector('#quantity').addEventListener('input', updateConfirmation)


    document.querySelector('#increase').addEventListener('click', () => {
        changeQuantity(1)
    })

    document.querySelector('#decrease').addEventListener('click', () => {
        changeQuantity(-1)
    })

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

