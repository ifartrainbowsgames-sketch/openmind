// WorkforceStudio — the full AI-employees experience, shared by the public
// /employees page and the dashboard's Workforce category.
//
// Wave 2 rework:
// - Creation runs through planWorkforce(): a real LLM planner designs the team
//   when the shared brain bar is LIVE + keyed; otherwise a clearly stamped
//   OFFLINE PLANNER heuristic playback. Fallbacks surface as an amber banner.
// - Every run gets a categorical report card (LLM judge or honest heuristic).
// - A trust ladder gates runs per employee: Auto / Ask first / Draft mode.
// - ConnectionsPanel upgrades connections MOCK → LIVE with honest stamps.
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  AlertTriangle, Bot, Check, ChevronDown, ChevronRight, ClipboardCheck, KeyRound, Link2,
  Loader2, PenLine, Radio, ScanText, Send, ShieldCheck, Sparkles, Trash2, Users, Workflow, Wrench, X,
} from 'lucide-react'
import {
  ALL_TOOLS, LIVE_PROVIDERS, loadLiveConnections, resolveConnectionTools, runEmployee,
  simulatedBrain, liveBrain, toolName,
  type AgentBrain, type Employee, type LiveConnectionConfig, type PlanStep, type TraceLine,
} from '@/lib/agent'
import { runCrew, type CrewArtifact } from '@/lib/crew'
import { MAX_HIRES } from '@/lib/staffing'
import { planWorkforce, StaffingError, type StaffingStage } from '@/lib/llm-staffing'
import { generateStaff, provisionPlan, type ProvisionStage } from '@/lib/staffing'
import { loadCustomEmployees, PRESET_EMPLOYEES, saveCustomEmployees } from '@/data/employees'
import { loadScorecards, recordScore, scoreRun, type RunScore } from '@/lib/reportcard'
import { streamText } from '@/lib/demo'
import { inputCls, ModeStamp, RunButton, textareaCls } from '@/components/demos/shared'
import WorkforceMap from './WorkforceMap'
import GraphFlow from './GraphFlow'
import ConnectionsPanel, { connStatus } from './ConnectionsPanel'
import ConnectorMarketplace from './ConnectorMarketplace'
import ReportCard, { MiniScorecard } from './ReportCard'
import ToolConfirmHost from '@/components/crew/ToolConfirmSheet'

// ── types & constants ────────────────────────────────────────────────────────

interface Msg {
  from: 'user' | 'agent'
  text: string
  trace?: TraceLine[]
  error?: boolean
  score?: RunScore
  brainStamp?: string
  artifacts?: CrewArtifact[]
  crewNames?: string[]
}

type Autonomy = 'auto' | 'ask' | 'draft'

const AUTONOMY_KEY = 'om-autonomy'
const AUTONOMY_OPTIONS: { value: Autonomy; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto', hint: 'runs tools without asking' },
  { value: 'ask', label: 'Ask first', hint: 'approves connection tools before they fire' },
  { value: 'draft', label: 'Draft mode', hint: 'previews only — nothing is executed' },
]

function loadAutonomy(): Record<string, Autonomy> {
  try {
    const raw = localStorage.getItem(AUTONOMY_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, Autonomy> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v === 'auto' || v === 'ask' || v === 'draft') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function saveAutonomy(map: Record<string, Autonomy>): void {
  try {
    localStorage.setItem(AUTONOMY_KEY, JSON.stringify(map))
  } catch {
    /* storage unavailable — settings stay in memory */
  }
}

const EXAMPLES = [
  'A support agent who answers from our docs and watches the ticket queue',
  'A team of 3: a code copilot on our GitHub, an analyst, and a content writer',
  'An executive assistant reading my Gmail and calendar',
]

// Unified provisioning-feed row (LLM stages + offline script both map to this).
interface ProvRow {
  key: string
  icon: typeof Bot
  text: string
  status: 'active' | 'done' | 'error'
}

const OFFLINE_ICON: Record<ProvisionStage['stage'], typeof Bot> = {
  parsing: ScanText,
  headcount: Users,
  role: Bot,
  prompt: PenLine,
  tools: Wrench,
  connections: Link2,
  hired: Check,
}

function llmRow(s: StaffingStage): ProvRow {
  const icon =
    s.key === 'contacting-planner' ? Radio
    : s.key === 'designing-team' ? PenLine
    : s.key === 'offline-planner' ? AlertTriangle
    : Check
  return { key: s.key, icon, text: s.detail ? `${s.label} — ${s.detail}` : s.label, status: s.status }
}

/** Rewrite LIVE/MOCK tool stamps into honest draft previews (draft mode). */
function draftify(text: string): string {
  return text.replace(/\[(?:MOCK|LIVE) · ([^\]]+)\]/g, '[DRAFT · $1] would use:')
}

// ── small components ─────────────────────────────────────────────────────────

function TraceBlock({ trace }: { trace: TraceLine[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2 border border-white/15">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 font-mono-spec text-[10px] uppercase tracking-[0.16em] text-white/50 hover:text-accent"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Workflow className="h-3 w-3" /> graph trace · {trace.length} events
      </button>
      {open && (
        <div className="space-y-1 border-t border-white/15 px-3 py-2.5">
          {trace.map((t, i) => (
            <div key={i} className="flex gap-2 font-mono-spec text-[11px] leading-relaxed">
              <span className={`shrink-0 uppercase ${t.node === 'act' ? 'text-accent' : 'text-white/40'}`}>{t.node}</span>
              <span className="text-white/70">{t.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AutonomyControl({ value, onChange }: { value: Autonomy; onChange: (a: Autonomy) => void }) {
  return (
    <div
      className="inline-grid grid-cols-3 border border-border/60"
      title={`Trust ladder — ${AUTONOMY_OPTIONS.find((o) => o.value === value)?.hint}`}
      onClick={(e) => e.stopPropagation()}
    >
      {AUTONOMY_OPTIONS.map((o) => (
        <button
          key={o.value}
          title={o.label === 'Auto' ? 'Auto — runs tools without asking' : o.label === 'Ask first' ? 'Ask first — approve connection tools before they fire' : 'Draft mode — previews only, nothing executed'}
          onClick={(e) => { e.stopPropagation(); onChange(o.value) }}
          className={`dash-press px-2 py-1 font-mono-spec text-[9px] uppercase tracking-[0.1em] transition-colors ${
            value === o.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ── the studio ───────────────────────────────────────────────────────────────

export default function WorkforceStudio({ embedded = false }: { embedded?: boolean }) {
  const [custom, setCustom] = useState<Employee[]>([])
  const [selectedId, setSelectedId] = useState(PRESET_EMPLOYEES[0].id)
  const [liveConfigs, setLiveConfigs] = useState<LiveConnectionConfig[]>([])
  const [autonomyMap, setAutonomyMap] = useState<Record<string, Autonomy>>({})
  const [scoresVersion, setScoresVersion] = useState(0)

  // shared brain — powers the planner, the runs and the report-card judge
  const [mode, setMode] = useState<'sim' | 'live'>('sim')
  const [providerId, setProviderId] = useState<string>('kimi')
  const [apiKey, setApiKey] = useState('')

  // run panel
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [draft, setDraft] = useState('')
  const [running, setRunning] = useState(false)
  const [scoring, setScoring] = useState(false)
  const [liveTrace, setLiveTrace] = useState<TraceLine[]>([])
  const [flowOpen, setFlowOpen] = useState(false)
  const [planning, setPlanning] = useState(false)
  const [approval, setApproval] = useState<{ input: string; plan: PlanStep[] } | null>(null)

  // creator / provisioning
  const [brief, setBrief] = useState('')
  const [rows, setRows] = useState<ProvRow[]>([])
  const [arriving, setArriving] = useState<Employee[]>([])
  const [provisioning, setProvisioning] = useState(false)
  const [plannerStamp, setPlannerStamp] = useState<string | null>(null)
  const [fallbackNote, setFallbackNote] = useState<string | null>(null)
  const [rationale, setRationale] = useState<string | null>(null)
  const [creatorError, setCreatorError] = useState<string | null>(null)

  // sections
  const [tab, setTab] = useState<'studio' | 'connections'>('studio')

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const roster = [...PRESET_EMPLOYEES, ...custom]
  const employee = roster.find((e) => e.id === selectedId) ?? roster[0]
  const provider = LIVE_PROVIDERS.find((p) => p.id === providerId) ?? LIVE_PROVIDERS[0]
  const keyOk = provider.keyRequired === false || apiKey.trim().length > 0
  const liveReady = mode === 'live' && keyOk
  const autonomy = autonomyMap[employee.id] ?? 'auto'

  useEffect(() => {
    setCustom(loadCustomEmployees())
    setLiveConfigs(loadLiveConnections())
    setAutonomyMap(loadAutonomy())
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [msgs, running, liveTrace, approval, scoring])

  const brain = (): AgentBrain => (liveReady ? liveBrain({ ...provider, key: apiKey.trim() }) : simulatedBrain())
  const brainStamp = liveReady ? `${provider.model.toUpperCase()} · LIVE` : 'SIMULATED BRAIN'

  const select = (id: string) => {
    setSelectedId(id)
    setMsgs([])
    setLiveTrace([])
    setApproval(null)
  }

  const setAutonomy = (id: string, a: Autonomy) => {
    const next = { ...autonomyMap, [id]: a }
    setAutonomyMap(next)
    saveAutonomy(next)
  }

  // ── creation flow ──────────────────────────────────────────────────────────

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const persistHires = (hires: Employee[]) => {
    if (!hires.length) return
    const next = [...loadCustomEmployees(), ...hires]
    setCustom(next)
    saveCustomEmployees(next)
    select(hires[0].id)
  }

  /** Real LLM stage events drive the feed — later events settle earlier "active" rows. */
  const pushStage = (s: StaffingStage) => {
    setRows((prev) => {
      const settled = prev.map((r) => (r.status === 'active' && r.key !== s.key ? { ...r, status: 'done' as const } : r))
      const row = llmRow(s)
      const idx = settled.findIndex((r) => r.key === s.key)
      if (idx >= 0) {
        const next = [...settled]
        next[idx] = row
        return next
      }
      return [...settled, row]
    })
  }

  /** Stagger the signed hires into the "arriving" column for the reveal. */
  const revealHires = (hires: Employee[]) =>
    new Promise<void>((resolve) => {
      if (!hires.length) return resolve()
      let i = 0
      timerRef.current = setInterval(() => {
        i++
        setArriving(hires.slice(0, i))
        if (i >= hires.length) {
          clearTimer()
          resolve()
        }
      }, 380)
    })

  const resetCreator = () => {
    clearTimer()
    setRows([])
    setArriving([])
    setFallbackNote(null)
    setRationale(null)
    setCreatorError(null)
  }

  /** Offline path — the deterministic heuristic planner with simulated playback. */
  const generateOffline = (trimmed: string) => {
    setPlannerStamp('OFFLINE PLANNER · deterministic · no key')
    const hires = generateStaff(trimmed, custom.length + 3)
    const script = provisionPlan(trimmed, hires)
    setProvisioning(true)
    const hiredSoFar: Employee[] = []
    let i = 0
    timerRef.current = setInterval(() => {
      const stage = script[i]
      i++
      if (stage) {
        setRows((prev) => [...prev, { key: `s${i}`, icon: OFFLINE_ICON[stage.stage], text: stage.detail, status: 'done' }])
        if (stage.stage === 'hired' && stage.employeeId) {
          const hire = hires.find((h) => h.id === stage.employeeId)
          if (hire) {
            hiredSoFar.push(hire)
            setArriving((a) => [...a, hire])
          }
        }
      }
      if (i >= script.length) {
        clearTimer()
        setProvisioning(false)
        persistHires(hiredSoFar)
        setBrief('')
      }
    }, 520)
  }

  const generate = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || provisioning) return
    resetCreator()

    if (!liveReady) {
      generateOffline(trimmed)
      return
    }

    setPlannerStamp(`LLM PLANNER · ${provider.name} · ${provider.model}`)
    setProvisioning(true)
    try {
      const result = await planWorkforce(trimmed, { providerId, apiKey: apiKey.trim() }, pushStage)
      await revealHires(result.employees)
      if (result.source === 'fallback') {
        setFallbackNote(result.note ?? 'planner unreachable — used offline planner')
        setPlannerStamp('OFFLINE PLANNER · LLM FALLBACK')
      }
      if (result.rationale) setRationale(result.rationale)
      persistHires(result.employees)
      setBrief('')
    } catch (err) {
      if (err instanceof StaffingError && err.code === 'NO_KEY') {
        setCreatorError(`${err.message} Paste it in the brain bar above and generate again.`)
      } else {
        setCreatorError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setProvisioning(false)
    }
  }

  const fire = (id: string) => {
    const next = custom.filter((e) => e.id !== id)
    setCustom(next)
    saveCustomEmployees(next)
    if (selectedId === id) select(PRESET_EMPLOYEES[0].id)
  }

  // ── run flow (trust-ladder gated) ──────────────────────────────────────────

  /** Ask-first: dry-run the planner so the approval card lists real planned tools. */
  const requestApproval = async (input: string) => {
    setPlanning(true)
    try {
      const tools = [
        ...employee.tools.map((id) => ALL_TOOLS[id]).filter(Boolean),
        ...resolveConnectionTools(employee, liveConfigs),
      ]
      const plan = await brain().plan(input, tools)
      const connSteps = plan.filter((p) =>
        (employee.connections ?? []).some((c) => p.tool === c || p.tool.startsWith(`${c}__`)),
      )
      if (connSteps.length > 0) {
        setDraft('')
        setApproval({ input, plan })
        return true
      }
      return false
    } catch {
      return false // planner unreachable — fall through and let the run surface the error
    } finally {
      setPlanning(false)
    }
  }

  const executeRun = async (input: string, opts: { draftMode?: boolean; scrubConnections?: boolean } = {}) => {
    const { draftMode = false, scrubConnections = false } = opts
    setDraft('')
    setApproval(null)
    setMsgs((m) => [...m, { from: 'user', text: input }])
    setRunning(true)
    setLiveTrace([])
    setFlowOpen(true)
    const b = brain()
    const stamp = draftMode ? `${brainStamp} · DRAFT MODE` : brainStamp
    const emp = scrubConnections ? { ...employee, connections: [] } : employee
    // Draft mode: no live configs reach the graph, so nothing external executes;
    // connection stamps are rewritten as "[DRAFT · app] would use:" previews.
    const configs = draftMode ? [] : liveConfigs
    try {
      const result = await runEmployee(
        b,
        emp,
        input,
        (line) => setLiveTrace((t) => [...t, draftMode ? { ...line, text: draftify(line.text) } : line]),
        configs,
      )
      let trace = result.trace
      let answer = result.answer
      if (draftMode) {
        trace = [
          ...trace.map((l) => ({ ...l, text: draftify(l.text) })),
          // 'respond' so the heuristic scorer doesn't count it as a tool call
          { node: 'respond' as const, text: 'draft mode — previews only, no connection was executed' },
        ]
        answer = draftify(answer)
      }
      setMsgs((m) => [...m, { from: 'agent', text: '', trace, brainStamp: stamp }])
      await streamText(answer, (p) =>
        setMsgs((m) => [...m.slice(0, -1), { from: 'agent', text: p, trace, brainStamp: stamp }]),
      )
      // report card — judge with the same brain when live, heuristics otherwise
      setScoring(true)
      const judgeBrain = liveReady ? { providerId, apiKey: apiKey.trim() } : null
      const score = await scoreRun({ employee: emp, input, trace, output: answer }, judgeBrain)
      recordScore(emp.id, score)
      setScoresVersion((v) => v + 1)
      setMsgs((m) => {
        const copy = [...m]
        const last = copy[copy.length - 1]
        if (last?.from === 'agent' && !last.error) copy[copy.length - 1] = { ...last, score }
        return copy
      })
    } catch (err) {
      setMsgs((m) => [
        ...m,
        { from: 'agent', text: `Request failed — ${err instanceof Error ? err.message : String(err)}`, error: true },
      ])
    } finally {
      setRunning(false)
      setScoring(false)
    }
  }

  const run = async () => {
    const input = draft.trim()
    if (!input || running || planning || approval) return
    if (autonomy === 'ask' && (employee.connections ?? []).length > 0) {
      const gated = await requestApproval(input)
      if (gated) return
    }
    await executeRun(input, { draftMode: autonomy === 'draft' })
  }

  const runTeam = async () => {
    const input = draft.trim()
    if (!input || running || planning || approval) return
    setDraft('')
    setApproval(null)
    setMsgs((m) => [...m, { from: 'user', text: input }])
    setRunning(true)
    setLiveTrace([])
    setFlowOpen(true)
    const stamp = `${brainStamp} · CREW`
    try {
      const crew = roster.slice(0, MAX_HIRES)
      const result = await runCrew(input, brain(), {
        employees: crew,
        onTrace: (line) => setLiveTrace((t) => [...t, line]),
        configs: liveConfigs,
      })
      const trace = result.trace
      const names = result.members.map((mem) => mem.name)
      setMsgs((m) => [...m, {
        from: 'agent',
        text: '',
        trace,
        brainStamp: stamp,
        artifacts: result.artifacts,
        crewNames: names,
      }])
      await streamText(result.answer, (p) =>
        setMsgs((m) => [...m.slice(0, -1), {
          from: 'agent',
          text: p,
          trace,
          brainStamp: stamp,
          artifacts: result.artifacts,
          crewNames: names,
        }]),
      )
    } catch (err) {
      setMsgs((m) => [
        ...m,
        { from: 'agent', text: `Crew failed — ${err instanceof Error ? err.message : String(err)}`, error: true },
      ])
    } finally {
      setRunning(false)
    }
  }

  const activeTrace = running ? liveTrace : ([...msgs].reverse().find((m) => m.trace)?.trace ?? [])
  const liveCount = liveConfigs.filter((c) => c.status === 'live').length

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className={embedded ? 'space-y-8' : 'space-y-10'}>
      <ToolConfirmHost />
      {/* ── shared brain bar ── */}
      <div className="border border-border/60 bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="spec-label flex items-center gap-2">
            <KeyRound className="h-3.5 w-3.5" /> Brain — plans teams, runs employees, judges report cards
          </span>
          <div className="grid grid-cols-2 border border-border/60">
            {(['sim', 'live'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`dash-press px-4 py-2 font-mono-spec text-[11px] uppercase tracking-wider transition-colors ${
                  mode === m ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary'
                }`}
              >
                {m === 'sim' ? 'Simulated · keyless' : 'Live · browser-direct'}
              </button>
            ))}
          </div>
          {mode === 'live' && (
            <div className="flex flex-wrap items-center gap-2">
              <select className={`${inputCls} w-auto`} value={providerId} onChange={(e) => setProviderId(e.target.value)}>
                {LIVE_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} · {p.model}</option>
                ))}
              </select>
              {provider.keyRequired !== false && (
                <input
                  className={`${inputCls} w-64`}
                  type="password"
                  placeholder="Provider API key — stays in memory only"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              )}
              <span className="font-mono-spec text-[10px] text-muted-foreground">get a key: {provider.keyUrl}</span>
            </div>
          )}
        </div>
        <div className="mt-3">
          <ModeStamp
            mode={liveReady ? 'live' : 'simulated'}
            note={
              mode === 'sim'
                ? 'deterministic local brain — teams come from the offline planner, report cards are heuristic'
                : keyOk
                ? `${provider.name} · ${provider.model} — key never leaves this tab`
                : 'paste a key to activate live planning, runs and judging'
            }
            liveLabel="browser-direct"
          />
        </div>
      </div>

      {/* ── section tabs ── */}
      <div className="flex w-fit grid-cols-2 items-stretch border border-border/60">
        <button
          onClick={() => setTab('studio')}
          className={`dash-press flex items-center gap-2 px-4 py-2.5 font-mono-spec text-[11px] uppercase tracking-wider transition-colors ${
            tab === 'studio' ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary'
          }`}
        >
          <Users className="h-3.5 w-3.5" /> Team studio
        </button>
        <button
          onClick={() => setTab('connections')}
          className={`dash-press flex items-center gap-2 px-4 py-2.5 font-mono-spec text-[11px] uppercase tracking-wider transition-colors ${
            tab === 'connections' ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary'
          }`}
        >
          <Link2 className="h-3.5 w-3.5" /> Connections
          <span className={`px-1.5 py-0.5 text-[9px] ${liveCount ? 'bg-emerald-700 text-white' : 'bg-secondary text-muted-foreground'}`}>
            {liveCount} live
          </span>
        </button>
      </div>

      {tab === 'connections' && (
        <div className="space-y-6">
          <ConnectorMarketplace onLinked={setLiveConfigs} />
          <details className="border border-border/60 bg-card">
            <summary className="cursor-pointer px-5 py-3 font-mono-spec text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-accent">
              Advanced
            </summary>
            <div className="border-t border-border/40">
              <ConnectionsPanel configs={liveConfigs} onChange={setLiveConfigs} />
            </div>
          </details>
        </div>
      )}

      {tab === 'studio' && (
        <>
          {/* ── one-prompt creator ── */}
          <div className="border border-primary bg-card p-5 hard-shadow">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="spec-label flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5" /> The staffing office — one prompt, whole team
              </span>
              <span
                className={`border px-2 py-1 font-mono-spec text-[9px] uppercase tracking-[0.14em] ${
                  liveReady
                    ? 'border-emerald-700 bg-emerald-50 text-emerald-800'
                    : 'border-amber-600 bg-amber-50 text-amber-800'
                }`}
              >
                planner: {liveReady ? `${provider.name} · ${provider.model}` : 'offline planner — flip the brain bar to LIVE for LLM-designed teams'}
              </span>
            </div>
            <textarea
              className={textareaCls}
              placeholder="Describe the staff you need in one sentence — e.g. “hire two support agents on Zendesk and a coder who reviews our GitHub PRs”"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setBrief(ex)}
                  className="border border-border/50 px-2 py-1 font-mono-spec text-[10px] text-muted-foreground hover:border-accent hover:text-accent"
                >
                  {ex.length > 52 ? ex.slice(0, 49) + '…' : ex}
                </button>
              ))}
            </div>
            <button
              onClick={() => generate(brief)}
              disabled={!brief.trim() || provisioning}
              className="mt-3 w-full border border-primary bg-primary px-6 py-3 font-mono-spec text-xs uppercase tracking-[0.16em] text-primary-foreground hard-shadow-sm transition-colors hover:border-accent hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {provisioning ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Provisioning…
                </span>
              ) : (
                'Generate staff'
              )}
            </button>

            {creatorError && (
              <p className="mt-3 flex items-start gap-2 border border-red-600 bg-red-50 px-3 py-2 font-mono-spec text-[11px] text-red-700 animate-stamp">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {creatorError}
              </p>
            )}
            {fallbackNote && (
              <div className="mt-3 flex items-start justify-between gap-2 border border-amber-600 bg-amber-50 px-3 py-2 animate-stamp">
                <p className="flex items-start gap-2 font-mono-spec text-[11px] text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {fallbackNote}
                </p>
                <button onClick={() => setFallbackNote(null)} className="text-amber-700 hover:text-accent" title="Dismiss">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* provisioning feed + arrivals */}
            {rows.length > 0 && (
              <div className="mt-4">
                {plannerStamp && (
                  <div className="mb-2 flex items-center gap-2 font-mono-spec text-[9px] uppercase tracking-[0.16em]">
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${plannerStamp.startsWith('LLM') ? 'bg-emerald-600' : 'bg-amber-500'}`} />
                    <span className={plannerStamp.startsWith('LLM') ? 'text-emerald-700' : 'text-amber-700'}>{plannerStamp}</span>
                  </div>
                )}
                <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
                  <div className="bg-terminal p-3.5">
                    <span className="mb-2 block font-mono-spec text-[9px] uppercase tracking-[0.18em] text-white/40">
                      provisioning log
                    </span>
                    <div className="space-y-1.5">
                      {rows.map((r, i) => {
                        const Icon = r.icon
                        return (
                          <div key={r.key} className="dash-feed-in flex items-center gap-2 font-mono-spec text-[11px] text-white/80">
                            <Icon
                              className={`h-3 w-3 shrink-0 ${
                                r.status === 'error' ? 'text-red-400' : r.icon === Check ? 'text-emerald-400' : 'text-accent'
                              }`}
                            />
                            <span className="text-white/45">{String(i + 1).padStart(2, '0')}</span>
                            <span className={`truncate ${r.status === 'error' ? 'text-red-300' : ''}`}>{r.text}</span>
                            {r.status === 'active' && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-white/40" />}
                          </div>
                        )
                      })}
                      {provisioning && (
                        <div className="flex items-center gap-2 font-mono-spec text-[11px] text-white/40">
                          <Loader2 className="h-3 w-3 animate-spin" /> working…
                        </div>
                      )}
                    </div>
                    {rationale && (
                      <p className="mt-3 border-t border-white/15 pt-2 font-mono-spec text-[10px] leading-relaxed text-white/55">
                        planner's rationale — {rationale}
                      </p>
                    )}
                  </div>
                  <div className="grid content-start gap-2">
                    {arriving.map((e) => (
                      <div key={e.id} className="flex items-center gap-3 border border-border/60 bg-card p-2.5 animate-[fadeSlideIn_0.4s_ease-out]">
                        <span className="h-9 w-1 shrink-0" style={{ background: e.accent }} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-serif-display text-base font-semibold">{e.name}</div>
                          <div className="spec-label !text-[9px]">{e.role}</div>
                        </div>
                        <span className="font-mono-spec text-[9px] uppercase tracking-[0.14em] text-emerald-700">hired ✓</span>
                      </div>
                    ))}
                    {arriving.length === 0 && (
                      <div className="flex h-full items-center justify-center border border-dashed border-border/60 p-4 text-center font-mono-spec text-[10px] text-muted-foreground/60">
                        new hires materialize here as they sign
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── org chart ── */}
          <div className="border border-border/60 bg-card p-5">
            <span className="spec-label mb-3 block">Org chart — who's on staff & what they can reach</span>
            <WorkforceMap employees={roster} selectedId={selectedId} onSelect={select} configs={liveConfigs} />
          </div>

          {/* ── roster ── */}
          <div>
            <span className="spec-label mb-3 block">Roster — {roster.length} on staff</span>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {roster.map((e, i) => (
                <div
                  key={e.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => select(e.id)}
                  onKeyDown={(ev) => { if (ev.key === 'Enter') select(e.id) }}
                  style={{ '--dash-i': i } as CSSProperties}
                  className={`dash-cascade group relative cursor-pointer overflow-hidden border p-4 pl-5 text-left transition-colors ${
                    selectedId === e.id ? 'border-primary bg-card hard-shadow-sm' : 'border-border/60 bg-card/60 hover:bg-card'
                  }`}
                >
                  <span className="absolute inset-y-0 left-0 w-1" style={{ background: e.accent }} />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-serif-display text-lg font-semibold leading-tight">{e.name}</div>
                      <div className="spec-label !text-[10px]">{e.role}</div>
                      {e.tagline && (
                        <div className="mt-0.5 truncate font-mono-spec text-[10px] italic text-muted-foreground/80">{e.tagline}</div>
                      )}
                    </div>
                    {!e.preset && (
                      <button
                        onClick={(ev) => { ev.stopPropagation(); fire(e.id) }}
                        className="p-1 text-muted-foreground/50 hover:text-accent"
                        title="Fire this employee"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {e.tools.map((t) => (
                      <span key={t} className="border border-border/50 px-1.5 py-0.5 font-mono-spec text-[9px] uppercase tracking-wider text-muted-foreground">
                        {toolName(t)}
                      </span>
                    ))}
                    {(e.connections ?? []).map((c) => {
                      const st = connStatus(liveConfigs, c)
                      return (
                        <span
                          key={c}
                          className={`border px-1.5 py-0.5 font-mono-spec text-[9px] uppercase tracking-wider ${
                            st === 'live'
                              ? 'border-emerald-700/70 bg-emerald-50 text-emerald-800'
                              : st === 'error'
                              ? 'border-red-600/70 bg-red-50 text-red-700'
                              : 'border-amber-600/60 bg-amber-50 text-amber-800'
                          }`}
                          title={`${toolName(c)} — ${st}`}
                        >
                          {toolName(c)} · {st}
                        </span>
                      )
                    })}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-2.5">
                    <AutonomyControl value={autonomyMap[e.id] ?? 'auto'} onChange={(a) => setAutonomy(e.id, a)} />
                    <MiniScorecard scores={loadScorecards(e.id)} key={`${e.id}-${scoresVersion}`} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── run panel ── */}
          <div className="space-y-3">
            <div>
              <button
                onClick={() => setFlowOpen((o) => !o)}
                className="flex w-full items-center justify-between border border-border/60 bg-card/60 px-4 py-2.5 font-mono-spec text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-accent"
              >
                <span className="flex items-center gap-2">
                  {flowOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  <Workflow className="h-3 w-3" /> workflow graph — {employee.name}'s LangGraph
                </span>
                <span>{running ? 'running…' : activeTrace.length ? 'trace ready' : 'idle — expand for the graph'}</span>
              </button>
              {flowOpen && (
                <div className="mt-2 animate-stamp">
                  <GraphFlow employee={employee} trace={activeTrace} running={running} />
                </div>
              )}
            </div>

            <div className="border border-primary bg-card hard-shadow">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-primary px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="h-9 w-1" style={{ background: employee.accent }} />
                  <div>
                    <div className="font-serif-display text-lg font-semibold leading-tight">{employee.name}</div>
                    <div className="spec-label !text-[10px]">{employee.role}</div>
                  </div>
                  <span
                    className={`ml-1 border px-2 py-1 font-mono-spec text-[9px] uppercase tracking-[0.14em] ${
                      liveReady ? 'border-emerald-700 bg-emerald-50 text-emerald-800' : 'border-amber-600 bg-amber-50 text-amber-800'
                    }`}
                  >
                    {brainStamp}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="hidden items-center gap-1.5 font-mono-spec text-[9px] uppercase tracking-[0.14em] text-muted-foreground sm:flex">
                    <ShieldCheck className="h-3 w-3" /> trust
                  </span>
                  <AutonomyControl value={autonomy} onChange={(a) => setAutonomy(employee.id, a)} />
                </div>
              </div>

              <div ref={scrollRef} data-lenis-prevent className="bg-terminal h-[24rem] overflow-y-auto p-4">
                {msgs.length === 0 && !running && !approval && (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                    <Workflow className="h-6 w-6 text-white/30" />
                    <p className="max-w-xs font-mono-spec text-[12px] leading-relaxed text-white/45">
                      Give {employee.name} a task — try "What's in my inbox?", "Review this code: …"
                      or "What is 128 × 46?" and watch the workflow light up.
                    </p>
                    <p className="flex items-center gap-2 font-mono-spec text-[10px] uppercase tracking-[0.14em] text-white/35">
                      <ClipboardCheck className="h-3 w-3" /> every run gets a report card
                    </p>
                  </div>
                )}
                <div className="space-y-4">
                  {msgs.map((m, i) => (
                    <div key={i} className={`dash-feed-in flex ${m.from === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[85%] px-3.5 py-2.5 font-mono-spec text-[13px] leading-relaxed whitespace-pre-wrap ${
                          m.from === 'user' ? 'text-white' : m.error ? 'border border-red-500/50 text-red-300' : 'border border-white/15 text-white/85'
                        }`}
                        style={m.from === 'user' ? { background: employee.accent } : undefined}
                      >
                        {m.text}
                        {m.from === 'agent' && m.brainStamp && (
                          <div className="mt-1.5 font-mono-spec text-[9px] uppercase tracking-[0.16em] text-white/35">{m.brainStamp}</div>
                        )}
                        {m.from === 'agent' && m.crewNames && m.crewNames.length > 0 && (
                          <div className="mt-1.5 font-mono-spec text-[9px] uppercase tracking-[0.16em] text-white/35">
                            crew · {m.crewNames.join(' · ')}
                          </div>
                        )}
                        {m.from === 'agent' && m.trace && m.trace.length > 0 && <TraceBlock trace={m.trace} />}
                        {m.from === 'agent' && m.artifacts && m.artifacts.length > 0 && (
                          <div className="mt-2 space-y-1 border border-white/15 p-2">
                            {m.artifacts.map((artifact) => (
                              <details key={artifact.id}>
                                <summary className="cursor-pointer font-mono-spec text-[10px] uppercase tracking-[0.14em] text-white/50">
                                  {artifact.title} · {artifact.kind}
                                </summary>
                                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-white/70">
                                  {artifact.body}
                                </pre>
                              </details>
                            ))}
                          </div>
                        )}
                        {m.from === 'agent' && m.score && <ReportCard score={m.score} employeeName={employee.name} />}
                      </div>
                    </div>
                  ))}
                  {running && (
                    <div className="flex items-start gap-2">
                      <div className="max-w-[85%] border border-white/15 px-3.5 py-2.5">
                        <span className="flex items-center gap-2 font-mono-spec text-[12px] text-white/60">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" /> graph running…
                        </span>
                      </div>
                    </div>
                  )}
                  {scoring && !running && (
                    <div className="flex items-center gap-2 font-mono-spec text-[11px] text-white/45">
                      <Loader2 className="h-3 w-3 animate-spin text-accent" /> scoring the run…
                    </div>
                  )}
                  {approval && (
                    <div className="border border-amber-500/60 bg-amber-500/10 p-3.5 animate-stamp">
                      <div className="mb-2 flex items-center gap-2 font-mono-spec text-[10px] uppercase tracking-[0.16em] text-amber-300">
                        <ShieldCheck className="h-3.5 w-3.5" /> approval required — {employee.name} wants to run
                      </div>
                      <p className="mb-2 font-mono-spec text-[11px] text-white/60">"{approval.input}"</p>
                      <div className="mb-3 space-y-1">
                        {approval.plan.map((p, i) => {
                          const conn = (employee.connections ?? []).find((c) => p.tool === c || p.tool.startsWith(`${c}__`))
                          const st = conn ? connStatus(liveConfigs, conn) : null
                          return (
                            <div key={i} className="flex items-center gap-2 font-mono-spec text-[11px] text-white/75">
                              <Wrench className="h-3 w-3 shrink-0 text-accent" />
                              <span className="truncate">{p.tool} — "{p.input.length > 60 ? p.input.slice(0, 57) + '…' : p.input}"</span>
                              {st && (
                                <span className={`shrink-0 border px-1.5 py-0.5 text-[9px] uppercase ${
                                  st === 'live' ? 'border-emerald-500/60 text-emerald-300' : st === 'error' ? 'border-red-500/60 text-red-300' : 'border-amber-500/60 text-amber-300'
                                }`}>
                                  {st}
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => executeRun(approval.input)}
                          className="border border-emerald-500/70 bg-emerald-500/15 px-3 py-1.5 font-mono-spec text-[10px] uppercase tracking-[0.14em] text-emerald-300 hover:bg-emerald-500/25"
                        >
                          Approve & run
                        </button>
                        <button
                          onClick={() => executeRun(approval.input, { scrubConnections: true })}
                          className="border border-white/25 px-3 py-1.5 font-mono-spec text-[10px] uppercase tracking-[0.14em] text-white/70 hover:bg-white/10"
                        >
                          Run without connection tools
                        </button>
                        <button
                          onClick={() => { setDraft(approval.input); setApproval(null) }}
                          className="border border-red-500/50 px-3 py-1.5 font-mono-spec text-[10px] uppercase tracking-[0.14em] text-red-300 hover:bg-red-500/10"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-2 border-t border-primary p-3">
                <input
                  className={inputCls}
                  placeholder={
                    autonomy === 'draft'
                      ? `Assign ${employee.name} a task… (draft mode — previews only)`
                      : autonomy === 'ask'
                      ? `Assign ${employee.name} a task… (asks before using connections)`
                      : `Assign ${employee.name} a task…`
                  }
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') run() }}
                />
                <RunButton onClick={run} running={running || planning} label="Run" stopLabel="Working…" disabled={!draft.trim() || !!approval} />
                <RunButton onClick={runTeam} running={running || planning} label="Run team" stopLabel="Crew…" disabled={!draft.trim() || !!approval} />
                <span className="hidden items-center text-muted-foreground/40 sm:flex"><Send className="h-4 w-4" /></span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
