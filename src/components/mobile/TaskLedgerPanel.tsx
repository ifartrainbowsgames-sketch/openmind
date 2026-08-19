import type { ProjectSnapshot } from '@/lib/task-ledger'

const STATUS_ICON: Record<string, string> = {
  completed: '✓',
  running: '●',
  pending: '○',
  failed: '✗',
  blocked: '⊘',
  needs_user: '?',
}

export function TaskLedgerPanel({ project }: { project?: ProjectSnapshot }) {
  if (!project || !project.tasks.length) return null

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-[#1a1a1a]">
      <div className="border-b border-white/10 px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/40">OpenMind task</p>
        <p className="mt-0.5 truncate text-[12px] font-medium text-white/85">{project.goal}</p>
      </div>
      <ul className="space-y-0 border-b border-white/10 px-2 py-2">
        {project.tasks.map((task) => (
          <li key={task.id} className="flex items-start gap-2 rounded-md px-1 py-1 text-[11px] leading-5 text-white/70">
            <span className="w-3 shrink-0 font-mono text-white/50">{STATUS_ICON[task.status] ?? '○'}</span>
            <span className="min-w-0 flex-1">
              <span className="font-medium text-white/80">{task.worker}</span>
              <span className="text-white/40"> · {task.goal}</span>
              {task.blocker && <span className="block text-[10px] text-amber-500/90">{task.blocker}</span>}
            </span>
          </li>
        ))}
      </ul>
      {project.artifacts.length > 0 && (
        <div className="px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/35">Artifacts</p>
          <ul className="mt-1 space-y-0.5">
            {project.artifacts.map((a) => (
              <li key={a.id} className="flex items-center gap-2 text-[11px] text-white/65">
                <span>📄</span>
                <span className="truncate font-mono">{a.path}</span>
                {a.sources != null && a.sources > 0 && (
                  <span className="ml-auto shrink-0 text-[10px] text-white/35">{a.sources} sources</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {project.blockers.length > 0 && (
        <p className="border-t border-white/10 px-3 py-2 text-[10px] text-amber-500/90">
          Blockers: {project.blockers.join(' · ')}
        </p>
      )}
    </div>
  )
}
