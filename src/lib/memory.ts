// User / project / ephemeral notes. Postgres + FTS when signed in; RAM/localStorage otherwise.
export type MemoryScope = 'user' | 'project' | 'ephemeral'

export interface AgentMemory {
  id: string
  scope: MemoryScope
  content: string
  threadId?: string
  createdAt: number
}

let memoryOwner = 'anon'
const ram: Record<string, AgentMemory[]> = {}

export function setMemoryOwner(userId: string | undefined): void {
  memoryOwner = userId?.trim() || 'anon'
}

export function getMemoryOwner(): string {
  return memoryOwner
}

function localKey(): string {
  return `om-agent-memory:${memoryOwner}`
}

function readLocal(): AgentMemory[] {
  if (typeof localStorage === 'undefined') return ram[memoryOwner] ?? []
  try {
    const raw = JSON.parse(localStorage.getItem(localKey()) ?? '[]') as AgentMemory[]
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function writeLocal(rows: AgentMemory[]): void {
  const next = rows.slice(-80)
  ram[memoryOwner] = next
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(localKey(), JSON.stringify(next))
}

function parseScope(input: string): { scope: MemoryScope; content: string } {
  const rec = input.trim().startsWith('{')
    ? (() => {
        try {
          return JSON.parse(input) as Record<string, unknown>
        } catch {
          return null
        }
      })()
    : null
  if (rec && typeof rec.content === 'string') {
    const scope = rec.scope === 'project' || rec.scope === 'ephemeral' ? rec.scope : 'user'
    return { scope, content: rec.content.trim().slice(0, 4000) }
  }
  return { scope: 'user', content: input.trim().slice(0, 4000) }
}

async function cloudSession(): Promise<{ id: string } | null> {
  if (typeof window === 'undefined') return null
  const { getSession } = await import('./auth')
  const { isSupabaseConfigured } = await import('./supabase')
  const session = await getSession()
  if (!session?.user.id) return null
  setMemoryOwner(session.user.id)
  if (session.demo || !isSupabaseConfigured) return null
  return { id: session.user.id }
}

export async function saveMemory(input: string, threadId?: string): Promise<string> {
  const { scope, content } = parseScope(input)
  if (!content) return '[memory_save] Nothing to store.'

  const row: AgentMemory = {
    id: `mem-${Date.now().toString(36)}`,
    scope,
    content,
    threadId,
    createdAt: Date.now(),
  }
  writeLocal([row, ...readLocal()])

  const user = await cloudSession()
  if (user) {
    const { supabase } = await import('./supabase')
    const { error } = await supabase.from('agent_memories').insert({
      user_id: user.id,
      scope,
      content,
      thread_id: threadId ?? null,
    })
    if (error) return `[memory_save] Saved on this device. Cloud skip: ${error.message}`
    return `[memory_save] Stored (${scope}) in your account.`
  }
  return `[memory_save] Stored (${scope}) on this device.`
}

/**
 * The saved notes, as records rather than a formatted string.
 *
 * `searchMemory` renders for a model; the memory kernel service needs the rows
 * so it can layer, rank and budget them alongside project memory. Same store,
 * two readers — not two stores.
 */
export async function listMemories(scope?: MemoryScope, limit = 8): Promise<AgentMemory[]> {
  const user = await cloudSession()
  if (user) {
    const { supabase } = await import('./supabase')
    let req = supabase
      .from('agent_memories')
      .select('id, content, scope, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (scope) req = req.eq('scope', scope)
    const { data, error } = await req
    if (!error && data?.length) {
      return data.map((r) => ({
        id: String(r.id),
        scope: (r.scope as MemoryScope) ?? 'user',
        content: String(r.content),
        createdAt: new Date(String(r.created_at)).getTime() || Date.now(),
      }))
    }
  }
  const local = readLocal()
  return (scope ? local.filter((m) => m.scope === scope) : local).slice(0, limit)
}

export async function searchMemory(query: string): Promise<string> {
  const q = query.trim().slice(0, 200)
  const user = await cloudSession()
  if (user) {
    const { supabase } = await import('./supabase')
    let req = supabase
      .from('agent_memories')
      .select('content, scope, created_at')
      .order('created_at', { ascending: false })
      .limit(8)
    if (q) req = req.ilike('content', `%${q.replace(/[%_]/g, '')}%`)
    const { data, error } = await req
    if (!error && data?.length) {
      return `[memory_search] ${data.map((r) => `(${r.scope}) ${r.content}`).join('\n')}`
    }
  }

  const local = readLocal()
  const hits = q
    ? local.filter((m) => m.content.toLowerCase().includes(q.toLowerCase()))
    : local.slice(0, 8)
  if (!hits.length) return '[memory_search] No saved notes yet. Ask me to remember something.'
  return `[memory_search] ${hits.slice(0, 8).map((m) => `(${m.scope}) ${m.content}`).join('\n')}`
}
