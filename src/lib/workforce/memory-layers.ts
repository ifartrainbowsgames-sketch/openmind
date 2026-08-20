/**
 * Three memory layers, kept apart on purpose.
 *
 *   TASK    — this task's working state. Dies with the task.
 *   PROJECT — findings, decisions, constraints, past failures. Lives as long
 *             as the project.
 *   USER    — preferences and conventions. Lives across projects.
 *
 * The tempting alternative is one vector store holding every message, queried
 * by similarity. That fails in a specific way: the most *similar* text to
 * "should I use pnpm" is a previous discussion about pnpm, including the wrong
 * conclusion someone later corrected. Similarity does not know which memory is
 * still true.
 *
 * So memory here is structured and typed, entries supersede rather than
 * accumulate, and each layer has a budget — because a prompt full of
 * remembered context is a prompt with no room to think.
 */

export type MemoryLayer = 'task' | 'project' | 'user'

export type MemoryKind =
  | 'finding'      // something established from evidence
  | 'decision'     // a choice made, with its reason
  | 'constraint'   // a limit that must be respected
  | 'failure'      // something tried that did not work
  | 'preference'   // how this user likes things done

export interface MemoryEntry {
  id: string
  layer: MemoryLayer
  kind: MemoryKind
  text: string
  /** Where it came from — a task id, an artifact path, or the user. */
  source?: string
  /** Entry ids this replaces. Superseded entries stop being recalled. */
  supersedes?: string[]
  createdAt: number
}

export interface MemoryBook {
  entries: MemoryEntry[]
}

export function emptyMemory(): MemoryBook {
  return { entries: [] }
}

/** How many entries of each layer reach a prompt. Small on purpose. */
export const RECALL_LIMITS: Readonly<Record<MemoryLayer, number>> = {
  task: 8,
  project: 10,
  user: 6,
}

export function remember(
  book: MemoryBook,
  entry: Omit<MemoryEntry, 'id' | 'createdAt'>,
  now = Date.now(),
): MemoryBook {
  const id = `mem-${book.entries.length + 1}-${now.toString(36)}`
  return { entries: [...book.entries, { ...entry, id, createdAt: now }] }
}

/** Ids made obsolete by a later entry. */
function supersededIds(entries: readonly MemoryEntry[]): Set<string> {
  const out = new Set<string>()
  for (const entry of entries) {
    for (const id of entry.supersedes ?? []) out.add(id)
  }
  return out
}

/**
 * Live entries for one layer, newest first, capped.
 *
 * Superseded entries are dropped rather than ranked down. A corrected decision
 * that still appears — even in third place — is a decision the model may act
 * on, and "we decided X" followed by "actually not X" reads as ambiguity when
 * it is not.
 */
export function recall(
  book: MemoryBook,
  layer: MemoryLayer,
  limit = RECALL_LIMITS[layer],
): MemoryEntry[] {
  const dead = supersededIds(book.entries)
  return book.entries
    .filter((e) => e.layer === layer && !dead.has(e.id))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
}

export function forget(book: MemoryBook, id: string): MemoryBook {
  return { entries: book.entries.filter((e) => e.id !== id) }
}

/** Drop a task's working state once it is done. */
export function clearLayer(book: MemoryBook, layer: MemoryLayer): MemoryBook {
  return { entries: book.entries.filter((e) => e.layer !== layer) }
}

const LAYER_HEADINGS: Readonly<Record<MemoryLayer, string>> = {
  user: 'HOW THIS USER WORKS',
  project: 'ESTABLISHED IN THIS PROJECT — do not re-derive',
  task: 'YOUR WORKING NOTES',
}

const KIND_PREFIX: Readonly<Record<MemoryKind, string>> = {
  finding: 'Found',
  decision: 'Decided',
  constraint: 'Constraint',
  failure: 'Failed',
  preference: 'Prefers',
}

/**
 * Render for a prompt. Ordered user → project → task: the widest and most
 * stable context first, the most volatile last and therefore closest to the
 * instruction it modifies.
 */
export function renderMemory(book: MemoryBook, layers: MemoryLayer[] = ['user', 'project', 'task']): string {
  const blocks: string[] = []
  for (const layer of layers) {
    const entries = recall(book, layer)
    if (!entries.length) continue
    blocks.push(
      [
        LAYER_HEADINGS[layer],
        ...entries.map((e) => `- ${KIND_PREFIX[e.kind]}: ${e.text}${e.source ? ` (${e.source})` : ''}`),
      ].join('\n'),
    )
  }
  return blocks.join('\n\n')
}

/**
 * Past failures for a specific task, so a retry does not repeat them. Kept
 * separate from `recall` because failures are the one category worth surfacing
 * even when the layer budget is already full.
 */
export function priorFailures(book: MemoryBook, source: string): MemoryEntry[] {
  const dead = supersededIds(book.entries)
  return book.entries.filter((e) => e.kind === 'failure' && e.source === source && !dead.has(e.id))
}
