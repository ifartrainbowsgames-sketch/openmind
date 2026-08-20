// Hand-rolled SVG mind map: company → employees → their tools & connections.
// Connection chips carry the LIVE/READY/MOCK/ERROR honesty tint.
import { CONNECTIONS, toolName, type Employee, type LiveConnectionConfig } from '@/lib/agent'
import { Bot, Building2, Link2, Wrench } from 'lucide-react'
import type { CSSProperties } from 'react'
import { STATUS_COLOR, buildOverlay } from '@/lib/workforce/map-overlay'
import type { ProjectSnapshot } from '@/lib/task-ledger'

interface Props {
  employees: Employee[]
  selectedId: string
  onSelect: (id: string) => void
  /** Live connection configs — connection chips tint emerald/red when live/error. */
  configs?: LiveConnectionConfig[]
  /**
   * The running project. Supplied, each employee shows its real task state and
   * artifact count; omitted, the map renders exactly as it always has. There is
   * no invented activity in between — an idle map means idle.
   */
  project?: ProjectSnapshot
}

type ConnTint = 'live' | 'ready' | 'error' | 'mock'

function tintOf(configs: LiveConnectionConfig[] | undefined, id: string): ConnTint {
  const cfg = configs?.find((c) => c.connectionId === id)
  if (!cfg) return 'mock'
  if (cfg.status === 'live') return 'live'
  if (cfg.status === 'ready') return 'ready'
  if (cfg.status === 'error') return 'error'
  return 'mock'
}

const CHIP_FILL: Record<ConnTint, string> = {
  live: 'fill-emerald-700',
  ready: 'fill-sky-700',
  error: 'fill-red-600',
  mock: 'fill-primary',
}
const CHIP_EDGE: Record<ConnTint, string> = {
  live: 'stroke-emerald-700/80',
  ready: 'stroke-sky-700/80',
  error: 'stroke-red-600/70',
  mock: 'stroke-accent/60',
}

const ROW = 74
const CHIP_H = 24
const CHIP_GAP = 6

export default function WorkforceMap({ employees, selectedId, onSelect, configs, project }: Props) {
  const overlay = buildOverlay(project, employees)
  // Row height adapts to the tallest chip stack so tools/connections never
  // overlap the next employee (previously a fixed ROW caused collisions).
  const maxChips = employees.reduce((n, e) => Math.max(n, e.tools.length + (e.connections?.length ?? 0)), 0)
  const rowH = Math.max(ROW, maxChips * (CHIP_H + CHIP_GAP) + 20)
  const H = Math.max(employees.length * rowH + 96, 260)
  const midY = H / 2
  const W = 940

  const empX = 300
  const empW = 190
  const empH = 46
  const chipX = 620
  const chipW = 150

  const bezier = (x1: number, y1: number, x2: number, y2: number) =>
    `M ${x1} ${y1} C ${x1 + (x2 - x1) * 0.45} ${y1}, ${x2 - (x2 - x1) * 0.45} ${y2}, ${x2} ${y2}`

  return (
    <div data-lenis-prevent className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[760px]" role="img" aria-label="Workforce mind map">
        {/* company node */}
        <g>
          <rect x={40} y={midY - 30} width={170} height={60} className="fill-primary" />
          <rect x={40} y={midY - 30} width={170} height={60} fill="none" strokeWidth={2} className="stroke-accent" />
          <foreignObject x={40} y={midY - 30} width={170} height={60}>
            <div className="flex h-full flex-col items-center justify-center text-primary-foreground">
              <span className="flex items-center gap-1.5 font-mono-spec text-[10px] uppercase tracking-[0.18em] opacity-70">
                <Building2 className="h-3 w-3" /> your company
              </span>
              <span className="font-serif-display text-lg font-semibold leading-tight">HQ</span>
            </div>
          </foreignObject>
        </g>

        {employees.map((e, i) => {
          const y = 20 + i * rowH + (rowH - empH) / 2
          const cy = y + empH / 2
          const chips = [
            ...e.tools.map((t) => ({ id: t, kind: 'tool' as const })),
            ...(e.connections ?? []).map((c) => ({ id: c, kind: 'conn' as const })),
          ]
          const chipsH = chips.length * (CHIP_H + CHIP_GAP) - CHIP_GAP
          const chipTop = cy - chipsH / 2
          const selected = e.id === selectedId
          const state = overlay[e.id]

          return (
            <g key={e.id} className="dash-node-pop" style={{ '--dash-i': i } as CSSProperties}>
              {/* edge HQ → employee */}
              <path
                d={bezier(210, midY, empX, cy)}
                fill="none"
                strokeWidth={state?.status === 'running' ? 3 : selected ? 2.5 : 1.5}
                stroke={state && state.status !== 'idle' ? STATUS_COLOR[state.status] : undefined}
                pathLength={1}
                className={`dash-edge-draw ${state && state.status !== 'idle' ? '' : selected ? 'stroke-accent' : 'stroke-border'}`}
                style={{ '--dash-i': i } as CSSProperties}
              />
              {/* employee node */}
              <g onClick={() => onSelect(e.id)} className="cursor-pointer">
                <rect x={empX} y={y} width={empW} height={empH} fill={e.accent} />
                {selected && <rect x={empX - 3} y={y - 3} width={empW + 6} height={empH + 6} fill="none" strokeWidth={2} className="stroke-primary" />}
                <foreignObject x={empX} y={y} width={empW} height={empH}>
                  <div className="flex h-full items-center gap-2 px-3 text-white">
                    <Bot className="h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-serif-display text-[15px] font-semibold leading-tight">{e.name}</div>
                      <div className="truncate font-mono-spec text-[9px] uppercase tracking-[0.14em] opacity-75">
                        {state ? (state.taskGoal ?? e.role) : e.role}
                      </div>
                    </div>
                    {state ? (
                      <span className="flex shrink-0 items-center gap-1">
                        {state.artifactCount > 0 && (
                          <span className="font-mono-spec text-[10px] opacity-90">{state.artifactCount}</span>
                        )}
                        <span
                          className={`inline-block h-2 w-2 rounded-full ${state.status === 'running' ? 'animate-pulse' : ''}`}
                          style={{ background: STATUS_COLOR[state.status] }}
                          aria-label={state.status}
                        />
                      </span>
                    ) : null}
                  </div>
                </foreignObject>
              </g>
              {/* edges + chips */}
              {chips.map((chip, j) => {
                const chY = chipTop + j * (CHIP_H + CHIP_GAP)
                const chCy = chY + CHIP_H / 2
                const label = chip.kind === 'conn' ? CONNECTIONS[chip.id]?.name ?? chip.id : toolName(chip.id)
                const tint = chip.kind === 'conn' ? tintOf(configs, chip.id) : null
                return (
                  <g key={`${chip.kind}-${chip.id}`}>
                    <path d={bezier(empX + empW, cy, chipX, chCy)} fill="none" strokeWidth={tint === 'live' ? 1.5 : 1}
                      pathLength={1} className={`dash-edge-draw ${tint ? CHIP_EDGE[tint] : 'stroke-border'}`}
                      style={{ '--dash-i': i + j * 0.25 } as CSSProperties} />
                    <rect x={chipX} y={chY} width={chipW} height={CHIP_H}
                      className={tint ? CHIP_FILL[tint] : 'fill-card'} />
                    <foreignObject x={chipX} y={chY} width={chipW} height={CHIP_H}>
                      <div className={`flex h-full items-center gap-1.5 px-2 font-mono-spec text-[9px] uppercase tracking-[0.1em] ${
                        tint ? 'text-primary-foreground' : 'text-muted-foreground'
                      }`}>
                        {tint ? <Link2 className={`h-2.5 w-2.5 shrink-0 ${tint === 'mock' ? 'text-amber-400' : 'text-white/80'}`} /> : <Wrench className="h-2.5 w-2.5 shrink-0" />}
                        <span className="truncate">{label}{tint === 'live' || tint === 'ready' ? ` · ${tint}` : ''}</span>
                      </div>
                    </foreignObject>
                  </g>
                )
              })}
            </g>
          )
        })}

        {/* legend */}
        <foreignObject x={W - 250} y={H - 26} width={250} height={20}>
          <div className="flex items-center justify-end gap-4 font-mono-spec text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
            <span className="flex items-center gap-1"><Wrench className="h-2.5 w-2.5" /> tool</span>
            <span className="flex items-center gap-1"><Link2 className="h-2.5 w-2.5 text-accent" /> mock</span>
            <span className="flex items-center gap-1"><Link2 className="h-2.5 w-2.5 text-sky-700" /> ready</span>
            <span className="flex items-center gap-1"><Link2 className="h-2.5 w-2.5 text-emerald-700" /> live</span>
          </div>
        </foreignObject>
      </svg>
    </div>
  )
}
