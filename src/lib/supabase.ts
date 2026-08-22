import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = (import.meta.env.VITE_SUPABASE_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) as string

export const isSupabaseConfigured = Boolean(url && key)
export const SUPABASE_URL = (url as string | undefined) ?? null
export const SUPABASE_KEY = (key as string | undefined) ?? null

if (!isSupabaseConfigured) {
  console.warn('Supabase env vars missing — auth runs in demo mode (browser-local).')
}

const REMEMBER_KEY = 'om-remember'

function browserStore(which: 'local' | 'session'): Storage | null {
  if (typeof globalThis === 'undefined') return null
  const store = which === 'local' ? globalThis.localStorage : globalThis.sessionStorage
  return typeof store === 'undefined' ? null : store
}

/** In-memory fallback so Node tests and the worker can import this module. */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear() {
      map.clear()
    },
    key(i) {
      return [...map.keys()][i] ?? null
    },
    getItem(k) {
      return map.get(k) ?? null
    },
    setItem(k, v) {
      map.set(k, String(v))
    },
    removeItem(k) {
      map.delete(k)
    },
  }
}

const memory = memoryStorage()

export function getRemember(): boolean {
  const store = browserStore('local') ?? memory
  return store.getItem(REMEMBER_KEY) !== '0' // default: remember
}

export function setRemember(on: boolean) {
  const store = browserStore('local') ?? memory
  store.setItem(REMEMBER_KEY, on ? '1' : '0')
}

// Remember-me aware storage: the session lands in localStorage when the user
// asked to be remembered, sessionStorage (tab-lifetime) otherwise. The flag is
// read per access, so the choice made on the login form applies immediately.
// Under Node there is no window storage — supabase-js still loads a session
// on createClient, so we must not throw.
const rememberStorage: Storage = {
  get length() {
    const local = browserStore('local')
    const session = browserStore('session')
    if (!local && !session) return memory.length
    return (getRemember() ? local ?? memory : session ?? memory).length
  },
  clear() {
    /* never called by supabase-js */
  },
  key: (i) => {
    const local = browserStore('local')
    const session = browserStore('session')
    if (!local && !session) return memory.key(i)
    return (getRemember() ? local ?? memory : session ?? memory).key(i)
  },
  getItem: (k) => {
    const local = browserStore('local')
    const session = browserStore('session')
    if (!local && !session) return memory.getItem(k)
    return local?.getItem(k) ?? session?.getItem(k) ?? null
  },
  setItem: (k, v) => {
    const local = browserStore('local')
    const session = browserStore('session')
    if (!local && !session) return memory.setItem(k, v)
    ;(getRemember() ? local ?? memory : session ?? memory).setItem(k, v)
  },
  removeItem: (k) => {
    const local = browserStore('local')
    const session = browserStore('session')
    if (!local && !session) return memory.removeItem(k)
    local?.removeItem(k)
    session?.removeItem(k)
  },
}

export const supabase = createClient(url ?? 'https://placeholder.supabase.co', key ?? 'placeholder', {
  auth: { storage: rememberStorage, persistSession: true, autoRefreshToken: true },
})
