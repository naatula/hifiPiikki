document.addEventListener("DOMContentLoaded", async () => {
    
    var checkoutProduct = null
    var checkoutTab = null
    var activeHost = null
    var busy = false
    var previousQuantity = 1
    var csrftoken = null

    const audio = new Audio('purchase.m4a')

    
    const currency = (n) => {
        return parseFloat(n).toFixed(2).replace('.',',') + ' €'
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
        const quantity = parseInt(parseFloat(document.querySelector('#quantity').value.replace(',','.')) * 100) / 100
        if (isNaN(quantity) || quantity <= 0 || quantity >= 100) {
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

    const confirmPurchase = async () => {
        if(busy) return
        const quantity = getQuantity()
        var price = getPrice()
        const total = (quantity * price).toFixed(2)
        const tab = getTab()
        if(price === null || quantity === null || isNaN(total) || tab === null) return
        busy = true
        const request = fetch('/api/purchases/', {
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
        }, 2000)
    }

    const updateConfirmation = () => {
        if(busy) return
        const quantity = getQuantity()
        var price = getPrice()
        const total = (quantity * price).toFixed(2)
        const div = document.querySelector('#confirmation .summary')
        const tab = getTab()
        const button = document.querySelector('#confirmation .button')
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
        input.value = quantity ? `${parseInt(parseFloat(quantity) * 100) / 100}`.replace('.',',') : previousQuantity
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

        setTimeout(async () => {
            await fetchTabsPromise
            document.querySelector('.main-panel').classList.remove('active')
            document.querySelector('.checkout-panel').classList.add('active')
        }, 100)
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
        checkoutTab = {"id": parseInt(element.dataset.id), "name": element.innerHTML}
        updateConfirmation()
    }

    const selectHostingTab = (element) => {
        document.querySelectorAll('#hosting-tab-list .tabs > div, #hosting-tab-list .suggestions > div').forEach((x) => x.classList.remove('selected'))
        element.classList.add('selected')
        document.querySelector('#hosting-confirm').classList.remove('disabled')
    }

    const fetchTabs = async () => {

        const response = await fetch('/api/tabs/')
        if(!checkResponse(response)) {
            toLogin()
            return false
        }
        const tabs = await response.json()
        const alphabetContainer = document.querySelector('.checkout-panel .alphabet')
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZÅÄÖ"

        alphabetContainer.innerHTML = ''
        document.querySelector('.checkout-panel .tab-list .tabs').innerHTML = ''
        document.querySelector('.checkout-panel .tab-list .suggestions').innerHTML = ''

        tabs.forEach((x) => {
            const element = document.createElement('div')
            element.dataset.id = x.id
            element.innerHTML = x.name
            document.querySelector('.checkout-panel .tab-list .tabs').appendChild(element)
            document.querySelector('#hosting-tab-list').appendChild(element.cloneNode(true))
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
        // Clone tab list to hosting window
        document.querySelector('#hosting-tab-list').innerHTML = document.querySelector('.checkout-panel .tab-list').innerHTML
        document.querySelectorAll('#hosting-tab-list .suggestions > div, #hosting-tab-list .tabs > div').forEach((x) => {
            x.addEventListener('click', () => selectHostingTab(x))
        })
        document.querySelectorAll('#hosting-tab-list .alphabet > div').forEach((x) => {
            x.addEventListener('click', (element) => {
                const matches = Array.from(document.querySelectorAll('#hosting-tab-list .tabs > div')).filter((y) => y.innerHTML[0].toUpperCase() === x.innerHTML)
                const first = matches[0]
                if(first) first.scrollIntoView()
                matches.forEach((y) => blink(y))
            })
        })
        return true
    }

    const fetchProducts = async () => {
        const response = await fetch('/api/products/')
        if(!checkResponse(response)) {
            toLogin()
            return false
        }
        const products = await response.json()

        document.querySelector('.product-column').innerHTML = ''

        document.querySelector('.navigation').innerHTML = ''
        document.querySelector('.navigation').appendChild(document.createElement('div'))
        products.forEach(group => {
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
        updateMarker()
        return true
    }

    const getCsrfToken = async () => {
        // Get token from /api/csrf/ endpoint to use in requests as required by Django
        // Sort of unsafe, but it's fine for this project
        const response = await fetch('/api/csrf/', {
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

        const request = fetch('/api/auth/login/', {
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
                updateActiveHosting()
                fetchTabs()
                toMain()
            } else {
                errorField.innerHTML = response.status == 200 ? 'Väärä käyttäjätunnus tai salasana?' : 'Palvelinvirhe?'
            }
        })
    }

    const updateActiveHosting = async () => {
        const response = await fetch('/api/hostings/active/')
        if(!checkResponse(response)) {
            toLogin()
            return false
        }
        const hosting = await response.json()
        const container = document.querySelector('#hosting-info')
        if(hosting.id !== null) {
            container.innerHTML = `${hosting.tab_name}`
            container.classList.add('active')
            container.classList.remove('none')
            activeHost = hosting
        } else {
            container.innerHTML = 'Aloita hostaus'
            container.classList.add('none')
            container.classList.remove('active')
            activeHost = null
        }
        return true
    }

    const openHostingWindow = async () => {
        document.querySelector('.hosting-panel').classList.add('active')
        document.querySelector('.hosting-panel').classList.add('opening')
        document.querySelector('#hosting-tab-list').scroll(0, 0)
        if(activeHost !== null) {
            await updateActiveHosting()
            document.querySelector('.hosting-details').style = ''
            document.querySelector('.hosting-selection').style = 'display: none;'
            document.querySelector('#hosting-name').innerHTML = activeHost.tab_name
            document.querySelector('#hosting-started-at').innerHTML = new Date(activeHost.started_at).toLocaleString('fi-FI', {weekday: 'short', month: "numeric", day: "numeric", hour: "numeric", minute: "numeric"})
            document.querySelector('#hosting-total-host').innerHTML = currency(activeHost.total_host)
            document.querySelector('#hosting-total-all').innerHTML = currency(activeHost.total_all)

            
        } else {
            document.querySelector('.hosting-details').style = 'display: none;'
            document.querySelector('.hosting-selection').style = ''
            await fetchTabs()
        }
        document.querySelector('.hosting-panel').classList.remove('opening')
    }

    const closeHostingWindow = () => {
        document.querySelector('.hosting-panel').classList.add('closing')
        setTimeout(() => {
            document.querySelector('.hosting-panel').classList.remove('active')
            document.querySelector('.hosting-panel').classList.remove('closing')
            document.querySelectorAll('#hosting-tab-list .selected').forEach((x) => x.classList.remove('selected'))
            document.querySelector('#hosting-confirm').classList.add('disabled')
            document.querySelectorAll('.hosting-end-form input').forEach(input => input.classList.remove('error'));
        }, 200)
            
    }

    const confirmHosting = async () => {
        const tab = document.querySelector('#hosting-tab-list .selected')
        if(tab === null) return
        const response = await fetch('/api/hostings/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': await getCsrfToken()
            },
            body: JSON.stringify({
                "tab": parseInt(tab.dataset.id)
            })
        })
        closeHostingWindow()
        updateActiveHosting()
        fetchProducts()
    }

    const endHosting = async () => {
        document.querySelectorAll('.hosting-end-form input').forEach(input => input.classList.remove('error'));
        const id = activeHost.id
        const peopleInput = document.querySelector('#hosting-people')
        const people = parseInt(peopleInput.value)
        const commentInput = document.querySelector('#hosting-comment')
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

        const response = await fetch(`/api/hostings/${id}/end/`, {
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
            updateActiveHosting()
            fetchProducts()
            closeHostingWindow()
        }
    }


    document.querySelector('#hosting-confirm').addEventListener('click', confirmHosting)
    document.querySelector('#hosting-end').addEventListener('click', endHosting)

    document.querySelectorAll('.hosting-panel .close, .hosting-panel').forEach((x) => x.addEventListener('click', (e) => {
        if(e.target !== e.currentTarget) return
        closeHostingWindow()
    }))
    document.querySelector('#hosting-info').addEventListener('click', openHostingWindow)


    document.querySelector('#confirmation .button').addEventListener('click', confirmPurchase) 
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
        await updateActiveHosting()
        toMain()
    }
})

