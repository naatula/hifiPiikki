// Unified toast system for hifiPiikki.
//
// One stacking container (bottom-centre) holds every notification. Toasts are
// either transient (auto-dismissed after `duration` ms) or permanent
// (`duration: 0`, dismissed by an action or the close button). Multiple toasts
// stack cleanly instead of covering each other, and slide/fade in and out.
//
// Usage:
//   const handle = PiikkiToast.show({
//       id,         // optional: dedupe key — a second show() with the same id
//                   //   returns the existing toast instead of stacking a copy
//       message,    // string (required)
//       variant,    // 'info' | 'success' | 'update' | 'error' (default 'info')
//       icon,       // 'offline' | 'update' | 'success' | 'error' | false
//       duration,   // ms before auto-dismiss; 0 = permanent (default 5000)
//       dismissible,// show an × close button (default true for permanent)
//       actions,    // [{ label, primary, onClick }] — onClick returning true
//                   //   keeps the toast open, otherwise it is dismissed
//   })
//   handle.dismiss()
const PiikkiToast = (() => {
    let container = null

    const ICONS = {
        // cloud with a tick — "ready offline"
        offline: '<svg viewBox="0 -960 960 960"><path d="M260-160q-91 0-155.5-63T40-377q0-78 47-139t123-78q25-92 100-149t170-57q117 0 198.5 81.5T760-520q69 8 114.5 59.5T920-340q0 75-52.5 127.5T740-160H260Zm0-80h480q42 0 71-29t29-71q0-42-29-71t-71-29h-60v-80q0-83-58.5-141.5T480-720q-83 0-141.5 58.5T280-520h-20q-58 0-99 41t-41 99q0 58 41 99t99 41Zm222-200Zm-40 80 226-226-56-58-170 170-86-84-56 56 142 142Z"/></svg>',
        // circular arrow — "update available"
        update: '<svg viewBox="0 -960 960 960"><path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"/></svg>',
        success: '<svg viewBox="0 -960 960 960"><path d="m424-296 282-282-56-56-226 226-114-114-56 56 170 170Zm56 216q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z"/></svg>',
        error: '<svg viewBox="0 -960 960 960"><path d="m336-280 144-144 144 144 56-56-144-144 144-144-56-56-144 144-144-144-56 56 144 144-144 144 56 56ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z"/></svg>',
    }

    const ensureContainer = () => {
        if (container && document.body.contains(container)) return container
        container = document.createElement('div')
        container.className = 'toast-container'
        container.setAttribute('role', 'region')
        container.setAttribute('aria-live', 'polite')
        document.body.appendChild(container)
        return container
    }

    const dismiss = (el) => {
        if (!el || el.dataset.leaving) return
        el.dataset.leaving = '1'
        if (el._timer) clearTimeout(el._timer)
        el.classList.add('toast--leaving')
        const done = () => el.remove()
        el.addEventListener('animationend', done, { once: true })
        // Fallback in case the animation never fires (e.g. reduced motion).
        setTimeout(done, 400)
    }

    const show = (opts = {}) => {
        const {
            id, message, variant = 'info', icon, duration = 5000, actions = [],
        } = opts
        const dismissible = opts.dismissible ?? (duration === 0)
        const root = ensureContainer()

        if (id) {
            const existing = root.querySelector(`[data-toast-id="${CSS.escape(id)}"]`)
            if (existing && !existing.dataset.leaving) return { el: existing, dismiss: () => dismiss(existing) }
        }

        const el = document.createElement('div')
        el.className = `toast toast--${variant}`
        el.setAttribute('role', variant === 'error' ? 'alert' : 'status')
        if (id) el.dataset.toastId = id

        const iconKey = icon === undefined ? variant : icon
        if (iconKey && ICONS[iconKey]) {
            const ico = document.createElement('div')
            ico.className = 'toast__icon'
            ico.innerHTML = ICONS[iconKey]
            el.appendChild(ico)
        }

        const msg = document.createElement('div')
        msg.className = 'toast__message'
        msg.textContent = message
        el.appendChild(msg)

        if (actions.length) {
            const acts = document.createElement('div')
            acts.className = 'toast__actions'
            actions.forEach((a) => {
                const btn = document.createElement('button')
                btn.type = 'button'
                btn.className = `toast__action${a.primary ? ' toast__action--primary' : ''}`
                btn.textContent = a.label
                btn.addEventListener('click', () => {
                    const keepOpen = a.onClick && a.onClick()
                    if (!keepOpen) dismiss(el)
                })
                acts.appendChild(btn)
            })
            el.appendChild(acts)
        }

        if (dismissible) {
            const close = document.createElement('button')
            close.type = 'button'
            close.className = 'toast__close'
            close.setAttribute('aria-label', 'Sulje')
            close.innerHTML = '<svg viewBox="0 -960 960 960"><path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/></svg>'
            close.addEventListener('click', () => dismiss(el))
            el.appendChild(close)
        }

        root.appendChild(el)

        if (duration > 0) {
            el._timer = setTimeout(() => dismiss(el), duration)
        }

        return { el, dismiss: () => dismiss(el) }
    }

    return { show, dismiss }
})()

if (typeof window !== 'undefined') window.PiikkiToast = PiikkiToast
