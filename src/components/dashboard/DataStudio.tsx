import { useRef, useState } from 'react'
import type { Source } from './types'
import { formatBytes } from './types'
import { capabilities } from '@/data/capabilities'
import {
  Upload, Globe, Type, Trash2, FileText, Check, Loader2,
  Database, FileSpreadsheet, Braces,
} from 'lucide-react'

const CONNECTORS = ['Notion', 'Google Drive', 'Confluence', 'GitHub', 'Zendesk', 'Shopify']
const FILE_KINDS: Record<string, string> = {
  pdf: 'PDF', docx: 'DOCX', txt: 'TXT', md: 'MD', csv: 'CSV', json: 'JSON', mp3: 'AUDIO', wav: 'AUDIO', png: 'IMAGE', jpg: 'IMAGE',
}

interface Props {
  sources: Source[]
  addSources: (s: Omit<Source, 'id' | 'addedAt' | 'status' | 'progress' | 'chunks'>[]) => void
  removeSource: (id: string) => void
  toggleAttach: (id: string, cap: string) => void
}

export default function DataStudio({ sources, addSources, removeSource, toggleAttach }: Props) {
  const [dragging, setDragging] = useState(false)
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [attachSel, setAttachSel] = useState<string[]>(['chat', 'docqa'])
  const fileRef = useRef<HTMLInputElement>(null)

  const onFiles = (files: FileList | null) => {
    if (!files?.length) return
    addSources(
      [...files].map((f) => ({
        name: f.name,
        type: 'file' as const,
        size: formatBytes(f.size),
        attached: attachSel,
        estChunks: Math.max(4, Math.round(f.size / 1800)),
      })).map(({ estChunks: _e, ...rest }) => rest),
    )
  }

  const toggleSel = (id: string) =>
    setAttachSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  return (
    <div className="space-y-8">
      {/* intro */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h2 className="font-serif-display text-3xl font-semibold">Data Studio</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Everything you upload is chunked, embedded with <em>your</em> provider key, and indexed
            per capability. Files never leave your workspace unless you attach them to a service.
          </p>
        </div>
        <span className="font-mono-spec text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          {sources.length} sources · {sources.filter((s) => s.status === 'indexed').length} indexed
        </span>
      </div>

      {/* attach selector */}
      <div className="border border-primary bg-card p-4">
        <span className="spec-label mb-2 block">New sources feed these capabilities</span>
        <div className="flex flex-wrap gap-2">
          {capabilities.map((c) => (
            <button
              key={c.id}
              onClick={() => toggleSel(c.id)}
              className={`border px-3 py-1.5 font-mono-spec text-[11px] uppercase tracking-wider transition-colors ${
                attachSel.includes(c.id)
                  ? 'border-accent bg-accent text-white'
                  : 'border-border/60 text-muted-foreground hover:border-primary'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* intake row */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* dropzone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); onFiles(e.dataTransfer.files) }}
          onClick={() => fileRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center gap-3 border border-dashed p-8 text-center transition-colors lg:row-span-2 ${
            dragging ? 'border-accent bg-accent/5' : 'border-primary bg-card hover:border-accent'
          }`}
        >
          <Upload className={`h-7 w-7 ${dragging ? 'text-accent' : 'text-muted-foreground'}`} />
          <div className="font-mono-spec text-xs uppercase tracking-[0.14em]">
            {dragging ? 'Drop to upload' : 'Drag files or click'}
          </div>
          <p className="text-xs text-muted-foreground">
            PDF · DOCX · MD · CSV · JSON · audio · images
          </p>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => { onFiles(e.target.files); e.target.value = '' }}
          />
        </div>

        {/* url */}
        <div className="border border-primary bg-card p-4">
          <span className="spec-label mb-2 flex items-center gap-2"><Globe className="h-3.5 w-3.5" /> Crawl a website</span>
          <div className="flex gap-2">
            <input
              className="flex-1 border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-accent rounded-none"
              placeholder="https://docs.acme.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button
              onClick={() => { if (url.trim()) { addSources([{ name: url.trim(), type: 'url', size: '—', attached: attachSel }]); setUrl('') } }}
              className="border border-primary bg-primary px-4 font-mono-spec text-xs uppercase tracking-wider text-primary-foreground hover:bg-accent hover:border-accent"
            >
              Add
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">We crawl, clean and re-sync on a schedule.</p>
        </div>

        {/* paste text */}
        <div className="border border-primary bg-card p-4">
          <span className="spec-label mb-2 flex items-center gap-2"><Type className="h-3.5 w-3.5" /> Paste raw text</span>
          <textarea
            className="min-h-20 w-full resize-y border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-accent rounded-none"
            placeholder="Refund policy: customers may return…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            onClick={() => { if (text.trim()) { addSources([{ name: `Pasted text (${text.trim().split(/\s+/).length} words)`, type: 'text', size: formatBytes(text.length), attached: attachSel }]); setText('') } }}
            className="mt-2 border border-primary bg-primary px-4 py-2 font-mono-spec text-xs uppercase tracking-wider text-primary-foreground hover:bg-accent hover:border-accent"
          >
            Add source
          </button>
        </div>

        {/* connectors */}
        <div className="border border-border/60 bg-card p-4 lg:col-span-2">
          <span className="spec-label mb-3 block">Or connect an app</span>
          <div className="flex flex-wrap gap-2">
            {CONNECTORS.map((c) => (
              <span
                key={c}
                className="flex items-center gap-2 border border-border/60 px-3 py-2 font-mono-spec text-[11px] uppercase tracking-wider text-muted-foreground"
              >
                <Database className="h-3.5 w-3.5" /> {c}
                <span className="border border-amber-500/50 px-1 text-[9px] text-amber-600">soon</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* sources table */}
      <div className="border border-primary bg-card hard-shadow">
        <div className="flex items-center justify-between border-b border-primary px-5 py-2.5">
          <span className="spec-label">Workspace sources</span>
          <span className="font-mono-spec text-[10px] text-muted-foreground">auto chunk + embed on upload</span>
        </div>
        {sources.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <FileText className="mx-auto mb-3 h-6 w-6 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No data yet — drop a file above and watch it index.</p>
          </div>
        ) : (
          sources.map((s) => (
            <div key={s.id} className="border-b border-border/40 px-5 py-4 last:border-b-0">
              <div className="flex flex-wrap items-center gap-3">
                {s.type === 'file' ? (
                  FILE_KINDS[s.name.split('.').pop()?.toLowerCase() ?? ''] === 'CSV' ? <FileSpreadsheet className="h-4 w-4 text-accent" />
                  : FILE_KINDS[s.name.split('.').pop()?.toLowerCase() ?? ''] === 'JSON' ? <Braces className="h-4 w-4 text-accent" />
                  : <FileText className="h-4 w-4 text-accent" />
                ) : s.type === 'url' ? (
                  <Globe className="h-4 w-4 text-accent" />
                ) : (
                  <Type className="h-4 w-4 text-accent" />
                )}
                <span className="max-w-56 truncate text-sm font-medium">{s.name}</span>
                <span className="font-mono-spec text-[11px] text-muted-foreground">{s.size}</span>
                <span
                  className={`ml-auto flex items-center gap-1.5 border px-2 py-0.5 font-mono-spec text-[10px] uppercase tracking-wider ${
                    s.status === 'indexed'
                      ? 'border-emerald-600/50 text-emerald-700'
                      : 'border-amber-500/60 text-amber-700'
                  }`}
                >
                  {s.status === 'indexed' ? <Check className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin" />}
                  {s.status === 'indexed' ? `indexed · ${s.chunks} chunks` : `indexing ${s.progress}%`}
                </span>
                <button onClick={() => removeSource(s.id)} className="text-muted-foreground hover:text-accent" aria-label="Remove">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {s.status === 'indexing' && (
                <div className="mt-2 h-1.5 w-full border border-border/50 bg-background">
                  <div className="h-full bg-accent transition-all duration-300" style={{ width: `${s.progress}%` }} />
                </div>
              )}

              {/* attached capabilities */}
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <span className="spec-label mr-1">feeds →</span>
                {capabilities.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => toggleAttach(s.id, c.id)}
                    className={`border px-2 py-0.5 font-mono-spec text-[10px] uppercase tracking-wider transition-colors ${
                      s.attached.includes(c.id)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border/50 text-muted-foreground/60 hover:border-primary hover:text-foreground'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
