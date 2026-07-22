// ── Auth service — live (Supabase) or demo (browser-local) ──────────────────
// When VITE_SUPABASE_URL/KEY are set, everything goes through Supabase Auth.
// Until then a clearly-labeled demo mode keeps the product usable: accounts and
// sessions live in the browser, and remember-me picks localStorage vs
// sessionStorage exactly like the live storage adapter does.

import { getRemember, isSupabaseConfigured, SUPABASE_KEY, SUPABASE_URL, supabase } from './supabase'

export type OAuthProvider = 'google' | 'discord' | 'github' | 'apple'

export const OAUTH_PROVIDERS: { id: OAuthProvider; name: string }[] = [
  { id: 'google', name: 'Google' },
  { id: 'discord', name: 'Discord' },
  { id: 'github', name: 'GitHub' },
  { id: 'apple', name: 'Apple' },
]

export const authMode: 'live' | 'demo' = isSupabaseConfigured ? 'live' : 'demo'

export interface AuthUser {
  id: string
  email: string
  via?: string
}

export interface AuthSession {
  user: AuthUser
  demo: boolean
}

export interface AuthResult {
  error?: string
  notice?: string
}

// ── demo-mode storage ────────────────────────────────────────────────────────

const DEMO_USERS_KEY = 'om-demo-users'
const DEMO_SESSION_KEY = 'om-demo-session'

/** demo-grade hash — NOT cryptographic, just avoids storing plaintext passwords */
export function demoHash(pw: string): string {
  let h = 5381
  for (let i = 0; i < pw.length; i++) h = ((h << 5) + h + pw.charCodeAt(i)) >>> 0
  return `dj${h.toString(16)}·${pw.length}`
}

function demoUsers(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(DEMO_USERS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function saveDemoUsers(users: Record<string, string>) {
  localStorage.setItem(DEMO_USERS_KEY, JSON.stringify(users))
}

const sessionStore = () => (getRemember() ? localStorage : sessionStorage)

function demoUser(email: string, via?: string): AuthUser {
  return { id: `demo-${demoHash(email)}`, email, via }
}

function setDemoSession(user: AuthUser | null) {
  if (user) sessionStore().setItem(DEMO_SESSION_KEY, JSON.stringify({ user, demo: true }))
  else {
    localStorage.removeItem(DEMO_SESSION_KEY)
    sessionStorage.removeItem(DEMO_SESSION_KEY)
  }
  notify()
}

function getDemoSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(DEMO_SESSION_KEY) ?? sessionStorage.getItem(DEMO_SESSION_KEY)
    return raw ? (JSON.parse(raw) as AuthSession) : null
  } catch {
    return null
  }
}

// ── subscription ─────────────────────────────────────────────────────────────

const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((cb) => cb())
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

// ── session ──────────────────────────────────────────────────────────────────

export async function getSession(): Promise<AuthSession | null> {
  if (authMode === 'demo') return getDemoSession()
  const { data } = await supabase.auth.getSession()
  const u = data.session?.user
  return u?.email ? { user: { id: u.id, email: u.email, via: u.app_metadata?.provider }, demo: false } : null
}

export async function signOut(): Promise<void> {
  if (authMode === 'demo') return setDemoSession(null)
  await supabase.auth.signOut()
  notify()
}

// ── email + password ─────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function signInEmail(email: string, password: string): Promise<AuthResult> {
  const e = email.trim().toLowerCase()
  if (!EMAIL_RE.test(e)) return { error: 'Enter a valid email address.' }
  if (!password) return { error: 'Password is required.' }

  if (authMode === 'demo') {
    const users = demoUsers()
    if (!users[e]) return { error: 'No account for this email — switch to Sign up first (demo mode).' }
    if (users[e] !== demoHash(password)) return { error: 'Wrong password for this account.' }
    setDemoSession(demoUser(e, 'email'))
    return {}
  }

  const { error } = await supabase.auth.signInWithPassword({ email: e, password })
  if (error) return { error: error.message }
  notify()
  return {}
}

export async function signUpEmail(email: string, password: string): Promise<AuthResult> {
  const e = email.trim().toLowerCase()
  if (!EMAIL_RE.test(e)) return { error: 'Enter a valid email address.' }
  if (password.length < 6) return { error: 'Password needs at least 6 characters.' }

  if (authMode === 'demo') {
    const users = demoUsers()
    if (users[e]) return { error: 'An account with this email already exists — sign in instead.' }
    users[e] = demoHash(password)
    saveDemoUsers(users)
    setDemoSession(demoUser(e, 'email'))
    return { notice: 'Demo account created and signed in — stored in this browser only.' }
  }

  const { data, error } = await supabase.auth.signUp({ email: e, password })
  if (error) return { error: error.message }
  notify()
  if (data.session) return {}
  return { notice: 'Account created — check your email to confirm, then sign in.' }
}

export async function resetPassword(email: string): Promise<AuthResult> {
  const e = email.trim().toLowerCase()
  if (!EMAIL_RE.test(e)) return { error: 'Enter your account email first.' }
  if (authMode === 'demo') return { notice: 'Demo mode — password reset is disabled (accounts live in this browser).' }
  const { error } = await supabase.auth.resetPasswordForEmail(e, {
    redirectTo: `${window.location.origin}/login`,
  })
  if (error) return { error: error.message }
  return { notice: 'Reset link sent — check your inbox.' }
}

// ── OAuth ────────────────────────────────────────────────────────────────────

/** Which OAuth providers are enabled on the Supabase project (live mode only). */
export type OAuthAvailability = Record<OAuthProvider, boolean>

let oauthCache: OAuthAvailability | null = null

export async function getOAuthAvailability(): Promise<OAuthAvailability | null> {
  if (authMode === 'demo' || !SUPABASE_URL || !SUPABASE_KEY) return null
  if (oauthCache) return oauthCache
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } })
    const data = await res.json()
    oauthCache = {
      google: !!data.external?.google,
      discord: !!data.external?.discord,
      github: !!data.external?.github,
      apple: !!data.external?.apple,
    }
    return oauthCache
  } catch {
    return null
  }
}

export async function signInOAuth(provider: OAuthProvider): Promise<AuthResult> {
  if (authMode === 'demo') {
    setDemoSession(demoUser(`demo-user@${provider}.demo`, provider))
    return { notice: `Signed in with ${provider} (demo) — connect Supabase OAuth apps for the real flow.` }
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${window.location.origin}/dashboard` },
  })
  if (error) return { error: error.message }
  return {}
}
