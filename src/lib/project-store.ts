// Project persistence — the task ledger outlives the tab.
// Local-first, same shape as ./memory: every write lands in localStorage
// immediately, and mirrors to Postgres when the user is signed in with
// Supabase configured. A cloud failure degrades to local, never to silence —
// and in strict mode a failed cloud write is reported rather than swallowed.

import { isStrict } from './execution-mode'
import {
  DEFAULT_BUDGET,
  ZERO_SPEND,
  type ArtifactRecord,
  type ProjectState,
  type TaskRecord,
} from './task-ledger'

export interface SaveOutcome {
  local: boolean
  cloud: boolean
  error?: string
}

let projectOwner = 'anon'

export function setProjectOwner(userId: string | undefined): void {
  projectOwner = userId?.trim() || 'anon'
}

export function getProjectOwner(): string {
  return projectOwner
}

const MAX_LOCAL_PROJECTS = 25

function localKey(): string {
  return `om-projects:${projectOwner}`
}

const ram: Record<string, ProjectState[]> = {}

function readLocal(): ProjectState[] {
  if (typeof localStorage === 'undefined') return ram[projectOwner] ?? []
  try {
    const raw = JSON.parse(localStorage.getItem(localKey()) ?? '[]') as unknown
    return Array.isArray(raw) ? (raw as ProjectState[]).map(hydrate) : []
  } catch {
    return []
  }
}

function writeLocal(rows: ProjectState[]): void {
  const next = rows.slice(0, MAX_LOCAL_PROJECTS)
  ram[projectOwner] = next
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(localKey(), JSON.stringify(next))
  } catch {
    // Quota exceeded — drop the oldest half and retry once. Artifact bodies are
    // large, so a long-lived account will hit this eventually.
    const trimmed = next.slice(0, Math.ceil(next.length / 2))
    ram[projectOwner] = trimmed
    try {
      localStorage.setItem(localKey(), JSON.stringify(trimmed))
    } catch {
      /* give up on local; the cloud copy is the durable one */
    }
  }
}

/** Fill fields added after a project was persisted. */
export function hydrate(p: ProjectState): ProjectState {
  return {
    ...p,
    requirements: p.requirements ?? [],
    tasks: p.tasks ?? [],
    artifacts: p.artifacts ?? [],
    evidence: p.evidence ?? [],
    decisions: p.decisions ?? [],
    blockers: p.blockers ?? [],
    events: p.events ?? [],
    budget: p.budget ?? DEFAULT_BUDGET,
    // Projects persisted before memory existed carry their context in
    // decisions/evidence; the memory service seeds from those on first run.
    memory: p.memory ?? { entries: [] },
    spend: p.spend ?? { ...ZERO_SPEND },
  }
}

async function cloudSession(): Promise<{ id: string } | null> {
  if (typeof window === 'undefined') return null
  const { getSession } = await import('./auth')
  const { isSupabaseConfigured } = await import('./supabase')
  const session = await getSession()
  if (!session?.user.id) return null
  setProjectOwner(session.user.id)
  if (session.demo || !isSupabaseConfigured) return null
  return { id: session.user.id }
}

function taskRow(userId: string, projectId: string, t: TaskRecord) {
  return {
    id: t.id,
    project_id: projectId,
    user_id: userId,
    goal: t.goal,
    worker: t.worker,
    status: t.status,
    depends_on: t.dependsOn,
    outputs: t.outputs,
    acceptance: t.acceptance ?? null,
    verdict: t.verdict ?? null,
    blocker: t.blocker ?? null,
    retries: t.retries,
    steps_used: t.stepsUsed,
    cost_usd: t.costUsd,
  }
}

function artifactRow(userId: string, projectId: string, a: ArtifactRecord) {
  return {
    id: a.id,
    project_id: projectId,
    user_id: userId,
    task_id: a.taskId,
    path: a.path,
    kind: a.kind,
    title: a.title,
    body: a.body,
    worker: a.worker,
    sources: a.sources ?? null,
    confidence: a.confidence ?? null,
  }
}

/** Persist a project and its tasks/artifacts. Local always; cloud when signed in. */
export async function saveProject(project: ProjectState): Promise<SaveOutcome> {
  const others = readLocal().filter((p) => p.id !== project.id)
  writeLocal([project, ...others])

  const user = await cloudSession()
  if (!user) return { local: true, cloud: false }

  try {
    const { supabase } = await import('./supabase')
    const { error: pErr } = await supabase.from('agent_projects').upsert({
      id: project.id,
      user_id: user.id,
      goal: project.goal,
      requirements: project.requirements,
      evidence: project.evidence,
      decisions: project.decisions,
      blockers: project.blockers,
      budget: project.budget,
      spend: project.spend,
      final_output: project.finalOutput ?? null,
      started_at: new Date(project.startedAt).toISOString(),
      finished_at: project.finishedAt ? new Date(project.finishedAt).toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    if (pErr) throw new Error(pErr.message)

    if (project.tasks.length) {
      const { error } = await supabase
        .from('agent_tasks')
        .upsert(project.tasks.map((t) => taskRow(user.id, project.id, t)))
      if (error) throw new Error(error.message)
    }
    if (project.artifacts.length) {
      const { error } = await supabase
        .from('agent_artifacts')
        .upsert(project.artifacts.map((a) => artifactRow(user.id, project.id, a)))
      if (error) throw new Error(error.message)
    }
    return { local: true, cloud: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Strict mode surfaces the degradation; demo mode keeps the local copy and
    // moves on, which is the same tradeoff ./memory makes.
    if (isStrict()) throw new Error(`project persistence failed: ${message}`)
    return { local: true, cloud: false, error: message }
  }
}

/** Most recent projects, newest first. Cloud when available, else local. */
export async function listProjects(limit = 10): Promise<ProjectState[]> {
  const user = await cloudSession()
  if (user) {
    try {
      const { supabase } = await import('./supabase')
      const { data, error } = await supabase
        .from('agent_projects')
        .select('id')
        .order('started_at', { ascending: false })
        .limit(limit)
      if (!error && data) {
        const loaded = await Promise.all(data.map((r) => loadProject(r.id as string)))
        const hits = loaded.filter((p): p is ProjectState => !!p)
        if (hits.length) return hits
      }
    } catch {
      /* fall through to local */
    }
  }
  return readLocal().slice(0, limit)
}

/** One project with its tasks and artifacts reassembled. */
export async function loadProject(id: string): Promise<ProjectState | undefined> {
  const user = await cloudSession()
  if (user) {
    try {
      const { supabase } = await import('./supabase')
      const [{ data: pRows }, { data: tRows }, { data: aRows }] = await Promise.all([
        supabase.from('agent_projects').select('*').eq('id', id).limit(1),
        supabase.from('agent_tasks').select('*').eq('project_id', id),
        supabase.from('agent_artifacts').select('*').eq('project_id', id),
      ])
      const row = pRows?.[0] as Record<string, unknown> | undefined
      if (row) return assembleProject(row, tRows ?? [], aRows ?? [])
    } catch {
      /* fall through to local */
    }
  }
  return readLocal().find((p) => p.id === id)
}

function assembleProject(
  row: Record<string, unknown>,
  tRows: unknown[],
  aRows: unknown[],
): ProjectState {
  const tasks = (tRows as Record<string, unknown>[]).map((t): TaskRecord => ({
    id: String(t.id),
    type: t.worker as TaskRecord['type'],
    goal: String(t.goal),
    inputs: {},
    outputs: (t.outputs as string[]) ?? [],
    acceptance: (t.acceptance as TaskRecord['acceptance']) ?? undefined,
    dependsOn: (t.depends_on as string[]) ?? [],
    status: t.status as TaskRecord['status'],
    worker: t.worker as TaskRecord['worker'],
    limits: { maxSteps: 15, maxRetries: 3, maxDelegations: 2, maxCostUsd: 0.5 },
    retries: Number(t.retries ?? 0),
    stepsUsed: Number(t.steps_used ?? 0),
    costUsd: Number(t.cost_usd ?? 0),
    artifactIds: (aRows as Record<string, unknown>[])
      .filter((a) => a.task_id === t.id)
      .map((a) => String(a.id)),
    blocker: (t.blocker as string | null) ?? undefined,
    verdict: (t.verdict as TaskRecord['verdict']) ?? undefined,
  }))

  const artifacts = (aRows as Record<string, unknown>[]).map((a): ArtifactRecord => ({
    id: String(a.id),
    path: String(a.path),
    kind: a.kind as ArtifactRecord['kind'],
    title: String(a.title),
    body: String(a.body),
    taskId: String(a.task_id),
    worker: a.worker as ArtifactRecord['worker'],
    sources: a.sources == null ? undefined : Number(a.sources),
    confidence: a.confidence == null ? undefined : Number(a.confidence),
    createdAt: a.created_at ? Date.parse(String(a.created_at)) : Date.now(),
  }))

  return hydrate({
    id: String(row.id),
    goal: String(row.goal),
    requirements: (row.requirements as string[]) ?? [],
    tasks,
    artifacts,
    evidence: (row.evidence as string[]) ?? [],
    decisions: (row.decisions as string[]) ?? [],
    blockers: (row.blockers as string[]) ?? [],
    events: [],
    limits: { maxSteps: 15, maxRetries: 3, maxDelegations: 2, maxCostUsd: 0.5 },
    budget: (row.budget as ProjectState['budget']) ?? DEFAULT_BUDGET,
    spend: (row.spend as ProjectState['spend']) ?? { ...ZERO_SPEND },
    finalOutput: (row.final_output as string | null) ?? undefined,
    startedAt: row.started_at ? Date.parse(String(row.started_at)) : Date.now(),
    finishedAt: row.finished_at ? Date.parse(String(row.finished_at)) : undefined,
  })
}

/** Read one artifact by path — the cross-task lookup the ledger always implied. */
export async function readArtifact(projectId: string, path: string): Promise<ArtifactRecord | undefined> {
  const project = await loadProject(projectId)
  return project?.artifacts.find((a) => a.path === path)
}

export async function deleteProject(id: string): Promise<void> {
  writeLocal(readLocal().filter((p) => p.id !== id))
  const user = await cloudSession()
  if (!user) return
  try {
    const { supabase } = await import('./supabase')
    // Tasks and artifacts cascade from the project row.
    await supabase.from('agent_projects').delete().eq('id', id)
  } catch {
    /* local delete already happened */
  }
}
