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
  var features = (script.dataset.features || '').split(',').filter(Boolean)
  var params = new URLSearchParams({
    key: key,
    siteOrigin: window.location.origin,
    page: window.location.pathname + window.location.search,
    accent: script.dataset.accent || '#ff4d00',
    theme: script.dataset.theme || 'light',
    radius: script.dataset.radius || 'soft',
    agent: script.dataset.agent || 'Support Assistant',
    greeting: script.dataset.greeting || 'Hi! How can I help?',
    preset: script.dataset.preset || 'openmind',
    font: script.dataset.font || 'system',
    voice: String(features.indexOf('voice') >= 0),
    video: String(features.indexOf('video') >= 0),
    images: String(features.indexOf('images') >= 0),
    aiFix: String(features.indexOf('ai-fix') >= 0),
  })

  var frame = document.createElement('iframe')
  frame.src = origin + '/widget?' + params.toString()
  frame.title = script.dataset.agent || 'Customer support chat'
  frame.setAttribute('allow', 'clipboard-write')
  frame.style.cssText = [
    'position:fixed', 'right:20px', 'bottom:84px', 'width:min(400px,calc(100vw - 24px))',
    'height:min(620px,calc(100vh - 112px))', 'border:0', 'background:transparent',
    'z-index:2147483646', 'display:none',
  ].join(';')

  var button = document.createElement('button')
  button.type = 'button'
  button.setAttribute('aria-label', 'Open customer support chat')
  button.setAttribute('aria-expanded', 'false')
  button.textContent = 'Chat'
  button.style.cssText = [
    'position:fixed', 'right:20px', 'bottom:20px', 'height:52px', 'min-width:72px',
    'padding:0 18px', 'border:0', 'cursor:pointer', 'font:600 14px system-ui,sans-serif',
    'color:#fff', 'background:' + (script.dataset.accent || '#ff4d00'),
    'box-shadow:0 10px 30px rgba(0,0,0,.22)', 'z-index:2147483647',
  ].join(';')

  var open = false
  button.addEventListener('click', function () {
    open = !open
    frame.style.display = open ? 'block' : 'none'
    button.textContent = open ? 'Close' : 'Chat'
    button.setAttribute('aria-expanded', String(open))
  })

  function mount() {
    if (!document.body) return
    document.body.appendChild(frame)
    document.body.appendChild(button)
  }
  if (document.body) mount()
  else document.addEventListener('DOMContentLoaded', mount, { once: true })
})()
