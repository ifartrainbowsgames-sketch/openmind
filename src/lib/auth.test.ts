// Auth service tests — demo mode (no Supabase env in the test runner).
// Storage shims are installed before the module under test is imported.
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Node 20 has no native WebSocket — mock the supabase module so its realtime
// client never initializes in the test runner. Demo mode never touches it.
vi.mock('./supabase', () => {
  let remember = '1'
  return {
    isSupabaseConfigured: false,
    SUPABASE_URL: null,
    SUPABASE_KEY: null,
    getRemember: () => remember !== '0',
    setRemember: (on: boolean) => { remember = on ? '1' : '0' },
    supabase: { auth: {} },
  }
})

class MemStorage implements Storage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  clear() { this.m.clear() }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  getItem(k: string) { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
}

const localStore = new MemStorage()
const sessionStore = new MemStorage()
Object.defineProperty(globalThis, 'localStorage', { value: localStore })
Object.defineProperty(globalThis, 'sessionStorage', { value: sessionStore })

const auth = await import('./auth')
const { setRemember } = await import('./supabase') as { setRemember: (on: boolean) => void }

beforeEach(() => {
  localStore.clear()
  sessionStore.clear()
})

describe('demoHash', () => {
  it('is deterministic and never contains the password', () => {
    expect(auth.demoHash('hunter2')).toBe(auth.demoHash('hunter2'))
    expect(auth.demoHash('hunter2')).not.toContain('hunter2')
    expect(auth.demoHash('hunter2')).not.toBe(auth.demoHash('hunter3'))
  })
})

describe('demo email + password flow', () => {
  it('rejects invalid input', async () => {
    expect((await auth.signUpEmail('not-an-email', 'secret1')).error).toMatch(/valid email/)
    expect((await auth.signUpEmail('a@b.co', '123')).error).toMatch(/6 characters/)
    expect((await auth.signInEmail('', '')).error).toBeTruthy()
  })

  it('signs up, creates a session, and blocks duplicates', async () => {
    const r = await auth.signUpEmail('ada@lovelace.dev', 'analytical')
    expect(r.error).toBeUndefined()
    const s = await auth.getSession()
    expect(s?.user.email).toBe('ada@lovelace.dev')
    expect(s?.demo).toBe(true)
    expect((await auth.signUpEmail('ada@lovelace.dev', 'analytical')).error).toMatch(/already exists/)
  })

  it('stores a hash, not the plaintext password', async () => {
    await auth.signUpEmail('alan@turing.dev', 'enigma-secret')
    const raw = localStore.getItem('om-demo-users') ?? ''
    expect(raw).not.toContain('enigma-secret')
    expect(raw).toContain('dj')
  })

  it('signs in with correct credentials and rejects wrong ones', async () => {
    await auth.signUpEmail('grace@hopper.dev', 'compiler!')
    await auth.signOut()
    expect(await auth.getSession()).toBeNull()
    expect((await auth.signInEmail('grace@hopper.dev', 'wrong')).error).toMatch(/Wrong password/)
    expect((await auth.signInEmail('nobody@nowhere.dev', 'x')).error).toMatch(/No account/)
    expect((await auth.signInEmail('grace@hopper.dev', 'compiler!')).error).toBeUndefined()
    expect((await auth.getSession())?.user.email).toBe('grace@hopper.dev')
  })
})

describe('remember me', () => {
  it('persists to localStorage when remembered, sessionStorage when not', async () => {
    await auth.signUpEmail('katherine@johnson.dev', 'orbital-math')
    expect(localStore.getItem('om-demo-session')).toBeTruthy()
    expect(sessionStore.getItem('om-demo-session')).toBeNull()

    await auth.signOut()
    setRemember(false)
    await auth.signInEmail('katherine@johnson.dev', 'orbital-math')
    expect(sessionStore.getItem('om-demo-session')).toBeTruthy()
    expect(localStore.getItem('om-demo-session')).toBeNull()

    // session is readable either way
    expect((await auth.getSession())?.user.email).toBe('katherine@johnson.dev')
  })
})

describe('demo OAuth', () => {
  it.each(['google', 'discord', 'github', 'apple'] as const)('signs in with %s', async (p) => {
    const r = await auth.signInOAuth(p)
    expect(r.error).toBeUndefined()
    const s = await auth.getSession()
    expect(s?.user.via).toBe(p)
    expect(s?.user.email).toBe(`demo-user@${p}.demo`)
  })
})

describe('misc', () => {
  it('resetPassword explains demo mode', async () => {
    expect((await auth.resetPassword('a@b.co')).notice).toMatch(/[Dd]emo/)
  })
  it('authMode is demo without env', () => {
    expect(auth.authMode).toBe('demo')
  })
})
