import { supabase, SUPABASE_KEY, SUPABASE_URL } from './supabase'
import type { LiveConnectionConfig } from './agent/live-connections'

interface ConnectorInstallationRow {
  id: string
  plugin_id: string
  status: 'pending' | 'authorized' | 'live' | 'needs_reauth' | 'error'
  account_label?: string | null
  server_url: string
  tool_names?: unknown
  tool_schemas?: unknown
  last_error?: string | null
}

async function connectorRequest(
  route: 'start' | 'disconnect',
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Connectors require a configured Supabase workspace.')
  const { data } = await supabase.auth.getSession()
  const accessToken = data.session?.access_token
  if (!accessToken) throw new Error('Sign in before installing a connector.')
  const response = await fetch(`${SUPABASE_URL}/functions/v1/oauth-connector/${route}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  const result = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    throw new Error(typeof result.error === 'string' ? result.error : `Connector service returned ${response.status}.`)
  }
  return result
}

export async function startConnectorInstall(pluginId: string): Promise<void> {
  const result = await connectorRequest('start', { pluginId })
  const authorizeUrl = typeof result.authorizeUrl === 'string' ? result.authorizeUrl : ''
  if (!authorizeUrl) throw new Error('Connector service did not return an authorization URL.')
  const url = new URL(authorizeUrl)
  if (url.protocol !== 'https:') throw new Error('Connector authorization URL must use HTTPS.')
  window.location.assign(url.toString())
}

export async function disconnectConnectorInstallation(installationId: string): Promise<void> {
  await connectorRequest('disconnect', { installationId })
}

export async function loadOAuthConnections(): Promise<LiveConnectionConfig[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return []
  const { data, error } = await supabase
    .from('connector_installations')
    .select('id, plugin_id, status, account_label, server_url, tool_names, tool_schemas, last_error')
    .order('updated_at', { ascending: false })
  if (error) throw new Error(`Could not load installed connectors: ${error.message}`)
  return (data ?? []).map((row: ConnectorInstallationRow) => {
    const toolNames = Array.isArray(row.tool_names)
      ? row.tool_names.filter((name): name is string => typeof name === 'string')
      : []
    const toolSchemas = row.tool_schemas && typeof row.tool_schemas === 'object'
      ? row.tool_schemas as Record<string, unknown>
      : {}
    const status: LiveConnectionConfig['status'] =
      row.status === 'live' && toolNames.length
        ? 'live'
        : row.status === 'authorized' || row.status === 'live'
        ? 'ready'
        : 'error'
    return {
      connectionId: row.plugin_id,
      mode: 'mcp',
      serverUrl: row.server_url,
      status,
      installationId: row.id,
      authSource: 'oauth',
      ...(row.account_label ? { accountLabel: row.account_label } : {}),
      ...(toolNames.length ? { toolNames } : {}),
      ...(Object.keys(toolSchemas).length ? { toolSchemas } : {}),
      ...(row.status === 'needs_reauth'
        ? { lastError: 'Authorization expired. Install the connector again.' }
        : row.last_error
        ? { lastError: row.last_error }
        : {}),
    }
  })
}

export function mergeConnectionConfigs(
  local: LiveConnectionConfig[],
  oauth: LiveConnectionConfig[],
): LiveConnectionConfig[] {
  const oauthIds = new Set(oauth.map((config) => config.connectionId))
  return [...local.filter((config) => !oauthIds.has(config.connectionId)), ...oauth]
}
