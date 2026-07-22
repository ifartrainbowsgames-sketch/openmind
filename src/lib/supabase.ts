import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_KEY as string

export const isSupabaseConfigured = Boolean(url && key)
export const SUPABASE_URL = (url as string | undefined) ?? null
export const SUPABASE_KEY = (key as string | undefined) ?? null

if (!isSupabaseConfigured) {
  console.warn('Supabase env vars missing — auth runs in demo mode (browser-local).')
}

const REMEMBER_KEY = 'om-remember'

export function getRemember(): boolean {
  return localStorage.getItem(REMEMBER_KEY) !== '0' // default: remember
}

export function setRemember(on: boolean) {
  localStorage.setItem(REMEMBER_KEY, on ? '1' : '0')
}

// Remember-me aware storage: the session lands in localStorage when the user
// asked to be remembered, sessionStorage (tab-lifetime) otherwise. The flag is
// read per access, so the choice made on the login form applies immediately.
const rememberStorage: Storage = {
  get length() {
    return (getRemember() ? localStorage : sessionStorage).length
  },
  clear() {
    /* never called by supabase-js */
  },
  key: (i) => (getRemember() ? localStorage : sessionStorage).key(i),
  getItem: (k) => localStorage.getItem(k) ?? sessionStorage.getItem(k),
  setItem: (k, v) => (getRemember() ? localStorage : sessionStorage).setItem(k, v),
  removeItem: (k) => {
    localStorage.removeItem(k)
    sessionStorage.removeItem(k)
  },
}

export const supabase = createClient(url ?? 'https://placeholder.supabase.co', key ?? 'placeholder', {
  auth: { storage: rememberStorage, persistSession: true, autoRefreshToken: true },
})
