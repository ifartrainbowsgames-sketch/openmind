import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, Link } from 'react-router'
import {
  ArrowLeft, Apple, Github, Loader2, Lock, Mail,
} from 'lucide-react'
import {
  authMode, getOAuthAvailability, getSession, OAUTH_PROVIDERS, resetPassword,
  signInEmail, signInOAuth, signUpEmail,
  type OAuthAvailability, type OAuthProvider,
} from '@/lib/auth'
import { getRemember, setRemember } from '@/lib/supabase'
import { ModeStamp } from '@/components/demos/shared'

const inputCls =
  'w-full border border-primary bg-card px-3 py-3 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-accent rounded-none'

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
    </svg>
  )
}

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="#5865F2">
      <path d="M20.32 4.37a19.8 19.8 0 0 0-4.93-1.51 13.8 13.8 0 0 0-.64 1.28 18.3 18.3 0 0 0-5.5 0 13.8 13.8 0 0 0-.64-1.28c-1.71.29-3.37.8-4.93 1.51A20.3 20.3 0 0 0 .1 18.06a19.9 19.9 0 0 0 6.07 3.03c.49-.66.93-1.36 1.3-2.09a12.9 12.9 0 0 1-2.05-.98c.17-.12.34-.25.5-.38a14.2 14.2 0 0 0 12.16 0c.16.13.33.26.5.38-.65.38-1.34.71-2.05.98.37.73.81 1.43 1.3 2.09a19.9 19.9 0 0 0 6.07-3.03 20.3 20.3 0 0 0-3.58-13.69ZM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42s.95-2.42 2.16-2.42 2.18 1.09 2.16 2.42c0 1.34-.95 2.42-2.16 2.42Zm7.96 0c-1.18 0-2.16-1.08-2.16-2.42s.95-2.42 2.16-2.42 2.18 1.09 2.16 2.42c0 1.34-.95 2.42-2.16 2.42Z" />
    </svg>
  )
}

const PROVIDER_ICON: Record<OAuthProvider, () => ReactNode> = {
  google: () => <GoogleIcon />,
  discord: () => <DiscordIcon />,
  github: () => <Github className="h-4 w-4" />,
  apple: () => <Apple className="h-4 w-4" />,
}

export default function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRememberState] = useState(getRemember())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [oauthAvail, setOauthAvail] = useState<OAuthAvailability | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    getOAuthAvailability().then(setOauthAvail)
  }, [])

  const submit = async () => {
    setError('')
    setNotice('')
    setBusy(true)
    const r = mode === 'signin' ? await signInEmail(email, password) : await signUpEmail(email, password)
    setBusy(false)
    if (r.error) return setError(r.error)
    if (r.notice) setNotice(r.notice)
    // signed in (demo always; live when a session exists or signup auto-confirms)
    if (await getSession()) return navigate('/dashboard')
    if (mode === 'signup') setMode('signin')
  }

  const oauth = async (p: OAuthProvider) => {
    setError('')
    setNotice('')
    setBusy(true)
    const r = await signInOAuth(p)
    setBusy(false)
    if (r.error) return setError(r.error)
    if (r.notice) setNotice(r.notice)
    if (await getSession()) navigate('/dashboard')
    // live mode: browser is redirected to the provider — nothing else to do
  }

  const forgot = async () => {
    setError('')
    setNotice('')
    const r = await resetPassword(email)
    if (r.error) return setError(r.error)
    if (r.notice) setNotice(r.notice)
  }

  return (
    <div className="bg-ruled flex min-h-screen flex-col bg-background">
      <div className="border-b border-border px-6 py-4">
        <Link to="/" className="flex items-center gap-2 font-mono-spec text-xs uppercase tracking-[0.14em] text-muted-foreground hover:text-accent">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to site
        </Link>
      </div>

      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">
          <p className="spec-label mb-4 flex items-center gap-3">
            <span className="inline-block h-2 w-2 bg-accent" />
            Console access
          </p>
          <h1 className="font-serif-display text-5xl font-semibold tracking-tight">
            {mode === 'signin' ? 'Sign in.' : 'Create account.'}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {mode === 'signin'
              ? 'Your workspace, sources, conversations and keys — all behind your account.'
              : 'Free tier, no card. Your keys stay yours from the first request.'}
          </p>

          <div className="mt-8 border border-primary bg-card p-6 hard-shadow">
            <div className="mb-5 grid grid-cols-2 border border-border/60">
              {(['signin', 'signup'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setError(''); setNotice('') }}
                  className={`px-3 py-2.5 font-mono-spec text-[11px] uppercase tracking-wider transition-colors ${
                    mode === m ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary'
                  }`}
                >
                  {m === 'signin' ? 'Sign in' : 'Sign up'}
                </button>
              ))}
            </div>

            {/* OAuth */}
            <div className="grid grid-cols-2 gap-2">
              {OAUTH_PROVIDERS.map((p) => {
                const off = oauthAvail ? !oauthAvail[p.id] : false
                return (
                  <button
                    key={p.id}
                    onClick={() => !off && oauth(p.id)}
                    disabled={busy || off}
                    title={off ? `${p.name} isn't enabled on the Supabase project yet — Authentication → Providers` : undefined}
                    className={`flex items-center justify-center gap-2 border px-3 py-2.5 text-sm transition-colors ${
                      off
                        ? 'cursor-not-allowed border-border/40 opacity-40'
                        : 'border-border/70 bg-card hover:border-primary hover:bg-secondary disabled:opacity-50'
                    }`}
                  >
                    {PROVIDER_ICON[p.id]()}
                    <span className="font-mono-spec text-[11px] uppercase tracking-wider">{p.name}</span>
                    {off && <span className="font-mono-spec text-[8px] uppercase tracking-wider text-muted-foreground">setup</span>}
                  </button>
                )
              })}
            </div>
            {oauthAvail && Object.values(oauthAvail).some((v) => !v) && (
              <p className="mt-2 font-mono-spec text-[10px] leading-relaxed text-muted-foreground">
                Greyed providers aren't enabled on the Supabase project yet — flip them on under
                Authentication → Providers with each app's OAuth credentials.
              </p>
            )}

            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="font-mono-spec text-[10px] uppercase tracking-[0.16em] text-muted-foreground">or with email</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <label className="mb-4 block">
              <span className="spec-label mb-1.5 flex items-center gap-2"><Mail className="h-3 w-3" /> Email</span>
              <input
                className={inputCls}
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
            </label>
            <label className="block">
              <span className="spec-label mb-1.5 flex items-center gap-2"><Lock className="h-3 w-3" /> Password</span>
              <input
                className={inputCls}
                type="password"
                placeholder={mode === 'signup' ? '6+ characters' : '••••••••'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
            </label>

            <div className="mt-3 flex items-center justify-between">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => {
                    setRememberState(e.target.checked)
                    setRemember(e.target.checked)
                  }}
                  className="h-3.5 w-3.5 accent-[#ff4d00]"
                />
                Remember me on this device
              </label>
              <button onClick={forgot} className="text-xs text-muted-foreground underline-offset-2 hover:text-accent hover:underline">
                Forgot password?
              </button>
            </div>

            {error && (
              <p className="mt-4 border border-accent/60 bg-accent/10 px-3 py-2 text-xs text-accent">{error}</p>
            )}
            {notice && (
              <p className="mt-4 border border-emerald-700/60 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</p>
            )}

            <button
              onClick={submit}
              disabled={busy}
              className="mt-5 flex w-full items-center justify-center gap-2 border border-primary bg-primary px-6 py-3.5 font-mono-spec text-xs uppercase tracking-[0.16em] text-primary-foreground hard-shadow-sm transition-colors hover:bg-accent hover:border-accent disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {mode === 'signin' ? 'Sign in to console' : 'Create account'}
            </button>

            <div className="mt-4 flex justify-center">
              <ModeStamp
                mode={authMode === 'live' ? 'live' : 'simulated'}
                note={
                  authMode === 'live'
                    ? 'supabase auth · RLS on every table'
                    : 'demo mode — accounts live in this browser until Supabase env vars are set'
                }
                liveLabel="supabase auth"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
