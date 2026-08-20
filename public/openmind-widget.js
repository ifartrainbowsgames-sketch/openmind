(function () {
  'use strict'
  var script = document.currentScript
  if (!script || script.dataset.openmindMounted === 'true') return
  script.dataset.openmindMounted = 'true'

  var key = script.dataset.key
  if (!key) {
    console.error('[OpenMind] Widget data-key is required.')
    return
  }

  var origin = new URL(script.src, window.location.href).origin
  var frame = document.createElement('iframe')
  frame.src = origin + '/widget?' + new URLSearchParams({
    key: key,
    page: window.location.pathname + window.location.search,
  }).toString()
  frame.title = 'Customer support chat'
  frame.referrerPolicy = 'origin-when-cross-origin'
  frame.setAttribute('allow', 'clipboard-write')
  frame.style.cssText = [
    'position:fixed', 'right:20px', 'bottom:84px',
    'width:min(400px,calc(100vw - 24px))', 'height:min(620px,calc(100vh - 112px))',
    'border:0', 'background:transparent', 'z-index:2147483646', 'display:none',
  ].join(';')

  var button = document.createElement('button')
  button.type = 'button'
  button.setAttribute('aria-label', 'Open customer support chat')
  button.setAttribute('aria-expanded', 'false')
  button.textContent = 'Chat'
  button.style.cssText = [
    'position:fixed', 'right:20px', 'bottom:20px', 'height:52px', 'min-width:72px',
    'padding:0 18px', 'border:0', 'border-radius:999px', 'cursor:pointer',
    'font:600 14px system-ui,sans-serif', 'color:#fff', 'background:#ff4d00',
    'box-shadow:0 10px 30px rgba(0,0,0,.22)', 'z-index:2147483647',
  ].join(';')

  var open = false
  var closedLabel = 'Chat'
  button.addEventListener('click', function () {
    open = !open
    frame.style.display = open ? 'block' : 'none'
    button.textContent = open ? 'Close' : closedLabel
    button.setAttribute('aria-expanded', String(open))
  })

  function number(value, fallback, min, max) {
    return typeof value === 'number' && isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : fallback
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== origin || event.source !== frame.contentWindow) return
    var data = event.data
    if (!data || data.type !== 'openmind:widget-config') return
    var launcher = data.launcher || {}
    var panel = data.panel || {}
    var colors = data.colors || {}
    var position = launcher.position === 'bottom-left' ? 'bottom-left' : 'bottom-right'
    var x = number(launcher.offsetX, 20, 8, 80)
    var y = number(launcher.offsetY, 20, 8, 80)
    var size = number(launcher.size, 52, 44, 72)
    var width = number(panel.width, 400, 320, 520)
    var height = number(panel.height, 620, 480, 760)

    closedLabel = typeof launcher.label === 'string' && launcher.label.trim()
      ? launcher.label.trim().slice(0, 32)
      : 'Chat'
    if (!open) button.textContent = closedLabel
    button.style.height = size + 'px'
    button.style.bottom = y + 'px'
    button.style.background = colors.launcherBackground || '#ff4d00'
    button.style.color = colors.launcherText || '#ffffff'
    frame.style.bottom = (y + size + 12) + 'px'
    frame.style.width = 'min(' + width + 'px,calc(100vw - 24px))'
    frame.style.height = 'min(' + height + 'px,calc(100vh - ' + (y + size + 28) + 'px))'
    if (position === 'bottom-left') {
      button.style.left = x + 'px'
      button.style.right = 'auto'
      frame.style.left = x + 'px'
      frame.style.right = 'auto'
    } else {
      button.style.right = x + 'px'
      button.style.left = 'auto'
      frame.style.right = x + 'px'
      frame.style.left = 'auto'
    }
  })

  function mount() {
    if (!document.body) return
    document.body.appendChild(frame)
    document.body.appendChild(button)
  }
  if (document.body) mount()
  else document.addEventListener('DOMContentLoaded', mount, { once: true })
})()
