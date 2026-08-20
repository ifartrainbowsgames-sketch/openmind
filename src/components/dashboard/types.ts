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
