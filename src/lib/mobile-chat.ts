import type { ToolCall, TraceLine } from './agent'
import type { CrewArtifact } from './crew'
import { DEFAULT_BUDGET, ZERO_SPEND, type ProjectSnapshot } from './task-ledger'
import { parseWorkspaceSpace, type WorkspaceSpace } from './workspace'

export const MOBILE_THREADS_KEY = 'openmind-mobile-threads-v1'

export interface CrewRunSummary {
  employeeIds: string[]
  memberNames: string[]
  artifacts: CrewArtifact[]
  project?: ProjectSnapshot
}

export interface MobileMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  attachmentName?: string
  trace?: TraceLine[]
  toolCalls?: ToolCall[]
  crewRun?: CrewRunSummary
  /** Set when this message tracks a queued background run, so it updates in place. */
  runId?: string
}

export interface MobileThread {
  id: string
  title: string
  employeeId: string
  messages: MobileMessage[]
  updatedAt: number
  workspace?: WorkspaceSpace
}

export function isCrewArtifact(value: unknown): value is CrewArtifact {
  if (!value || typeof value !== 'object') return false
  const artifact = value as Partial<CrewArtifact>
  return (
    typeof artifact.id === 'string' &&
    (artifact.kind === 'markdown' || artifact.kind === 'html') &&
    typeof artifact.title === 'string' &&
    typeof artifact.body === 'string'
  )
}

export function parseProjectSnapshot(value: unknown): ProjectSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined
  const p = value as Partial<ProjectSnapshot>
  if (typeof p.id !== 'string' || typeof p.goal !== 'string' || !Array.isArray(p.tasks) || !Array.isArray(p.artifacts)) return undefined
  return {
    id: p.id,
    goal: p.goal,
    tasks: p.tasks as ProjectSnapshot['tasks'],
    artifacts: p.artifacts as ProjectSnapshot['artifacts'],
    blockers: Array.isArray(p.blockers) ? p.blockers.filter((b): b is string => typeof b === 'string') : [],
    finished: p.finished === true,
    handoffs: Array.isArray(p.handoffs) ? p.handoffs : [],
    // Snapshots persisted before budgets existed carry neither field.
    spend: p.spend ?? { ...ZERO_SPEND },
    budget: p.budget ?? DEFAULT_BUDGET,
    budgetBreach: p.budgetBreach,
  }
}

export function parseCrewRun(value: unknown): CrewRunSummary | undefined {
  if (!value || typeof value !== 'object') return undefined
  const run = value as Partial<CrewRunSummary>
  if (!Array.isArray(run.employeeIds) || !run.employeeIds.every((id) => typeof id === 'string')) return undefined
  if (!Array.isArray(run.memberNames) || !run.memberNames.every((name) => typeof name === 'string')) return undefined
  if (!Array.isArray(run.artifacts) || !run.artifacts.every(isCrewArtifact)) return undefined
  const project = run.project ? parseProjectSnapshot(run.project) : undefined
  return {
    employeeIds: run.employeeIds,
    memberNames: run.memberNames,
    artifacts: run.artifacts,
    project,
  }
}

export function makeId(prefix = 'item'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function createMobileThread(employeeId = 'openmind', now = Date.now()): MobileThread {
  return {
    id: makeId('thread'),
    title: 'New session',
    employeeId,
    messages: [],
    updatedAt: now,
  }
}

export function titleFromPrompt(prompt: string, maxLength = 42): string {
  const clean = prompt.replace(/\s+/g, ' ').trim()
  if (!clean) return 'New session'
  if (clean.length <= maxLength) return clean
  return `${clean.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
}

export function sortMobileThreads(threads: MobileThread[]): MobileThread[] {
  return [...threads].sort((a, b) => b.updatedAt - a.updatedAt)
}

function isMessage(value: unknown): value is MobileMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<MobileMessage>
  return (
    typeof message.id === 'string' &&
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string' &&
    typeof message.createdAt === 'number'
  )
}

function isThread(value: unknown): value is MobileThread {
  if (!value || typeof value !== 'object') return false
  const thread = value as Partial<MobileThread>
  return (
    typeof thread.id === 'string' &&
    typeof thread.title === 'string' &&
    typeof thread.employeeId === 'string' &&
    typeof thread.updatedAt === 'number' &&
    Array.isArray(thread.messages) &&
    thread.messages.every(isMessage)
  )
}

export function parseMobileThreads(raw: string | null): MobileThread[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return sortMobileThreads(
      parsed.filter(isThread).map((thread) => ({
        ...thread,
        workspace: parseWorkspaceSpace(thread.workspace),
        messages: thread.messages.map((message) => {
          const crewRun = parseCrewRun(message.crewRun)
          return crewRun ? { ...message, crewRun } : { ...message, crewRun: undefined }
        }),
      })),
    )
  } catch {
    return []
  }
}
