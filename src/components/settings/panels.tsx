import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, Check, Loader2, Trash2 } from 'lucide-react'
import { LIVE_PROVIDERS } from '@/lib/agent'
import {
  TOOL_CAPABILITIES, TOOL_META,
  describeReadiness, summarise, type ToolCapability,
} from '@/lib/key-mode'
import type { MobileProviderConfig } from '@/lib/mobile-provider'
import {
  connectProvider, connectionFor, disconnect, type StoredKey,
} from '@/lib/provider-vault'
import { getSession } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { SettingsCard, SettingsRow, inputClass } from './SettingsLayout'
import { useVault } from './use-settings-state'
import { anchorProps } from '@/lib/settings-catalog'

function Banner({ tone, children }: { tone: 'warn' | 'ok'; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        'flex items-start gap-2 rounded-xl px-3 py-2 text-[12px] leading-snug',
        tone === 'warn' ? 'bg-[#fff4ec] text-[#8a3b00]' : 'bg-[#eef7ee] text-[#2f5d33]',
      )}
    >
      {tone === 'warn'
        ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        : <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <span>{children}</span>
    </p>
  )
}

function SignInPrompt() {
  return (
    <Banner tone="warn">
      Server-held keys need an account.{' '}
      <Link to="/login?next=/settings/keys" className="font-medium underline">Sign in</Link>{' '}
      to store one.
    </Banner>
  )
}

// ── Account ─────────────────────────────────────────────────────────────────

export function AccountPanel() {
  const [email, setEmail] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    void getSession().then((s) => { setEmail(s?.user.email ?? null); setLoaded(true) })
  }, [])

  return (
    <>
      <SettingsCard
        title="Signed in as"
        description="One account across web, mobile and any desktop client."
        anchor={anchorProps('account')}
      >
        {!loaded ? (
          <Loader2 className="h-4 w-4 animate-spin text-[#a8a49c]" />
        ) : email ? (
          <p className="text-sm">{email}</p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-[#8d8b84]">Not signed in.</p>
            <Link
              to="/login?next=/settings/general"
              className="inline-block rounded-xl bg-[#17140f] px-4 py-2 text-sm text-white"
            >
              Sign in
            </Link>
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        title="What an account unlocks"
        description="Everything below works signed out, in this browser only."
        anchor={anchorProps('capabilities')}
      >
        <ul className="space-y-1.5 text-[13px] text-[#4a463f]">
          <li>· Runs that keep going after you close the tab</li>
          <li>· Keys stored server-side, so a background run has credentials</li>
          <li>· Project history synced instead of held in this browser</li>
        </ul>
      </SettingsCard>
    </>
  )
}

// ── Models ──────────────────────────────────────────────────────────────────

function ProviderSelect({
  value, onChange, allowInherit,
}: { value: string; onChange: (id: string) => void; allowInherit?: boolean }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      {allowInherit ? <option value="">Same as worker model</option> : null}
      {LIVE_PROVIDERS.map((p) => (
        <option key={p.id} value={p.id}>{p.name} · {p.model}</option>
      ))}
    </select>
  )
}

export function ModelsPanel({
  config, update,
}: { config: MobileProviderConfig; update: (next: MobileProviderConfig) => void }) {
  return (
    <>
      <SettingsCard
        title="Worker model"
        description="Does the actual work — every task in the plan runs on this."
        anchor={anchorProps('worker-model')}
      >
        <ProviderSelect value={config.providerId} onChange={(providerId) => update({ ...config, providerId })} />
      </SettingsCard>

      <SettingsCard
        title="Planner model"
        description="Splits the goal into tasks. Leave blank to reuse the worker model."
        anchor={anchorProps('planner-model')}
      >
        <ProviderSelect
          allowInherit
          value={config.plannerProviderId ?? ''}
          onChange={(id) => update({ ...config, plannerProviderId: id || undefined })}
        />
      </SettingsCard>

      <SettingsCard
        title="Judge model"
        description="Grades each task against its acceptance criteria."
        anchor={anchorProps('judge-model')}
        footer={
          !config.plannerProviderId && !config.judgeProviderId ? (
            <Banner tone="warn">
              One model plans the work, does the work, and grades the work — so it approves its own
              output. That is correlated failure, not review. A separate planner or judge breaks the loop.
            </Banner>
          ) : null
        }
      >
        <ProviderSelect
          allowInherit
          value={config.judgeProviderId ?? ''}
          onChange={(id) => update({ ...config, judgeProviderId: id || undefined })}
        />
      </SettingsCard>
    </>
  )
}

// ── Keys ─────────────────────────────────────────────────────────────────

/**
 * One provider, connected or not.
 *
 * Keyed by provider rather than by role, which is the point: a customer holds
 * one key per provider and may hold as many as they pay for. Which connected
 * provider does the work is chosen under Models, and involves no key at all.
 */
function ConnectionRow({
  spec, stored, onConnect, onDisconnect, busy,
}: {
  spec: typeof LIVE_PROVIDERS[number]
  stored?: StoredKey
  onConnect: (providerId: string, key: string) => Promise<void>
  onDisconnect: (stored: StoredKey) => Promise<void>
  busy: boolean
}) {
  const [value, setValue] = useState('')
  const [open, setOpen] = useState(false)

  if (stored) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-black/10 bg-[#faf9f6] px-3 py-2">
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <Check className="h-3.5 w-3.5 shrink-0 text-[#2f5d33]" />
          <span className="truncate font-medium">{spec.name}</span>
          <span className="shrink-0 text-[#8d8b84]">{stored.hint}</span>
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onDisconnect(stored)}
          className="shrink-0 rounded-full p-1.5 text-[#8d8b84] hover:bg-black/5 hover:text-[#b3261e]"
          aria-label={`Disconnect ${spec.name}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  if (!spec.keyRequired && spec.keyRequired !== undefined) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-dashed border-black/15 px-3 py-2 text-sm">
        <span className="font-medium">{spec.name}</span>
        <span className="text-[11px] text-[#8d8b84]">{spec.keyUrl}</span>
      </div>
    )
  }

  if (!open) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-dashed border-black/15 px-3 py-2">
        <span className="min-w-0 truncate text-sm">
          <span className="font-medium">{spec.name}</span>
          <span className="ml-2 text-[11px] text-[#8d8b84]">{spec.model}</span>
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 rounded-xl border border-black/15 px-2.5 py-1 text-[12px] hover:bg-black/5"
        >
          Connect
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-1.5 rounded-xl border border-black/15 p-2.5">
      <p className="text-[12px] font-medium">{spec.name}</p>
      <p className="text-[11px] leading-snug text-[#8d8b84]">Key from {spec.keyUrl}</p>
      <div className="flex gap-1.5">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="paste key"
          autoComplete="off"
          autoFocus
          className={inputClass}
        />
        <button
          type="button"
          disabled={busy || !value.trim()}
          onClick={() => {
            void onConnect(spec.id, value.trim()).then(() => { setValue(''); setOpen(false) })
          }}
          className="shrink-0 rounded-xl bg-[#17140f] px-3 text-sm text-white disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  )
}

export function KeysPanel({
  config, update,
}: { config: MobileProviderConfig; update: (next: MobileProviderConfig) => void }) {
  const vault = useVault()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const readiness = describeReadiness(config, vault.keys, { background: config.backgroundRuns === true })

  const connect = async (providerId: string, key: string) => {
    setBusy(true); setNote(null)
    try {
      await connectProvider(providerId, key)
      setNote('Stored. The key left this browser once and cannot be read back.')
      vault.refresh()
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally { setBusy(false) }
  }

  const remove = async (stored: StoredKey) => {
    setBusy(true)
    try { await disconnect(stored); vault.refresh() }
    catch (err) { setNote(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }

  return (
    <>
      <SettingsCard
        title="Your model key"
        description="You pay your model provider directly, at their rate, with nothing added. Search, browsing, the code sandbox and hosted Chrome are included — you never supply a key for those."
        anchor={anchorProps('storage-explainer')}
        footer={<Banner tone={readiness.usable ? 'ok' : 'warn'}>{summarise(readiness)}</Banner>}
      />

      {/*
        Local development only.

        A production customer must never be asked to paste a provider key into
        a web page that keeps it in localStorage: anything running in the tab
        can read it, it survives sign-out, it follows the browser profile onto
        shared machines, and it is exactly the exposure the server-side vault
        below exists to remove. The vault encrypts with AES-256-GCM before the
        key reaches the database and never hands it back.

        The field stays under `import.meta.env.DEV` rather than being deleted
        because tab-executed runs genuinely have no server to fetch a key from,
        and that path is still worth exercising locally. `DEV` is compiled out
        by Vite, so this markup is not merely hidden in the production bundle —
        it is absent from it.
      */}
      {import.meta.env.DEV ? (
        <SettingsCard
          title="Held in this browser (dev only)"
          description="Local development only — not shown in the deployed app. Stored in localStorage, which anything running in this tab can read. Use the server-side vault below for anything real."
          anchor={anchorProps('browser-keys')}
        >
          <SettingsRow
            label="Model key"
            hint="For the worker model chosen under Models."
            control={
              <input
                type="password"
                value={config.apiKey}
                onChange={(e) => update({ ...config, apiKey: e.target.value })}
                placeholder="sk-..."
                autoComplete="off"
                className={inputClass}
              />
            }
          />
        </SettingsCard>
      ) : null}

      <SettingsCard
        title="Connected providers"
        description="Connect as many as you like — one key each. Encrypted with AES-256-GCM before it reaches the database and never readable back, not even by you. Which one does the work is chosen under Models."
        anchor={anchorProps('server-keys')}
        footer={note ? <p className="text-[12px] text-[#8d8b84]">{note}</p> : null}
      >
        {vault.signedIn === false ? (
          <SignInPrompt />
        ) : (
          <div className="space-y-2">
            {vault.error ? <Banner tone="warn">{vault.error}</Banner> : null}
            {LIVE_PROVIDERS.map((spec) => (
              <ConnectionRow
                key={spec.id}
                spec={spec}
                // By provider, not by slot. A key stored under the legacy
                // `worker` role still IS an Anthropic connection, and the
                // worker resolves it as one.
                stored={connectionFor(vault.keys, spec.id)}
                onConnect={connect}
                onDisconnect={remove}
                busy={busy}
              />
            ))}
          </div>
        )}
      </SettingsCard>
    </>
  )
}

// ── Tools ────────────────────────────────────────────────────────────

export function ToolsPanel() {
  const anchors: Record<ToolCapability, string> = {
    search: 'search', browse: 'browse', sandbox: 'sandbox', chrome: 'browserless',
  }

  return (
    <>
      <SettingsCard
        title="Included with your account"
        description="These run on our infrastructure using our credentials. Nothing to configure, and no key of yours is involved."
      >
        <Banner tone="ok">Supplied by OpenMind — not billed to your model provider.</Banner>
      </SettingsCard>

      {TOOL_CAPABILITIES.map((capability) => {
        const meta = TOOL_META[capability]
        return (
          <SettingsCard
            key={capability}
            title={meta.label}
            description={meta.blurb}
            anchor={anchorProps(anchors[capability])}
            footer={
              meta.freeFallback ? (
                <p className="text-[11px] leading-snug text-[#8d8b84]">
                  Falls back to {meta.freeFallback} if the paid provider is unavailable, so this
                  capability never disappears mid-run.
                </p>
              ) : null
            }
          />
        )
      })}
    </>
  )
}

// ── Execution ───────────────────────────────────────────────────────────────

function Toggle({
  checked, onChange, label, hint,
}: { checked: boolean; onChange: (next: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[#17140f]"
      />
      <span className="text-sm leading-snug">
        {label}
        <span className="mt-0.5 block text-[11px] leading-snug text-[#8d8b84]">{hint}</span>
      </span>
    </label>
  )
}

export function ExecutionPanel({
  config, update,
}: { config: MobileProviderConfig; update: (next: MobileProviderConfig) => void }) {
  const vault = useVault()
  return (
    <>
      <SettingsCard title="Strict mode" anchor={anchorProps('strict-mode')}>
        <Toggle
          checked={config.strictMode === true}
          onChange={(strictMode) => update({ ...config, strictMode })}
          label="Refuse to fake it"
          hint="A missing capability becomes a blocked task instead of a plausible answer built from mock data. Off by default so the keyless demo still runs."
        />
      </SettingsCard>

      <SettingsCard
        title="Run in background"
        anchor={anchorProps('background-runs')}
        footer={
          config.backgroundRuns && vault.signedIn === false ? <SignInPrompt /> : null
        }
      >
        <Toggle
          checked={config.backgroundRuns === true}
          onChange={(backgroundRuns) => update({ ...config, backgroundRuns })}
          label="Queue runs on the worker"
          hint="The run survives closing the tab. Needs keys stored on the server, because a worker has no browser to read this one's."
        />
      </SettingsCard>

      <SettingsCard
        title="Spend ceiling"
        description="Per project. A run that reaches the ceiling stops and reports what it has, rather than continuing to spend."
        anchor={anchorProps('budget')}
      >
        <p className="text-[13px] text-[#8d8b84]">
          Configured per run from the project ledger defaults.
        </p>
      </SettingsCard>
    </>
  )
}

// ── Appearance & Connections ────────────────────────────────────────────────

export function AppearancePanel() {
  return (
    <>
      <SettingsCard
        title="Theme"
        description="Follows your system setting."
        anchor={anchorProps('theme')}
      >
        <p className="text-[13px] text-[#8d8b84]">Light. A dark palette is not built yet.</p>
      </SettingsCard>
      <SettingsCard
        title="Reduced motion"
        description="Respects the operating system's reduce-motion preference automatically."
        anchor={anchorProps('motion')}
      />
    </>
  )
}

export function ConnectionsPanel() {
  return (
    <>
      <SettingsCard
        title="MCP servers"
        description="Model Context Protocol tools available to workers."
        anchor={anchorProps('mcp')}
      >
        <Link to="/app" className="text-[13px] font-medium text-[#ff4d00]">
          Manage in the app →
        </Link>
      </SettingsCard>
      <SettingsCard
        title="Connected apps"
        description="Third-party accounts a worker may act on."
        anchor={anchorProps('apps')}
      >
        <Link to="/app" className="text-[13px] font-medium text-[#ff4d00]">
          Manage in the app →
        </Link>
      </SettingsCard>
    </>
  )
}
