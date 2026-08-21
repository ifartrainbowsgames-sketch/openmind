/**
 * Memory as a kernel service.
 *
 * Before this, memory was a *tool*. `memory_search` and `memory_save` were in
 * two workers' tool lists, and `task-runner` never touched memory at all — so
 * whether a project remembered anything depended on whether a language model
 * decided to call a tool. That is the inverse of what it should be, and it
 * breaks the moment there is more than one runtime: a Claude Code worker, a
 * Codex worker and the builtin worker each bring their own private notion of
 * "what I remember", and OpenMind has nothing authoritative to hand them.
 *
 * So the split is:
 *
 *   kernel service   automatic context before a task, automatic recording
 *                    after it. Every runtime gets the same project facts.
 *   explicit tools   an agent that wants to look further can still search.
 *                    Reclassified, not deleted — they now read the same
 *                    canonical memory the kernel builds context from.
 *
 * The entry model is `memory-layers.ts`, which was already the right design
 * and was simply unreachable. Nothing about it changes here except its
 * position: it is now what the orchestrator writes, rather than an idea.
 *
 * ## Why these signatures return a book
 *
 * The specified interface was `recordOutcome(...): Promise<void>` over a store
 * the service owns. `ProjectState` is immutable and threaded through a
 * LangGraph reducer, so a service holding its own copy beside the ledger would
 * be a second source of truth for the same facts — the exact shape of problem
 * this consolidation exists to remove. The book is therefore part of the
 * ledger, and these functions take and return it. The service still owns
 * *policy*: what is worth remembering, what supersedes what, what reaches a
 * prompt.
 */

import type { OpenMindEvent } from './events'
import {
  RECALL_LIMITS, priorFailures, recall, remember, renderMemory,
  type MemoryBook, type MemoryEntry, type MemoryKind, type MemoryLayer,
} from './memory-layers'
import type { RunResult } from '../agent'
import type {
  ArtifactRecord, JudgeVerdict, ProjectState, TaskRecord, WorkerKind,
} from '../task-ledger'

export interface MemoryContext {
  /** Rendered for the prompt, widest and most stable context first. */
  text: string
  /** What went in, so a caller can assert on content rather than prose. */
  entries: MemoryEntry[]
  /** Failures already recorded against this task — a retry must not repeat them. */
  priorFailures: MemoryEntry[]
}

export interface MemoryQuery {
  text?: string
  layers?: readonly MemoryLayer[]
  kinds?: readonly MemoryKind[]
  limit?: number
}

export interface ConsolidationResult {
  book: MemoryBook
  before: number
  after: number
  /** Entries dropped because something later replaced them. */
  superseded: number
}

export interface BuildContextInput {
  book: MemoryBook
  projectId: string
  task: TaskRecord
  worker: WorkerKind
}

export interface RecordOutcomeInput {
  book: MemoryBook
  projectId: string
  task: TaskRecord
  /** Absent when the runtime returned nothing — itself worth recording. */
  result?: RunResult
  artifacts: readonly ArtifactRecord[]
  /** The judge's decision, when the task has been validated. */
  verdict?: JudgeVerdict
  events?: readonly OpenMindEvent[]
}

export interface MemoryService {
  buildContext(input: BuildContextInput): Promise<MemoryContext>
  recordOutcome(input: RecordOutcomeInput): Promise<MemoryBook>
  search(book: MemoryBook, query: MemoryQuery): Promise<MemoryEntry[]>
  consolidate(book: MemoryBook): ConsolidationResult
}

/**
 * Cross-project preferences. Kept behind a function because the user layer
 * lives in a different store (the account's saved notes) from the project
 * layer (the ledger), and only the project layer is guaranteed present.
 */
export type UserLayerReader = () => Promise<MemoryEntry[]>

export interface MemoryServiceDeps {
  userLayer?: UserLayerReader
}

const NOTHING: UserLayerReader = async () => []

/**
 * The account's saved notes, as user-layer entries.
 *
 * This is what reclassifies `memory_save`: a note the agent stored on the
 * user's behalf becomes canonical context every later task receives, rather
 * than something only a worker that happens to call `memory_search` will see.
 */
export function accountUserLayer(): UserLayerReader {
  return async () => {
    const { listMemories } = await import('../memory')
    const rows = await listMemories('user', RECALL_LIMITS.user)
    return rows.map((row) => ({
      id: `user-${row.id}`,
      layer: 'user' as const,
      kind: 'preference' as const,
      text: row.content,
      createdAt: row.createdAt,
    }))
  }
}

export function createMemoryService(deps: MemoryServiceDeps = {}): MemoryService {
  const userLayer = deps.userLayer ?? NOTHING

  return {
    async buildContext(input) {
      const user = await userLayer().catch(() => [] as MemoryEntry[])
      // The user layer is not in the book — it belongs to the account, not the
      // project — so it is merged for rendering only.
      const merged: MemoryBook = { entries: [...input.book.entries, ...user] }

      const failures = priorFailures(merged, input.task.id)
      const entries = [
        ...recall(merged, 'user'),
        ...recall(merged, 'project'),
        ...recall(merged, 'task'),
      ]

      return {
        text: renderMemory(merged),
        entries,
        priorFailures: failures,
      }
    },

    async recordOutcome(input) {
      return extractOutcome(input)
    },

    async search(book, query) {
      const user = query.layers && !query.layers.includes('user')
        ? []
        : await userLayer().catch(() => [] as MemoryEntry[])
      return searchEntries({ entries: [...book.entries, ...user] }, query)
    },

    consolidate(book) {
      return consolidateBook(book)
    },
  }
}

// ── Policy: what is worth remembering ───────────────────────────────────────

/**
 * Turn one finished task into memory.
 *
 * Deliberately narrow. Everything recorded here is something a *later* worker
 * would otherwise re-derive or repeat, which is the only test that keeps a
 * memory layer from becoming a transcript.
 */
export function extractOutcome(input: RecordOutcomeInput): MemoryBook {
  const { task, verdict, result, artifacts } = input
  let book = input.book
  const source = task.id

  const add = (kind: MemoryKind, text: string, extra: { supersedes?: string[] } = {}) => {
    const trimmed = text.trim().slice(0, 600)
    if (!trimmed) return
    // A retry re-produces the same artifacts; recording them again would make
    // the recall budget a list of duplicates.
    const already = book.entries.some(
      (e) => e.layer === 'project' && e.kind === kind && e.text === trimmed,
    )
    if (already) return
    book = remember(book, { layer: 'project', kind, text: trimmed, source, ...extra })
  }

  if (verdict?.passed) {
    // A passing attempt replaces the failures recorded for the same task.
    // Superseded entries stop being recalled, so a fixed task does not keep
    // warning later workers about a problem that no longer exists.
    const stale = priorFailures(book, source).map((e) => e.id)
    add('decision', `${task.goal} → ${task.outputs.join(', ')}`, { supersedes: stale })
  } else if (verdict) {
    add('failure', verdict.problems.join('; ') || 'rejected by the judge')
  }

  for (const artifact of artifacts) {
    if (artifact.taskId !== task.id) continue
    add('finding', `${artifact.path}${artifact.sources ? ` — ${artifact.sources} sources` : ''}`)
  }

  // A blocked capability is a fact about the project, not about the attempt.
  // Recording it stops three later workers from each discovering that Slack is
  // not connected.
  const blocked = new Set(
    (result?.toolCalls ?? [])
      .filter((c) => c.error?.kind === 'blocked')
      .map((c) => `${c.tool} unavailable: ${c.error?.message ?? 'not connected'}`),
  )
  for (const text of blocked) add('constraint', text)

  if (!result && !verdict) add('failure', 'the runtime returned no result')

  return book
}

export function searchEntries(book: MemoryBook, query: MemoryQuery): MemoryEntry[] {
  const needle = query.text?.trim().toLowerCase()
  const dead = new Set(book.entries.flatMap((e) => e.supersedes ?? []))
  return book.entries
    .filter((e) => !dead.has(e.id))
    .filter((e) => !query.layers || query.layers.includes(e.layer))
    .filter((e) => !query.kinds || query.kinds.includes(e.kind))
    .filter((e) => !needle || e.text.toLowerCase().includes(needle))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, query.limit ?? 8)
}

/**
 * Drop what nothing will ever recall again.
 *
 * Only superseded entries and the task layer are removed. Trimming by age or
 * count would silently delete a constraint that is still true — and a
 * constraint nobody remembers is one every future worker rediscovers the hard
 * way.
 */
export function consolidateBook(book: MemoryBook): ConsolidationResult {
  const before = book.entries.length
  const dead = new Set(book.entries.flatMap((e) => e.supersedes ?? []))
  const entries = book.entries.filter((e) => !dead.has(e.id) && e.layer !== 'task')
  return {
    book: { entries },
    before,
    after: entries.length,
    superseded: book.entries.filter((e) => dead.has(e.id)).length,
  }
}

/**
 * The book a project starts a run with.
 *
 * Projects created before memory existed carry their established context in
 * `decisions` and `evidence` — plain string arrays rendered straight into the
 * prompt. Seeding from them once means resuming such a project does not look
 * like a project that has never established anything.
 */
export function initialBook(project: ProjectState): MemoryBook {
  if (project.memory?.entries.length) return project.memory

  let book: MemoryBook = project.memory ?? { entries: [] }
  for (const decision of project.decisions.slice(-RECALL_LIMITS.project)) {
    book = remember(book, { layer: 'project', kind: 'decision', text: decision })
  }
  for (const source of project.evidence.slice(-RECALL_LIMITS.project)) {
    book = remember(book, { layer: 'project', kind: 'finding', text: `source: ${source}` })
  }
  return book
}
