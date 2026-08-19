import { useEffect, useState } from 'react'
import { setCrewToolGuard, type CrewToolKind } from '@/lib/crew-tools'

export default function ToolConfirmHost() {
  const [pending, setPending] = useState<{
    kind: CrewToolKind
    summary: string
    resolve: (ok: boolean) => void
  } | null>(null)

  useEffect(() => {
    setCrewToolGuard(
      (kind, summary) =>
        new Promise((resolve) => {
          setPending({ kind, summary, resolve })
        }),
    )
    return () => setCrewToolGuard(undefined)
  }, [])

  if (!pending) return null

  const decide = (ok: boolean) => {
    pending.resolve(ok)
    setPending(null)
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center lg:items-center" role="dialog" aria-modal="true" aria-labelledby="tool-confirm-title">
      <button className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => decide(false)} aria-label="Cancel" />
      <div className="relative z-10 w-full rounded-t-[28px] bg-white px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl lg:max-w-md lg:rounded-[24px] lg:p-5">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-black/15 lg:hidden" />
        <h2 id="tool-confirm-title" className="text-lg font-semibold tracking-[-0.02em]">
          Allow this action?
        </h2>
        <p className="mt-1 text-xs text-[#85827b]">
          Writes, sends, and checkout-like pages need a tap first.
        </p>
        <p className="mt-3 rounded-2xl bg-[#f3f1ed] p-3 text-sm leading-relaxed text-[#17140f]">
          {pending.summary}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => decide(false)}
            className="rounded-xl bg-[#f3f1ed] py-3 text-sm font-medium"
          >
            Block
          </button>
          <button
            type="button"
            onClick={() => decide(true)}
            className="rounded-xl bg-[#17140f] py-3 text-sm font-medium text-white"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  )
}
