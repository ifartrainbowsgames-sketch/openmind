import { useMemo, useState } from 'react'
import { Bug, ChevronRight, Cpu, GitBranch, Layers, MessageCircleQuestion, Paperclip, Plug, Search, X } from 'lucide-react'
import { filterSkills, type SkillId, type SkillSpec } from '@/lib/skills'

const ICONS: Record<SkillId, typeof GitBranch> = {
  plan: GitBranch,
  debug: Bug,
  multitask: Layers,
  ask: MessageCircleQuestion,
}

export default function CommandSheet({
  open,
  skill,
  modelName,
  onClose,
  onPickSkill,
  onFiles,
  onModel,
  onMcp,
}: {
  open: boolean
  skill: SkillId
  modelName: string
  onClose: () => void
  onPickSkill: (id: SkillId) => void
  onFiles: () => void
  onModel: () => void
  onMcp: () => void
}) {
  const [query, setQuery] = useState('')
  const skills = useMemo(() => filterSkills(query), [query])
  if (!open) return null

  const pick = (id: SkillId) => {
    onPickSkill(id)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center lg:items-center" role="dialog" aria-modal="true" aria-label="Skills and context">
      <button className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} aria-label="Close" />
      <div className="relative z-10 w-full rounded-t-[28px] bg-[#1a1916] px-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 text-white shadow-2xl lg:max-w-md lg:rounded-[24px] lg:p-4">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20 lg:hidden" />
        <div className="mb-3 flex items-center gap-2 rounded-2xl bg-white/8 px-3 py-2">
          <Search className="h-4 w-4 text-white/45" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search skills, context, chats..."
            className="w-full bg-transparent text-sm outline-none placeholder:text-white/35"
          />
          <button type="button" onClick={onClose} className="rounded-full p-1 text-white/50 hover:bg-white/10" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">Skills</p>
        <div className="space-y-1">
          {skills.map((item: SkillSpec) => {
            const Icon = ICONS[item.id]
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => pick(item.id)}
                className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left ${
                  skill === item.id ? 'bg-white/12' : 'hover:bg-white/6'
                }`}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: `${item.accent}33`, color: item.accent }}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{item.name}</span>
                  <span className="block truncate text-[11px] text-white/45">{item.desc}</span>
                </span>
              </button>
            )
          })}
        </div>
        <div className="mt-3 space-y-1 border-t border-white/10 pt-3">
          <button type="button" onClick={() => { onFiles(); onClose() }} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-white/6">
            <Paperclip className="h-4 w-4 text-white/50" />
            <span className="flex-1 text-sm">Files</span>
            <ChevronRight className="h-4 w-4 text-white/25" />
          </button>
          <button type="button" onClick={() => { onModel(); onClose() }} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-white/6">
            <Cpu className="h-4 w-4 text-white/50" />
            <span className="flex-1 text-sm">Model</span>
            <span className="text-[11px] text-white/40">{modelName}</span>
            <ChevronRight className="h-4 w-4 text-white/25" />
          </button>
          <button type="button" onClick={() => { onMcp(); onClose() }} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-white/6">
            <Plug className="h-4 w-4 text-white/50" />
            <span className="flex-1 text-sm">MCP / Connect</span>
            <ChevronRight className="h-4 w-4 text-white/25" />
          </button>
        </div>
        <p className="mt-3 px-1 text-[10px] leading-4 text-white/30">
          Skills are OpenMind modes on one crew. Hosted Chrome is Browserless (`web_act`). Connect apps is Nango, not a pasted MCP zoo.
        </p>
      </div>
    </div>
  )
}
