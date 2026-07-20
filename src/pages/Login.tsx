import { useState } from 'react'
import { useNavigate, Link } from 'react-router'
import { supabase } from '@/lib/supabase'
import { ArrowLeft, Mail, Lock, Loader2 } from 'lucide-react'

const inputCls =
  'w-full border border-primary bg-card px-3 py-3 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-accent rounded-none'

export default function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const navigate = useNavigate()

  const submit = async () => {
    setError('')
    setNotice('')
    if (!email.trim() || !password) return setError('Email and password are required.')
    setBusy(true)
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      setBusy(false)
      if (error) return setError(error.message)
      navigate('/dashboard')
    } else {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password })
      setBusy(false)
      if (error) return setError(error.message)
      if (data.session) return navigate('/dashboard')
      setNotice('Account created — check your email to confirm, then sign in.')
      setMode('signin')
    }
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

            <p className="mt-4 text-center font-mono-spec text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              secured by supabase auth · row-level security on every table
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
