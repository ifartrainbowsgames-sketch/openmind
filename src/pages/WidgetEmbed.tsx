import { useEffect, useState } from 'react'
import ChatWidget, {
  DEFAULT_WIDGET,
  type WidgetConfig,
  type WidgetFont,
  type WidgetPreset,
} from '@/components/widget/ChatWidget'
import { requestPublishedWidgetConfig } from '@/lib/chat-gateway'
import { chatbotConfigFromRow } from '@/lib/chatbot-config'

const allowed = <T extends string>(value: string | null, values: readonly T[], fallback: T): T =>
  value && values.includes(value as T) ? value as T : fallback

export default function WidgetEmbed() {
  const params = new URLSearchParams(window.location.search)
  const widgetKey = params.get('key') ?? ''
  const referrer = document.referrer
  let referrerOrigin = ''
  let referrerPage = ''
  try {
    const parent = new URL(referrer)
    referrerOrigin = parent.origin
    referrerPage = `${parent.pathname}${parent.search}`.slice(0, 500)
  } catch {
    referrerPage = params.get('page') ?? ''
  }
  const fallbackConfig: WidgetConfig = {
    ...DEFAULT_WIDGET,
    accent: params.get('accent') || DEFAULT_WIDGET.accent,
    theme: allowed(params.get('theme'), ['light', 'dark'] as const, 'light'),
    radius: allowed(params.get('radius'), ['sharp', 'soft', 'round'] as const, 'soft'),
    agentName: params.get('agent') || DEFAULT_WIDGET.agentName,
    greeting: params.get('greeting') || DEFAULT_WIDGET.greeting,
    preset: allowed<WidgetPreset>(
      params.get('preset'),
      ['openmind', 'discord', 'telegram', 'instagram'],
      'openmind',
    ),
    font: allowed<WidgetFont>(params.get('font'), ['system', 'serif', 'mono'], 'system'),
    voice: params.get('voice') !== 'false',
    video: params.get('video') === 'true',
    images: params.get('images') === 'true',
    aiFix: params.get('aiFix') === 'true',
  }
  const [config, setConfig] = useState(fallbackConfig)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    if (!widgetKey) {
      void Promise.resolve().then(() => setStatus('error'))
      return
    }
    void requestPublishedWidgetConfig({ widgetKey, siteOrigin: referrerOrigin })
      .then((reply) => {
        const published = reply.widgetConfig
        if (!published) throw new Error('missing widget config')
        const appearance = published.appearance
        const features = published.features
        const mapped = chatbotConfigFromRow({
          appearance,
          features,
          agent_name: published.agentName || published.employeeName,
          greeting: published.greeting,
        }).widget
        setConfig(mapped)
        window.parent.postMessage({
          type: 'openmind:widget-config',
          colors: mapped.colors,
          launcher: mapped.launcher,
          panel: mapped.panel,
        }, '*')
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }, [widgetKey, referrerOrigin])

  return (
    <main id="main-content" className="h-screen w-screen bg-transparent p-2">
      {status === 'ready' ? (
        <ChatWidget
          config={config}
          live
          widgetKey={widgetKey}
          siteOrigin={referrerOrigin}
          page={referrerPage}
        />
      ) : status === 'loading' ? (
        <div className="flex h-full items-center justify-center border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Loading support…
        </div>
      ) : (
        <div className="flex h-full items-center justify-center border border-red-600 bg-red-50 p-6 text-center text-sm text-red-700">
          This support widget is unavailable or is not approved for this website.
        </div>
      )}
    </main>
  )
}
