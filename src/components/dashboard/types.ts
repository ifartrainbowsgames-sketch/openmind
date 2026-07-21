export interface Source {
  id: string
  name: string
  type: 'file' | 'url' | 'text'
  size: string
  chunks: number
  status: 'indexing' | 'indexed'
  progress: number
  attached: string[] // capability ids
  addedAt: string
  sizeBytes?: number
  filePath?: string
}

export function formatBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`
  return `${(b / 1024 ** 3).toFixed(2)} GB`
}

export const KEY_MODES = [
  { id: 'browser', name: 'Browser-direct', desc: 'visitor\'s key, zero servers' },
  { id: 'vault', name: 'Vaulted', desc: 'encrypted server-side' },
  { id: 'proxy', name: 'Gateway', desc: 'rate-limited + cached' },
] as const
