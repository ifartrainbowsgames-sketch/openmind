import { useEffect, useState } from 'react'
import ConnectionsPanel from '@/components/workforce/ConnectionsPanel'
import {
  loadLiveConnections,
  probeConnection,
  saveLiveConnections,
  type LiveConnectionConfig,
} from '@/lib/agent'
import { loadOAuthConnections, mergeConnectionConfigs } from '@/lib/oauth-connections'

export default function AppsPage() {
  const [configs, setConfigs] = useState<LiveConnectionConfig[]>(loadLiveConnections)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    const local = loadLiveConnections()
    void loadOAuthConnections()
      .then(async (installed) => {
        const merged = mergeConnectionConfigs(local, installed)
        const checked = await Promise.all(
          merged.map((config) =>
            config.authSource === 'oauth' && config.status === 'ready'
              ? probeConnection(config)
              : Promise.resolve(config)),
        )
        saveLiveConnections(checked)
        setConfigs(checked)
        setLoadError(null)
      })
      .catch((error) => {
        setLoadError(error instanceof Error ? error.message : 'Installed apps could not be loaded.')
      })
  }, [])

  return <ConnectionsPanel configs={configs} onChange={setConfigs} loadError={loadError} />
}
