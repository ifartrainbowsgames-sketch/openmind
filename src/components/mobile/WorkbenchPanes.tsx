import { FolderTree, Globe, Settings } from 'lucide-react'
import type { CrewArtifact } from '@/lib/crew'

export function FilesBrowserPanel({
  artifacts,
  browserUrl,
  onBrowserUrl,
  fileBody,
  onOpenFile,
}: {
  artifacts: CrewArtifact[]
  browserUrl: string
  onBrowserUrl: (url: string) => void
  fileBody?: string
  onOpenFile: (artifact: CrewArtifact) => void
}) {
  return (
    <aside className="hidden min-w-0 w-[min(32vw,360px)] shrink-0 flex-col border-l border-white/10 bg-[#141414] xl:flex">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-white/10 px-2 text-[11px] text-white/50">
        <FolderTree className="h-3.5 w-3.5" />
        Files
        <span className="mx-1 text-white/20">/</span>
        <Globe className="h-3.5 w-3.5" />
        Browser
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-2">
        <div className="min-h-0 overflow-y-auto border-b border-white/10 p-2">
          {artifacts.length === 0 && !fileBody ? (
            <p className="px-2 py-3 text-[11px] leading-5 text-white/35">
              Crew artifacts and attached notes land here — like an explorer, for this thread.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {artifacts.map((artifact) => (
                <li key={artifact.id}>
                  <button
                    type="button"
                    onClick={() => onOpenFile(artifact)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-white/80 hover:bg-white/8"
                  >
                    <span className="truncate">{artifact.title}</span>
                    <span className="ml-auto text-[10px] text-white/30">{artifact.kind}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {fileBody ? (
            <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-black/40 p-2 text-[10px] leading-4 text-white/70 whitespace-pre-wrap">
              {fileBody}
            </pre>
          ) : null}
        </div>
        <div className="flex min-h-0 flex-col">
          <form
            className="flex shrink-0 gap-1 border-b border-white/10 p-1.5"
            onSubmit={(event) => {
              event.preventDefault()
              const box = event.currentTarget.elements.namedItem('url') as HTMLInputElement
              const next = box.value.trim()
              if (next) onBrowserUrl(next.startsWith('http') ? next : `https://${next}`)
            }}
          >
            <Globe className="mt-1.5 h-3.5 w-3.5 shrink-0 text-white/35" />
            <input
              name="url"
              defaultValue={browserUrl}
              key={browserUrl}
              placeholder="https://"
              className="min-w-0 flex-1 rounded bg-white/5 px-2 py-1 text-[11px] text-white outline-none"
            />
          </form>
          {browserUrl ? (
            <iframe
              title="OpenMind browser"
              src={browserUrl}
              sandbox="allow-scripts allow-same-origin allow-forms"
              className="min-h-0 flex-1 bg-white"
            />
          ) : (
            <p className="p-3 text-[11px] leading-5 text-white/35">
              Hosted Chrome for agents is Browserless (`web_act`). This pane previews a URL for you. Many sites block iframes — paste a URL anyway.
            </p>
          )}
        </div>
      </div>
    </aside>
  )
}

export function SettingsGearButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-10 w-10 items-center justify-center rounded-lg text-white/55 hover:bg-white/10 hover:text-white"
      aria-label="Settings"
    >
      <Settings className="h-[18px] w-[18px]" />
    </button>
  )
}
