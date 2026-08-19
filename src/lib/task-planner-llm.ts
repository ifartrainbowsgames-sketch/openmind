// LLM task planner — designs the execution DAG a goal actually requires.
//
// The heuristic planner in ./task-planner emits one of about four shapes from
// regex matches, so "research competitors" and "audit our onboarding funnel"
// produce the same graph. This asks a model for a real DAG, then validates it
// hard: unknown workers, missing outputs, dangling dependencies and cycles are
// all rejected rather than trusted. A rejected plan falls back to the heuristic
// in demo mode; strict mode refuses, because a regex DAG is not the plan the
// model would have made and nothing downstream can tell them apart.

import { blockedMessage, isStrict } from './execution-mode'
import { extractJson } from './llm-staffing'
import { planProject, type PlanResult } from './task-planner'
import {
  createProject,
  DEFAULT_BUDGET,
  DEFAULT_LIMITS,
  logEvent,
  makeTaskId,
  type AcceptanceCriteria,
  type ProjectBudget,
  type TaskLimits,
  type TaskRecord,
  type WorkerKind,
} from './task-ledger'
import { stripWorkspacePrompt } from './workspace'

const WORKER_KINDS: WorkerKind[] = [
  'planner', 'research', 'browser', 'code', 'analyst', 'writer', 'reviewer', 'tester',
]

export interface PlannerBrain {
  baseUrl: string
  model: string
  key: string
  fixedParams?: boolean
}

const SYSTEM_PROMPT = `You design the minimum execution graph that produces a result. You are NOT staffing a company.

Reply with ONLY this JSON, no prose:
{"tasks":[{"id":"TASK-001","worker":"research","goal":"...","outputs":["research/competitors.json"],"dependsOn":[],"acceptance":{"minSources":5}}]}

Rules:
- worker is one of: ${WORKER_KINDS.join(', ')}
- Create a task because the DAG needs that capability, never because a company would employ that role.
- Every task MUST declare at least one output file path. Paths use a folder prefix (research/, analysis/, website/, qa/, output/).
- dependsOn lists task ids that must complete first. No cycles.
- acceptance is optional and may set: minBodyLength (number), mustInclude (string[]), minSources (number), minArrayLength ({key: number}).
- Prefer FEWER tasks. One task is correct when one task suffices. Never exceed 8.
- Ids must be TASK-001, TASK-002, ... in order.`

interface RawTask {
  id?: unknown
  worker?: unknown
  goal?: unknown
  outputs?: unknown
  dependsOn?: unknown
  acceptance?: unknown
}

export class PlannerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlannerError'
  }
}

async function chat(brain: PlannerBrain, system: string, user: string): Promise<string> {
  const body: Record<string, unknown> = {
    model: brain.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  }
  if (!brain.fixedParams) body.temperature = 0.2

  const res = await fetch(`${brain.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${brain.key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  })
  if (!res.ok) throw new PlannerError(`planner HTTP ${res.status}`)
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const text = data.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) throw new PlannerError('planner returned an empty reply')
  return text
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()) : []
}

function parseAcceptance(value: unknown): AcceptanceCriteria | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  const out: AcceptanceCriteria = {}
  if (typeof v.minBodyLength === 'number') out.minBodyLength = v.minBodyLength
  if (typeof v.minSources === 'number') out.minSources = v.minSources
  const mustInclude = asStringArray(v.mustInclude)
  if (mustInclude.length) out.mustInclude = mustInclude
  if (v.minArrayLength && typeof v.minArrayLength === 'object') {
    const entries = Object.entries(v.minArrayLength as Record<string, unknown>)
      .filter(([, n]) => typeof n === 'number') as [string, number][]
    if (entries.length) out.minArrayLength = Object.fromEntries(entries)
  }
  return Object.keys(out).length ? out : undefined
}

/** Depth-first cycle check over dependsOn. */
export function hasCycle(tasks: Pick<TaskRecord, 'id' | 'dependsOn'>[]): boolean {
  const byId = new Map(tasks.map((t) => [t.id, t.dependsOn]))
  const state = new Map<string, 'visiting' | 'done'>()

  const visit = (id: string): boolean => {
    const mark = state.get(id)
    if (mark === 'done') return false
    if (mark === 'visiting') return true
    state.set(id, 'visiting')
    for (const dep of byId.get(id) ?? []) {
      if (byId.has(dep) && visit(dep)) return true
    }
    state.set(id, 'done')
    return false
  }

  return tasks.some((t) => visit(t.id))
}

/**
 * Turn a planner reply into tasks, rejecting anything malformed. Throws
 * PlannerError with the specific defect rather than silently repairing —
 * a quietly-fixed plan is a plan nobody reviewed.
 */
export function validatePlan(parsed: unknown, limits: TaskLimits): TaskRecord[] {
  const root = parsed as { tasks?: unknown } | null
  const rawTasks = Array.isArray(root?.tasks) ? (root.tasks as RawTask[]) : null
  if (!rawTasks?.length) throw new PlannerError('planner returned no tasks')
  if (rawTasks.length > 8) throw new PlannerError(`planner returned ${rawTasks.length} tasks (max 8)`)

  const tasks: TaskRecord[] = rawTasks.map((raw, i) => {
    const worker = typeof raw.worker === 'string' ? (raw.worker.toLowerCase() as WorkerKind) : undefined
    if (!worker || !WORKER_KINDS.includes(worker)) {
      throw new PlannerError(`task ${i + 1} has unknown worker "${String(raw.worker)}"`)
    }
    const goal = typeof raw.goal === 'string' ? raw.goal.trim() : ''
    if (!goal) throw new PlannerError(`task ${i + 1} has no goal`)

    const outputs = asStringArray(raw.outputs)
    if (!outputs.length) throw new PlannerError(`task ${i + 1} ("${goal}") declares no output artifact`)

    return {
      id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : makeTaskId(i + 1),
      type: worker,
      goal,
      inputs: {},
      outputs,
      acceptance: parseAcceptance(raw.acceptance),
      dependsOn: asStringArray(raw.dependsOn),
      status: 'pending',
      worker,
      limits,
      retries: 0,
      stepsUsed: 0,
      costUsd: 0,
      artifactIds: [],
    }
  })

  const ids = new Set(tasks.map((t) => t.id))
  if (ids.size !== tasks.length) throw new PlannerError('planner returned duplicate task ids')

  for (const t of tasks) {
    const dangling = t.dependsOn.filter((d) => !ids.has(d))
    if (dangling.length) throw new PlannerError(`${t.id} depends on unknown task(s): ${dangling.join(', ')}`)
    if (t.dependsOn.includes(t.id)) throw new PlannerError(`${t.id} depends on itself`)
  }
  if (hasCycle(tasks)) throw new PlannerError('planner returned a dependency cycle')

  return tasks
}

function toPlanResult(
  goal: string,
  tasks: TaskRecord[],
  limits: TaskLimits,
  budget: ProjectBudget,
): PlanResult {
  let project = createProject(goal, limits, budget)
  project = { ...project, tasks }
  project = logEvent(project, {
    action: 'create_task',
    worker: 'planner',
    detail: `LLM task graph: ${tasks.length} tasks — ${tasks.map((t) => t.worker).join(' → ')}`,
  })

  const contracts = tasks.flatMap((t) =>
    t.outputs.map((path) => ({
      taskId: t.id,
      path,
      kind: path.endsWith('.json')
        ? ('json' as const)
        : path.endsWith('.html')
          ? ('html' as const)
          : path.endsWith('.csv')
            ? ('csv' as const)
            : ('markdown' as const),
      title: path.split('/').pop() ?? path,
    })),
  )
  return { project, contracts }
}

/**
 * Plan with a model when one is available, else the heuristic planner.
 * In strict mode a planner failure is an outcome, not a downgrade.
 */
export async function planProjectSmart(
  rawGoal: string,
  brain?: PlannerBrain | null,
  limits: TaskLimits = DEFAULT_LIMITS,
  budget: ProjectBudget = DEFAULT_BUDGET,
): Promise<PlanResult> {
  const goal = stripWorkspacePrompt(rawGoal)

  const degrade = (reason: string): PlanResult => {
    if (isStrict()) throw new PlannerError(blockedMessage('planner_unreachable', 'task-planner', reason))
    return planProject(rawGoal, limits)
  }

  if (!brain?.key || !brain.baseUrl || !brain.model) return degrade('no planner provider configured')

  let raw: string
  try {
    raw = await chat(brain, SYSTEM_PROMPT, `Goal: "${goal}"`)
  } catch (err) {
    return degrade(err instanceof Error ? err.message : String(err))
  }

  try {
    return toPlanResult(goal, validatePlan(extractJson(raw), limits), limits, budget)
  } catch (err) {
    return degrade(err instanceof Error ? err.message : String(err))
  }
}
