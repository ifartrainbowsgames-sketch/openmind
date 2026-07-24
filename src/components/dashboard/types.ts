export interface Source {
  id: string
  name: string
  type: 'file' | 'url' | 'text'
  size: string
  chunks: number
  status: 'stored' | 'indexing' | 'indexed' | 'error'
  progress: number
  attached: string[] // capability ids
  addedAt: string
  sizeBytes?: number
  filePath?: string
  sourceUrl?: string
  content?: string
}

export function formatBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`
  return `${(b / 1024 ** 3).toFixed(2)} GB`
}

export const KEY_MODES = [
  { id: 'browser', name: 'Browser-direct', desc: 'visitor\'s key, zero servers' },
  { id: 'vault', name: 'Vaulted (planned)', desc: 'server-managed vault not connected' },
  { id: 'proxy', name: 'Gateway', desc: 'rate-limited + cached' },
] as const

export interface CapSetting {
  models: string[]
  widget: boolean
  params: ('temperature' | 'systemPrompt')[]
  dataHint: string
}

export const CAP_SETTINGS: Record<string, CapSetting> = {
  chat: {
    models: ['gpt-4o', 'claude-3.5-sonnet', 'mistral-large', 'llama-3.1-70b'],
    widget: true,
    params: ['temperature', 'systemPrompt'],
    dataHint: 'Stored sources become answerable only after the indexing worker is implemented and reports them as indexed.',
  },
}
