import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import {
  ArrowLeft,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  FileText,
  Github,
  Hash,
  History,
  Menu,
  Mic,
  MoreHorizontal,
  Paperclip,
  Plug,
  Plus,
  Search,
  Settings,
  Sparkles,
  SquarePen,
  Trash2,
  Volume2,
  Wifi,
  WifiOff,
  X,} from 'lucide-react'
import {
  liveBrain,
  simulatedBrain,
  type Employee,
  type TraceLine,} from '@/lib/agent'
import {
  loadMobileVoiceSettings,
  OPENAI_TTS_VOICES,
  playOpenAiSpeech,
  recordMicrophone,
  saveMobileVoiceSettings,
  stopOpenAiSpeech,
  transcribeOpenAi,
  type MobileVoiceSettings,
  type OpenAiTtsVoice,} from '@/lib/openai-voice'
import {
  loadMobileProvider,
  mobileLiveReady,
  resolveMobileProviderSpec,
  type MobileProviderConfig,
  roleProvider,} from '@/lib/mobile-provider'
import {
  MOBILE_THREADS_KEY,
  createMobileThread,
  makeId,
  parseMobileThreads,
  persistThreads,
  sortMobileThreads,
  titleFromPrompt,
  type MobileMessage,
  type MobileThread,} from '@/lib/mobile-chat'
import { defaultWorkspaceKind, provisionWorkspace } from '@/lib/workspace-act'
import {
  WORKSPACE_CHOICES,
  workspacePrompt,
  type WorkspaceKind,} from '@/lib/workspace'
import ConnectAppsSheet from '@/components/mobile/ConnectAppsSheet'
import CommandSheet from '@/components/mobile/CommandSheet'
import { FilesBrowserPanel } from '@/components/mobile/WorkbenchPanes'
import { TaskLedgerPanel } from '@/components/mobile/TaskLedgerPanel'
import ToolConfirmHost from '@/components/crew/ToolConfirmSheet'
import { getSession } from '@/lib/auth'
import { bootKernel, runTurn } from '@/lib/openmind-os'
import { withExecutionMode } from '@/lib/execution-mode'
import { cancelRun, enqueueRun, isTerminal, listRuns, watchRun, type QueuedRun } from '@/lib/run-queue'
import {
  executionStatusLabel,
  loadAppExecutionMode,
  loadStoredRuntimeId,
  saveExecutionMode,
  saveRuntimeId,
  CLOUD_PROVIDER_SETTINGS_PATH,
  type AppExecutionMode,
  type AppRuntimeId,
} from '@/lib/app-execution'
import { fetchCloudReadiness, type CloudReadiness } from '@/lib/cloud-readiness'
import { buildCloudRunOptions, describeRunStatus, resolveSendRoute } from '@/lib/app-send'
import { SKILLS, type SkillId } from '@/lib/skills'
import {
  applySlashToDraft,
  consumeSlash,
  lastHttpUrl,
  matchSlashCommands,} from '@/lib/slash'
const MOBILE_ASSISTANT: Employee = {
  id: 'openmind',
  name: 'OpenMind',
  role: 'Assistant',
  prompt:
    'You are a helpful assistant. Answer clearly and use tools only when the user’s request needs them. Confirm before send, spend, or destructive actions.',
  tools: ['search_docs', 'summarize', 'sentiment', 'calculator', 'code_review', 'web_search', 'browse_url', 'web_act', 'run_code', 'github_write_file', 'github_create_branch', 'github_open_pr', 'slack_post', 'gmail_send', 'gmail_list', 'gmail_read', 'gdrive_list', 'memory_search', 'memory_save'],
  connections: ['github', 'gdrive', 'slack'],
  accent: '#ff4d00',
  tagline: 'Chat with tools when you need them',}
const STARTERS = [
  {
    label: 'Research a topic',
    prompt: 'Research the most important trends in open-source AI agents and give me a concise brief with sources.',
    icon: Search,
    color: '#6c50a1',
  },
  {
    label: 'Build something',
    prompt: 'Plan a small feature, then outline the code changes needed. Keep it practical.',
    icon: Github,
    color: '#2f6594',
  },
  {
    label: 'Write it up',
    prompt: 'Turn this idea into a clear one-page summary with next steps: a multi-agent app for small teams.',
    icon: FileText,
    color: '#286a54',
  },
  {
    label: 'Quick math',
    prompt: 'What is 847 × 23? Show the steps briefly.',
    icon: Hash,
    color: '#a34f36',
  },]
interface PendingAttachment {
  name: string
  text?: string}
function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(timestamp)
}

/** What to show in the bubble while a queued run is still in flight. */
function describeRun(run: QueuedRun): string {
  return describeRunStatus(run)
}function getStoredThreads(): MobileThread[] {
  if (typeof window === 'undefined') return [createMobileThread()]
  const saved = parseMobileThreads(localStorage.getItem(MOBILE_THREADS_KEY))
  return saved.length ? saved : [createMobileThread()]}function AgentMark({ employee, small = false }: { employee: Employee; small?: boolean }) {
  return (
    <span
      className={`relative flex shrink-0 items-center justify-center rounded-[30%] text-white shadow-sm ${
        small ? 'h-7 w-7' : 'h-10 w-10'
      }`}
      style={{ background: employee.accent }}
      aria-hidden="true"
    >
      <span className={`absolute rounded-full border border-white/30 ${small ? 'inset-1' : 'inset-1.5'}`} />
      <Sparkles className={small ? 'h-3.5 w-3.5' : 'h-5 w-5'} />
    </span>
  )}function ThreadList({
  threads,
  activeId,
  onPick,
  onNew,
  onDelete,}: {
  threads: MobileThread[]
  activeId: string
  onPick: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void}) {
  return (
    <>
      <div className="flex items-center justify-between px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
        <Link to="/" className="flex items-center gap-2 rounded-xl px-1 py-1 transition-colors hover:bg-white/10">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#ff4d00] text-white">
            <Bot className="h-4 w-4" />
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.02em] text-white">OpenMind</span>
        </Link>
        <button
          type="button"
          onClick={onNew}
          className="mobile-tap flex h-9 w-9 items-center justify-center rounded-xl text-white/55 hover:bg-white/10 hover:text-white"
          aria-label="New session"
        >
          <SquarePen className="h-[18px] w-[18px]" />
        </button>
      </div>
      <div className="px-3">
        <button
          type="button"
          onClick={onNew}
          className="mobile-tap flex w-full items-center gap-2.5 rounded-xl bg-white/10 px-3.5 py-3 text-sm font-medium text-white hover:bg-white/15"
        >
          <Plus className="h-4 w-4" />
          New session
        </button>
      </div>
      <div className="mt-6 flex items-center gap-2 px-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/35">
        <History className="h-3.5 w-3.5" />
        Recent
      </div>
      <nav className="mt-2 flex-1 space-y-1 overflow-y-auto px-2 pb-4" aria-label="Recent sessions">
        {sortMobileThreads(threads).map((thread) => (
          <div
            key={thread.id}
            className={`group flex items-center rounded-xl transition-colors ${
              activeId === thread.id ? 'bg-white/10' : 'hover:bg-white/5'
            }`}
          >
            <button
              type="button"
              onClick={() => onPick(thread.id)}
              className="min-w-0 flex-1 px-3 py-2.5 text-left"
            >
              <span className="block truncate text-[13px] font-medium text-white/90">{thread.title}</span>
              <span className="mt-0.5 block text-[11px] text-white/40">
                {thread.messages.length ? `${thread.messages.length} messages` : 'Ready when you are'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onDelete(thread.id)}
              className="mobile-tap mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/35 opacity-100 hover:bg-white/10 hover:text-red-400 lg:opacity-0 lg:group-hover:opacity-100"
              aria-label={`Delete ${thread.title}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Link
          to="/dashboard"
          className="flex items-center gap-3 rounded-xl px-2 py-2 text-xs text-white/45 transition-colors hover:bg-white/10 hover:text-white"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5">
            <ArrowLeft className="h-3.5 w-3.5" />
          </span>
          Open desktop console
        </Link>
      </div>
    </>
  )}/** * Voice only. Models, keys, tools and execution moved to /settings, where each * one is a linkable route instead of a field buried in a sheet inside a sheet. */function VoiceSheet({
  open,
  provider,
  voice,
  onClose,
  onVoiceChange,}: {
  open: boolean
  provider: MobileProviderConfig
  voice: MobileVoiceSettings
  onClose: () => void
  onVoiceChange: (next: MobileVoiceSettings) => void}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center lg:items-center" role="dialog" aria-modal="true" aria-label="Voice settings">
      <button className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={onClose} aria-label="Close voice settings" />
      <div className="mobile-sheet-in relative z-10 w-full rounded-t-[28px] bg-white px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl lg:max-w-md lg:rounded-[24px] lg:p-5">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-black/15 lg:hidden" />
        <div className="mb-4 flex items-center justify-between px-1">
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.02em]">Voice</h2>
            <p className="mt-0.5 text-xs text-[#85827b]">OpenAI Whisper in, OpenAI voices out.</p>
          </div>
          <button onClick={onClose} className="mobile-tap flex h-9 w-9 items-center justify-center rounded-full bg-[#f3f1ed]" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        {!provider.apiKey ? (
          <p className="mb-4 rounded-xl bg-[#fff4ec] px-3 py-2 text-[12px] leading-snug text-[#8a3b00]">
            Speech needs an OpenAI key.{' '}
            <Link to="/settings/keys" className="font-medium underline" onClick={onClose}>
              Add one in Settings
            </Link>
            .
          </p>
        ) : null}
        <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8d8b84]">Voice</label>
        <select
          value={voice.voice}
          onChange={(event) => onVoiceChange({ ...voice, voice: event.target.value as OpenAiTtsVoice })}
          className="mt-1.5 w-full rounded-xl border border-black/10 bg-[#faf9f6] px-3 py-2.5 text-sm outline-none focus:border-[#17140f]"
        >
          {OPENAI_TTS_VOICES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <label className="mt-4 flex items-center gap-2 text-sm text-[#44413c]">
          <input
            type="checkbox"
            checked={voice.autoSpeak}
            onChange={(event) => onVoiceChange({ ...voice, autoSpeak: event.target.checked })}
            className="h-4 w-4 rounded border-black/20"
          />
          Read replies aloud automatically
        </label>
        <button
          type="button"
          onClick={onClose}
          className="mobile-tap mt-5 w-full rounded-xl bg-[#17140f] py-3 text-sm font-medium text-white"
        >
          Done
        </button>
      </div>
    </div>
  )}export default function MobileApp() {
  const [threads, setThreads] = useState<MobileThread[]>(getStoredThreads)
  // Mirrors `threads` for the mount-time reconnect, which must not re-run
  // every time a thread changes.
  const threadsRef = useRef(threads)
  useEffect(() => {
    threadsRef.current = threads
  }, [threads])
  const [activeId, setActiveId] = useState(() => threads[0].id)
  const [draft, setDraft] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [appsOpen, setAppsOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [skill, setSkill] = useState<SkillId>('multitask')
  const [accountEmail, setAccountEmail] = useState<string | null>(null)
  // Where the user steered the browser pane by hand, pinned to the thread and to
  // the tool URL it overrode. Both keys matter: switching threads must not carry
  // one conversation's page into another, and a fresh tool URL should win over a
  // stale manual one.
  const [browserOverride, setBrowserOverride] = useState<{ threadId: string; from: string; url: string } | null>(null)
  const [openFileBody, setOpenFileBody] = useState('')
  // Read-only here: /settings owns writes, and returning from that route
  // remounts this page, so the fresh config is picked up on mount.
  const [provider] = useState<MobileProviderConfig>(() => loadMobileProvider())
  const [executionMode, setExecutionMode] = useState<AppExecutionMode>(() => loadAppExecutionMode(false))
  const [runtimeId, setRuntimeId] = useState<AppRuntimeId>(() => loadStoredRuntimeId())
  const [cloudReadiness, setCloudReadiness] = useState<CloudReadiness>(() => ({
    ready: false,
    signedIn: false,
    demoSession: false,
  }))
  const [signedIn, setSignedIn] = useState(false)
  const [voice, setVoice] = useState<MobileVoiceSettings>(() => loadMobileVoiceSettings())
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  // Threads with a foreground run in flight, each holding its own trace. A map
  // rather than a single id: one thread working is not a reason to lock the
  // composer in every other thread, and a trace belongs to the run that emitted
  // it rather than to whatever happens to be on screen.
  const [pending, setPending] = useState<Record<string, TraceLine[]>>({})
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null)
  const [destination, setDestination] = useState<WorkspaceKind>(() => defaultWorkspaceKind())
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const recordingRef = useRef<{ stop: () => void } | null>(null)
  const liveReady = mobileLiveReady(provider)
  const providerSpec = resolveMobileProviderSpec(provider)
  const executionLabel = executionStatusLabel(executionMode, {
    providerName:
      executionMode === 'cloud'
        ? cloudReadiness.workerProviderName
        : executionMode === 'browser_direct'
          ? providerSpec.name
          : undefined,
    runtimeId: executionMode === 'cloud' ? runtimeId : undefined,
  })
  const openAiVoiceReady = provider.providerId === 'openai' && provider.apiKey.trim().length > 0
  // A dedicated planner provider when one is configured, else the worker
  // provider. Same model planning and executing is weaker, but it is what a
  // single-key setup can honestly offer.
  const plannerRole = roleProvider(provider, 'planner')
  const plannerSpec = resolveMobileProviderSpec({ ...provider, providerId: plannerRole.providerId })
  const plannerBrain = plannerRole.apiKey.trim()
    ? {
        baseUrl: plannerSpec.baseUrl,
        model: plannerSpec.model,
        key: plannerRole.apiKey.trim(),
        fixedParams: plannerSpec.fixedParams,
      }
    : null
  const persistVoice = (next: MobileVoiceSettings) => {
    setVoice(next)
    saveMobileVoiceSettings(next)
  }
  const speakReply = async (messageId: string, text: string) => {
    if (!openAiVoiceReady) {
      setVoiceOpen(true)
      return
    }
    setSpeakingId(messageId)
    try {
      await playOpenAiSpeech(provider.apiKey.trim(), text, voice.voice)
    } catch (error) {
      console.error(error)
    } finally {
      setSpeakingId(null)
    }
  }
  const activeThread = threads.find((thread) => thread.id === activeId) ?? threads[0]
  const selectedEmployee = MOBILE_ASSISTANT
  const hasMessages = (activeThread?.messages.length ?? 0) > 0
  const latestArtifacts = (activeThread?.messages ?? []).flatMap((message) => message.crewRun?.artifacts ?? [])
  const slashHits = matchSlashCommands(draft)
  const startPending = (threadId: string) => setPending((current) => ({ ...current, [threadId]: [] }))
  const pushTrace = (threadId: string, line: TraceLine) =>
    setPending((current) => (threadId in current ? { ...current, [threadId]: [...current[threadId], line] } : current))
  const clearPending = (threadId: string) =>
    setPending((current) => {
      if (!(threadId in current)) return current
      const next = { ...current }
      delete next[threadId]
      return next
    })
  const activeTrace = activeThread ? pending[activeThread.id] : undefined
  /** Only the thread on screen gates its own composer. */
  const activeBusy = activeTrace !== undefined
  // Derived, not stored: the last URL this thread's tools opened. Storing it in
  // an effect left the pane showing another thread's page whenever the new one
  // had opened nothing.
  const threadUrl = useMemo(() => {
    const blob = (activeThread?.messages ?? []).flatMap((message) => (message.toolCalls ?? []).map((call) => call.output)).join('\n')
    return lastHttpUrl(blob) ?? ''
  }, [activeThread?.messages])
  const browserUrl =
    browserOverride && browserOverride.threadId === activeThread?.id && browserOverride.from === threadUrl
      ? browserOverride.url
      : threadUrl
  const navigateBrowser = (url: string) =>
    setBrowserOverride({ threadId: activeThread?.id ?? '', from: threadUrl, url })
  useEffect(() => {
    persistThreads(threads)
  }, [threads])
  useEffect(() => {
    void getSession().then((session) => {
      const isSignedIn = Boolean(session?.user.id && !session.demo)
      setSignedIn(isSignedIn)
      setExecutionMode(loadAppExecutionMode(isSignedIn))
      if (session?.user.id) bootKernel({ userId: session.user.id })
      setAccountEmail(session?.user.email ?? null)
      void fetchCloudReadiness().then(setCloudReadiness)
    })
  }, [])
  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [activeThread?.messages.length, activeBusy, activeTrace?.length])
  useEffect(() => {
    const field = textareaRef.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${Math.min(field.scrollHeight, 120)}px`
  }, [draft])
  const updateThread = (id: string, update: (thread: MobileThread) => MobileThread) => {
    setThreads((current) => sortMobileThreads(current.map((thread) => (thread.id === id ? update(thread) : thread))))
  }
  const newThread = () => {
    const thread = createMobileThread(activeThread?.employeeId ?? 'openmind')
    setThreads((current) => [thread, ...current])
    setActiveId(thread.id)
    setDraft('')
    setAttachment(null)
    setDestination(defaultWorkspaceKind())
    setDrawerOpen(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }
  /** Background runs this thread is still waiting on. */
  const liveRunIds = (thread: MobileThread): string[] =>
    thread.messages
      .filter((message) => message.runId && message.runStatus && !isTerminal(message.runStatus))
      .map((message) => message.runId as string)
  const deleteThread = (id: string) => {
    if (id in pending) return
    const doomed = threads.find((thread) => thread.id === id)
    // A queued run outlives the thread that started it. Deleting the only place
    // its result can land while leaving it running bills the user for output
    // nobody will ever see, so stop the work too.
    for (const runId of doomed ? liveRunIds(doomed) : []) {
      void cancelRun(runId).catch(() => {})
      runWatchers.current.get(runId)?.()
      runWatchers.current.delete(runId)
      finishedRuns.current.delete(runId)
    }
    setThreads((current) => {
      const remaining = current.filter((thread) => thread.id !== id)
      if (remaining.length) {
        if (activeId === id) setActiveId(remaining[0].id)
        return remaining
      }
      const replacement = createMobileThread()
      setActiveId(replacement.id)
      return [replacement]
    })
  }
  // Live subscriptions for queued runs, plus the ids that already finished —
  // a run can reach a terminal state before its subscription resolves.
  const runWatchers = useRef(new Map<string, () => void>())
  const finishedRuns = useRef(new Set<string>())
  useEffect(() => {
    const watchers = runWatchers.current
    return () => {
      for (const stop of watchers.values()) stop()
      watchers.clear()
    }
  }, [])
  /** One assistant message per queued run, updated in place as it progresses. */
  const appendRunMessage = (threadId: string, run: QueuedRun) => {
    updateThread(threadId, (current) => {
      const existing = current.messages.find((m) => m.runId === run.id)
      const rendered: MobileMessage = {
        id: existing?.id ?? makeId('message'),
        role: 'assistant',
        runId: run.id,
        runStatus: run.status,
        content: run.answer ?? describeRun(run),
        createdAt: existing?.createdAt ?? Date.now(),
        crewRun: run.snapshot
          ? { employeeIds: [], memberNames: [], artifacts: [], project: run.snapshot }
          : existing?.crewRun,
      }
      return {
        ...current,
        messages: existing
          ? current.messages.map((m) => (m.runId === run.id ? rendered : m))
          : [...current.messages, rendered],
        updatedAt: Date.now(),
      }
    })
  }
  const watchQueuedRun = (threadId: string, runId: string) => {
    void watchRun(runId, (run) => {
      appendRunMessage(threadId, run)
      if (!isTerminal(run.status)) return
      // Mark finished first: the run can reach a terminal state before
      // subscribe() resolves, in which case there is no stop function yet.
      finishedRuns.current.add(runId)
      const stop = runWatchers.current.get(runId)
      if (stop) {
        stop()
        runWatchers.current.delete(runId)
        // subscribe() had already resolved, so the race this set guards against
        // cannot happen for this id. Drop it rather than holding every run id
        // for the life of the page.
        finishedRuns.current.delete(runId)
      }
    }).then((stop) => {
      if (finishedRuns.current.has(runId)) {
        stop()
        finishedRuns.current.delete(runId)
      } else {
        runWatchers.current.set(runId, stop)
      }
    })
  }
  // Reattach to runs still in flight from a previous visit. Without this,
  // "close the tab and come back" shows a run frozen at whatever the last
  // snapshot said — which would make background runs look broken.
  const reconnected = useRef(false)
  useEffect(() => {
    if (reconnected.current) return
    reconnected.current = true
    void (async () => {
      const runs = await listRuns(20).catch(() => [])
      for (const run of runs) {
        if (isTerminal(run.status)) continue
        const owner = threadsRef.current.find((t) => t.messages.some((m) => m.runId === run.id))
        if (owner) watchQueuedRun(owner.id, run.id)
      }
    })()
    // Runs once on mount; threadsRef keeps it reading current threads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const sendPrompt = async (override?: string) => {
    let text = (override ?? draft).trim()
    const taken = consumeSlash(text)
    let turnSkill = skill
    if (taken) {
      if (taken.command.action === 'files') {
        fileRef.current?.click()
        setDraft('')
        return
      }
      if (taken.command.action === 'model' || taken.command.action === 'settings') {
        setSettingsOpen(true)
        setVoiceOpen(taken.command.action === 'model')
        setDraft('')
        return
      }
      if (taken.command.action === 'connect') {
        setAppsOpen(true)
        setDraft('')
        return
      }
      if (taken.command.action === 'browser') {
        setDraft('')
        return
      }
      if (taken.command.skill) {
        turnSkill = taken.command.skill
        setSkill(taken.command.skill)
      }
      text = applySlashToDraft(taken.command, taken.rest)
      if (!text) {
        setDraft('')
        return
      }
    }
    const thread = activeThread
    if (!text || !thread || thread.id in pending) return
    const now = Date.now()
    const userMessage: MobileMessage = {
      id: makeId('message'),
      role: 'user',
      content: text,
      createdAt: now,
      attachmentName: attachment?.name,
    }
    const threadId = thread.id
    const employee = selectedEmployee
    const runtimePrompt = attachment
      ? attachment.text
        ? `${text}\n\nAttached file "${attachment.name}" contains:\n${attachment.text.slice(0, 12_000)}`
        : `${text}\n\nThe user attached "${attachment.name}", but this local demo cannot read that file type. Say so clearly if its contents are needed.`
      : text
    updateThread(threadId, (current) => ({
      ...current,
      title: current.messages.length ? current.title : titleFromPrompt(text),
      messages: [...current.messages, userMessage],
      updatedAt: now,
    }))
    setDraft('')
    setAttachment(null)
    startPending(threadId)
    try {
      const space = thread.workspace ?? (await provisionWorkspace(destination, text))
      if (!thread.workspace) {
        updateThread(threadId, (current) => ({ ...current, workspace: space, updatedAt: Date.now() }))
      }
      const crewPrompt = workspacePrompt(space, runtimePrompt)
      const route = resolveSendRoute({
        executionMode,
        signedIn,
        demoSession: cloudReadiness.demoSession,
        cloudReady: cloudReadiness.ready,
        cloudBlockReason: cloudReadiness.reason,
        browserKeyReady: liveReady,
      })

      if (route.kind === 'blocked') {
        updateThread(threadId, (current) => ({
          ...current,
          messages: [
            ...current.messages,
            {
              id: makeId('message'),
              role: 'assistant',
              content: `${route.message} Open Settings → AI Providers to connect one.`,
              createdAt: Date.now(),
            },
          ],
          updatedAt: Date.now(),
        }))
        return
      }

      if (route.kind === 'cloud_enqueue') {
        const queued = await enqueueRun(
          crewPrompt,
          buildCloudRunOptions({ workspace: space, skill: turnSkill, runtimeId, route }),
        )
        appendRunMessage(threadId, queued)
        watchQueuedRun(threadId, queued.id)
        return
      }

      const turnBrain =
        route.kind === 'demo_runTurn'
          ? simulatedBrain()
          : liveBrain({
              baseUrl: providerSpec.baseUrl,
              model: providerSpec.model,
              key: provider.apiKey.trim(),
              fixedParams: providerSpec.fixedParams,
            })

      const result = await withExecutionMode(route.kind === 'demo_runTurn' ? 'demo' : 'strict', () =>
        runTurn(crewPrompt, turnBrain, {
          lead: employee,
          skill: turnSkill,
          workspace: space,
          onTrace: (line) => pushTrace(threadId, line),
          planner: plannerBrain,
          persist: true,
          platformKeys: true,
        }),
      )
      const assistantMessage: MobileMessage = {
        id: makeId('message'),
        role: 'assistant',
        content: result.answer,
        createdAt: Date.now(),
        trace: result.trace,
        toolCalls: result.members.flatMap((mem) => mem.result.toolCalls),
        crewRun: {
          employeeIds: result.employeeIds,
          memberNames: result.members.map((mem) => mem.name),
          artifacts: result.artifacts,
          project: result.project,
        },
      }
      updateThread(threadId, (current) => ({
        ...current,
        messages: [...current.messages, assistantMessage],
        updatedAt: Date.now(),
      }))
      if (voice.autoSpeak && openAiVoiceReady) {
        void speakReply(assistantMessage.id, assistantMessage.content)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The agent could not finish this request.'
      updateThread(threadId, (current) => ({
        ...current,
        messages: [
          ...current.messages,
          {
            id: makeId('message'),
            role: 'assistant',
            content: `I hit a problem while working on that: ${message}`,
            createdAt: Date.now(),
          },
        ],
        updatedAt: Date.now(),
      }))
    } finally {
      clearPending(threadId)
    }
  }
  const handleFile = async (file?: File) => {
    if (!file) return
    const readable = /^(text\/|application\/(json|csv))/.test(file.type) || /\.(md|txt|csv|json)$/i.test(file.name)
    const text = readable && file.size <= 250_000 ? await file.text() : undefined
    setAttachment({ name: file.name, text })
  }
  const toggleRecording = async () => {
    if (transcribing || activeBusy) return
    if (!openAiVoiceReady) {
      setVoiceOpen(true)
      return
    }
    if (recording) {
      recordingRef.current?.stop()
      return
    }
    try {
      stopOpenAiSpeech()
      setRecording(true)
      const session = await recordMicrophone()
      recordingRef.current = session
      const blob = await session.done
      setRecording(false)
      recordingRef.current = null
      setTranscribing(true)
      const text = await transcribeOpenAi(provider.apiKey.trim(), blob)
      if (text) {
        setDraft((current) => (current ? `${current.trimEnd()} ${text}` : text))
        requestAnimationFrame(() => textareaRef.current?.focus())
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Voice input failed'
      setDraft((current) => current || `[Voice error: ${message}]`)
    } finally {
      setRecording(false)
      setTranscribing(false)
      recordingRef.current = null
    }
  }
  const activeStatus = useMemo(() => {
    if (!activeTrace) return ''
    return activeTrace.at(-1)?.text ?? `${selectedEmployee.name} is thinking…`
  }, [activeTrace, selectedEmployee.name])
  return (
    <div className="mobile-app relative flex h-[100dvh] overflow-hidden bg-[#121212] text-[#e8e6e1]">
      <nav className="hidden w-12 shrink-0 flex-col items-center border-r border-white/10 bg-[#181818] py-2 lg:flex" aria-label="Workbench">
        <button type="button" onClick={newThread} className="flex h-10 w-10 items-center justify-center rounded-lg text-white/60 hover:bg-white/10" aria-label="New session">
          <Plus className="h-[18px] w-[18px]" />
        </button>
        <button type="button" onClick={() => setCommandOpen(true)} className="mt-1 flex h-10 w-10 items-center justify-center rounded-lg text-white/60 hover:bg-white/10" aria-label="Search skills">
          <Search className="h-[18px] w-[18px]" />
        </button>
        <button type="button" onClick={() => setAppsOpen(true)} className="mt-1 flex h-10 w-10 items-center justify-center rounded-lg text-white/60 hover:bg-white/10" aria-label="Connect">
          <Plug className="h-[18px] w-[18px]" />
        </button>
        <div className="flex-1" />
        <p className="mb-1 max-w-[44px] truncate px-0.5 text-center text-[8px] leading-3 text-white/35" title={accountEmail ?? 'Sign in'}>
          {accountEmail ?? 'guest'}
        </p>
        <button type="button" onClick={() => setSettingsOpen(true)} className="flex h-10 w-10 items-center justify-center rounded-lg text-white/60 hover:bg-white/10" aria-label="Settings">
          <Settings className="h-[18px] w-[18px]" />
        </button>
      </nav>
      <aside className="hidden w-[276px] shrink-0 flex-col border-r border-white/10 bg-[#1a1a1a] lg:flex">
        <ThreadList
          threads={threads}
          activeId={activeThread.id}
          onPick={setActiveId}
          onNew={newThread}
          onDelete={deleteThread}
        />
      </aside>
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="mobile-scrim-in absolute inset-0 bg-black/35 backdrop-blur-[2px]"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close session history"
          />
          <aside className="mobile-drawer-in absolute inset-y-0 left-0 flex w-[min(84vw,320px)] flex-col bg-[#1a1a1a] shadow-2xl">
            <ThreadList
              threads={threads}
              activeId={activeThread.id}
              onPick={(id) => {
                setActiveId(id)
                setDrawerOpen(false)
              }}
              onNew={newThread}
              onDelete={deleteThread}
            />
          </aside>
        </div>
      )}
      <main className="relative flex min-w-0 flex-1 flex-col bg-[#1e1e1e]">
        <header className="z-20 flex h-[calc(3.75rem+env(safe-area-inset-top))] shrink-0 items-end border-b border-white/10 bg-[#1e1e1e] px-3 pb-2.5 pt-[env(safe-area-inset-top)] sm:px-5">
          <div className="flex w-full items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="mobile-tap flex h-10 w-10 items-center justify-center rounded-xl text-white/70 hover:bg-white/10 lg:hidden"
              aria-label="Open session history"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="mobile-tap flex min-w-0 items-center gap-2 rounded-xl px-2 py-1.5">
              <AgentMark employee={selectedEmployee} small />
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-[13px] font-semibold leading-none text-white">
                  {selectedEmployee.name}
                </span>
                <span className="mt-1 flex items-center gap-1 text-[10px] leading-none text-white/45">
                  {online ? <Wifi className="h-2.5 w-2.5" /> : <WifiOff className="h-2.5 w-2.5" />}
                  {online ? executionLabel : 'Offline'}
                </span>
              </span>
            </div>
            <span className="min-w-0 flex-1 truncate text-center text-xs font-medium text-white/40">
              {hasMessages ? activeThread.title : ''}
            </span>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="mobile-tap flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[#c8c5be] hover:bg-white/10"
              aria-label="Settings"
            >
              <Settings className="h-[18px] w-[18px]" />
            </button>
            <button
              type="button"
              onClick={newThread}
              className="mobile-tap flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white/70 hover:bg-white/10"
              aria-label="New session"
            >
              <SquarePen className="h-[18px] w-[18px]" />
            </button>
            <button
              type="button"
              className="mobile-tap hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white/70 hover:bg-white/10 sm:flex"
              aria-label="Session options"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-lenis-prevent>
          {!hasMessages ? (
            <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-4 pb-8 pt-8 sm:px-8">
              <div className="mobile-welcome-in mx-auto w-full max-w-xl">
                <div className="mb-6 flex items-center justify-center">
                  <AgentMark employee={selectedEmployee} />
                </div>
                <h1 className="text-center text-[30px] font-semibold leading-[1.1] tracking-[-0.045em] sm:text-[38px]">
                  What can I help you do?
                </h1>
                <p className="mx-auto mt-3 max-w-md text-center text-sm leading-6 text-white/45">
                  Connect GitHub / Slack / Gmail, then pick where work should land.
                </p>
                <div className="mt-8 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {STARTERS.map((starter, index) => (
                    <button
                      key={starter.label}
                      type="button"
                      onClick={() => void sendPrompt(starter.prompt)}
                      className="mobile-starter-in mobile-tap group flex min-h-[112px] flex-col justify-between rounded-2xl border border-white/10 bg-[#252525] p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-white/20"
                      style={{ animationDelay: `${index * 55 + 100}ms` }}
                    >
                      <span
                        className="flex h-8 w-8 items-center justify-center rounded-xl text-white"
                        style={{ background: starter.color }}
                      >
                        <starter.icon className="h-4 w-4" />
                      </span>
                      <span className="text-[13px] font-medium leading-4 text-white/90">{starter.label}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-5 text-center text-[11px] text-white/35">
                  Open source · your models · your keys
                </p>
              </div>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl space-y-7 px-4 py-7 sm:px-8 sm:py-10">
              {activeThread.workspace && (
                <div className="rounded-2xl border border-white/10 bg-[#252525] px-3.5 py-2.5 text-[12px] leading-5 text-white/55">
                  <span className="font-medium text-white/90">
                    {activeThread.workspace.kind === 'github'
                      ? `GitHub · ${activeThread.workspace.branch}`
                      : activeThread.workspace.kind === 'slack'
                        ? 'Slack'
                        : 'OpenMind'}
                  </span>
                  {' · '}
                  {activeThread.workspace.repoUrl ? (
                    <a href={activeThread.workspace.repoUrl} className="text-[#ff4d00] underline-offset-2 hover:underline" target="_blank" rel="noreferrer">
                      {activeThread.workspace.repoName ?? activeThread.workspace.slug}
                    </a>
                  ) : (
                    activeThread.workspace.summary
                  )}
                </div>
              )}
              {activeThread.messages.map((message) =>
                message.role === 'user' ? (
                  <div key={message.id} className="mobile-message-in flex justify-end">
                    <div className="max-w-[88%] sm:max-w-[75%]">
                      <div className="rounded-[20px] rounded-br-md bg-[#26231f] px-4 py-3 text-[14px] leading-6 text-white shadow-sm">
                        <p className="whitespace-pre-wrap">{message.content}</p>
                        {message.attachmentName && (
                          <span className="mt-2 flex items-center gap-1.5 border-t border-white/15 pt-2 text-[11px] text-white/65">
                            <Paperclip className="h-3 w-3" />
                            {message.attachmentName}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 text-right text-[10px] text-[#aaa7a0]">{formatTime(message.createdAt)}</div>
                    </div>
                  </div>
                ) : (
                  <div key={message.id} className="mobile-message-in flex gap-3">
                    <AgentMark employee={selectedEmployee} small />
                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className="text-xs font-semibold">{selectedEmployee.name}</span>
                        <span className="text-[10px] text-[#aaa7a0]">{formatTime(message.createdAt)}</span>
                        {openAiVoiceReady && (
                          <button
                            type="button"
                            onClick={() => void speakReply(message.id, message.content)}
                            className="mobile-tap ml-auto flex h-7 w-7 items-center justify-center rounded-full text-[#8a8780] hover:bg-black/5"
                            aria-label="Read reply aloud"
                          >
                            <Volume2 className={`h-3.5 w-3.5 ${speakingId === message.id ? 'text-[#ff4d00]' : ''}`} />
                          </button>
                        )}
                      </div>
                      <div className="whitespace-pre-wrap text-[14px] leading-6 text-[#e8e6e1]">{message.content}</div>
                      <TaskLedgerPanel project={message.crewRun?.project} />
                      {!!message.crewRun?.artifacts.length && (
                        <div className="mt-3 space-y-2">
                          {message.crewRun.artifacts.map((artifact) => (
                            <details key={artifact.id} className="rounded-xl border border-white/10 bg-[#252525]">
                              <summary className="cursor-pointer px-3 py-2 text-[11px] font-medium text-white/50">
                                {artifact.title} · {artifact.kind}
                              </summary>
                              <pre className="max-h-64 overflow-auto border-t border-white/10 px-3 py-2 text-[11px] leading-5 text-white/70 whitespace-pre-wrap">
                                {artifact.body}
                              </pre>
                            </details>
                          ))}
                        </div>
                      )}
                      {!!message.toolCalls?.length && (
                        <details className="mt-3 rounded-xl border border-white/10 bg-[#252525]">
                          <summary className="cursor-pointer list-none px-3 py-2 text-[11px] font-medium text-white/50">
                            <span className="flex items-center gap-2">
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                              {message.toolCalls.length} tool {message.toolCalls.length === 1 ? 'step' : 'steps'} completed
                              <ChevronDown className="ml-auto h-3.5 w-3.5" />
                            </span>
                          </summary>
                          <div className="space-y-2 border-t border-white/10 px-3 py-2.5">
                            {message.toolCalls.map((call, index) => (
                              <div key={`${call.tool}-${index}`} className="text-[11px] leading-5 text-white/45">
                                <span className="font-mono-spec font-medium text-white/80">{call.tool}</span>
                                <p className="line-clamp-3 whitespace-pre-wrap">{call.output}</p>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  </div>
                ),
              )}
              {activeBusy && (
                <div className="mobile-message-in flex gap-3" aria-live="polite">
                  <AgentMark employee={selectedEmployee} small />
                  <div className="min-w-0 flex-1 pt-1">
                    <div className="mb-2 text-xs font-semibold">{selectedEmployee.name}</div>
                    <div className="inline-flex max-w-full items-center gap-2 rounded-xl border border-white/10 bg-[#252525] px-3 py-2 text-[11px] text-white/55 shadow-sm">
                      <span className="mobile-orbit h-3.5 w-3.5 shrink-0 rounded-full border-2 border-[#ff4d00]/25 border-t-[#ff4d00]" />
                      <span className="truncate">{activeStatus}</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
        <div className="relative z-20 shrink-0 bg-[#1e1e1e] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
          <div className="mx-auto max-w-3xl">
            {attachment && (
              <div className="mb-2 inline-flex max-w-full items-center gap-2 rounded-xl border border-white/10 bg-[#252525] px-2.5 py-1.5 text-[11px] text-white/70">
                <FileText className="h-3.5 w-3.5 shrink-0 text-[#ff4d00]" />
                <span className="truncate">{attachment.name}</span>
                <button onClick={() => setAttachment(null)} className="rounded-full p-0.5 hover:bg-black/5" aria-label="Remove attachment">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            <div className="rounded-[22px] border border-white/10 bg-[#252525] p-2 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
              {!hasMessages && (
                <div className="mb-1 flex flex-wrap gap-1.5 px-1 pt-1">
                  {WORKSPACE_CHOICES.map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      title={choice.hint}
                      onClick={() => setDestination(choice.id)}
                      disabled={activeBusy}
                      className={`mobile-tap inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                        destination === choice.id
                          ? 'bg-white text-[#17140f]'
                          : 'bg-white/10 text-white/60 hover:bg-white/15'
                      }`}
                    >
                      {choice.id === 'github' ? <Github className="h-3 w-3" /> : choice.id === 'slack' ? <Hash className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                      {choice.label}
                    </button>
                  ))}
                </div>
              )}
              <textarea
                ref={textareaRef}
                rows={1}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void sendPrompt()
                  }
                }}
                    placeholder={
                      hasMessages
                        ? 'Send follow-up'
                        : destination === 'github'
                        ? 'Describe the project — I’ll create a GitHub repo on main…'
                        : destination === 'slack'
                          ? 'Describe the work — I’ll post it to Slack…'
                          : 'Ask the crew anything…'
                    }
                className="block max-h-[120px] min-h-11 w-full resize-none bg-transparent px-2.5 py-2 text-[15px] leading-6 text-white outline-none placeholder:text-white/35"
                disabled={activeBusy}
              />
              {slashHits.length > 0 && (
                <div className="mb-1 max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-[#161616] py-1">
                  {slashHits.map((item) => (
                    <button
                      key={item.cmd}
                      type="button"
                      onClick={() => {
                        if (item.action) {
                          void sendPrompt(item.cmd)
                          return
                        }
                        setDraft(`${item.cmd} `)
                        if (item.skill) setSkill(item.skill)
                        textareaRef.current?.focus()
                      }}
                      className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-white/8"
                    >
                      <span className="font-mono-spec text-[11px] text-[#ff4d00]">{item.cmd}</span>
                      <span className="text-[11px] text-white/45">{item.desc}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCommandOpen(true)}
                  className="mobile-tap flex h-9 w-9 items-center justify-center rounded-full text-white/50 hover:bg-white/10"
                  aria-label="Skills, files, model, Connect"
                >
                  <Plus className="h-[18px] w-[18px]" />
                </button>
                <button
                  type="button"
                  onClick={() => void toggleRecording()}
                  disabled={activeBusy || transcribing}
                  className={`mobile-tap flex h-9 w-9 items-center justify-center rounded-full ${
                    recording ? 'bg-[#ff4d00]/15 text-[#ff4d00]' : 'text-white/50 hover:bg-white/10'
                  }`}
                  aria-label={recording ? 'Stop recording' : 'Speak your message'}
                >
                  <Mic className={`h-[18px] w-[18px] ${recording ? 'animate-pulse' : ''}`} />
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,.pdf,.txt,.md,.csv,.json"
                  className="hidden"
                  onChange={(event) => {
                    void handleFile(event.target.files?.[0])
                    event.target.value = ''
                  }}
                />
                <button
                  type="button"
                  onClick={() => setCommandOpen(true)}
                  className="mobile-tap flex h-9 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium text-white/50 hover:bg-white/10"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {SKILLS.find((item) => item.id === skill)?.name ?? 'Chat'}
                  <ChevronDown className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setVoiceOpen(true)}
                  className="mobile-tap flex h-9 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium text-white/50 hover:bg-white/10"
                  aria-label="Model"
                >
                  Auto
                </button>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => void sendPrompt()}
                  disabled={!draft.trim() || activeBusy}
                  className="mobile-tap flex h-9 w-9 items-center justify-center rounded-full bg-[#ff4d00] text-white shadow-sm transition-colors hover:bg-[#e94500] disabled:bg-white/10 disabled:text-white/25"
                  aria-label="Send message"
                >
                  <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.5} />
                </button>
              </div>
            </div>
            <p className="mt-2 hidden text-center text-[10px] text-white/30 sm:block">
              Agents can make mistakes. Review important work.
            </p>
          </div>
        </div>
      </main>
      <FilesBrowserPanel
        artifacts={latestArtifacts}
        browserUrl={browserUrl}
        onBrowserUrl={navigateBrowser}
        fileBody={openFileBody}
        onOpenFile={(artifact) => setOpenFileBody(artifact.body)}
      />
      <ConnectAppsSheet open={appsOpen} onClose={() => setAppsOpen(false)} />
      <CommandSheet
        open={commandOpen}
        skill={skill}
        modelName={executionMode === 'demo' ? 'Demo' : liveReady ? providerSpec.model : 'Not configured'}
        onClose={() => setCommandOpen(false)}
        onPickSkill={setSkill}
        onFiles={() => fileRef.current?.click()}
        onModel={() => setVoiceOpen(true)}
        onMcp={() => setAppsOpen(true)}
      />
      {settingsOpen && (
        <div className="fixed inset-0 z-[76] flex items-end justify-center lg:items-center" role="dialog" aria-modal="true" aria-label="Settings">
          <button className="absolute inset-0 bg-black/50" onClick={() => setSettingsOpen(false)} aria-label="Close settings" />
          <div className="relative z-10 w-full rounded-t-[28px] bg-[#1c1c1c] px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 text-white shadow-2xl lg:max-w-md lg:rounded-[24px]">
            <div className="mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Settings className="h-4 w-4" />
                Settings
              </span>
              <button type="button" onClick={() => setSettingsOpen(false)} className="rounded-full p-1 text-white/50 hover:bg-white/10" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-[11px] uppercase tracking-[0.12em] text-white/35">Account</p>
            <p className="mt-1 truncate text-sm">{accountEmail ?? 'Not signed in'}</p>
            {!accountEmail && (
              <Link to="/login?next=/app" className="mt-2 inline-block text-[12px] text-[#ff4d00]">
                Sign in
              </Link>
            )}
            <p className="mt-5 text-[11px] uppercase tracking-[0.12em] text-white/35">Execution</p>
            <p className="mt-1 text-[12px] text-white/55">{executionLabel}</p>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {(['cloud', 'browser_direct', 'demo'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={mode === 'cloud' && !signedIn}
                  onClick={() => {
                    setExecutionMode(mode)
                    saveExecutionMode(mode)
                    if (mode === 'cloud') void fetchCloudReadiness().then(setCloudReadiness)
                  }}
                  className={`rounded-lg px-2 py-2 text-[11px] font-medium ${
                    executionMode === mode ? 'bg-[#ff4d00] text-white' : 'bg-white/10 text-white/70'
                  } disabled:opacity-40`}
                >
                  {mode === 'cloud' ? 'Cloud' : mode === 'browser_direct' ? 'Browser' : 'Demo'}
                </button>
              ))}
            </div>
            {executionMode === 'cloud' && !cloudReadiness.ready && cloudReadiness.reason ? (
              <p className="mt-2 text-[12px] text-amber-200/90">{cloudReadiness.reason}</p>
            ) : null}
            {executionMode === 'cloud' ? (
              <div className="mt-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-white/35">Runtime</p>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {(['builtin', 'claude-code'] as const).map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setRuntimeId(id)
                        saveRuntimeId(id)
                      }}
                      className={`rounded-lg px-2 py-2 text-[11px] font-medium ${
                        runtimeId === id ? 'bg-white/20 text-white' : 'bg-white/10 text-white/70'
                      }`}
                    >
                      {id === 'builtin' ? 'OpenMind Native' : 'Claude Code'}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {executionMode === 'cloud' && !cloudReadiness.ready ? (
              <Link
                to={CLOUD_PROVIDER_SETTINGS_PATH}
                onClick={() => setSettingsOpen(false)}
                className="mt-3 block w-full rounded-xl bg-[#ff4d00]/90 py-3 text-center text-sm font-medium"
              >
                Open AI Provider Settings
              </Link>
            ) : null}
            <Link
              to="/settings/general"
              onClick={() => setSettingsOpen(false)}
              className="mt-5 block w-full rounded-xl bg-white/10 py-3 text-center text-sm"
            >
              Settings
            </Link>
            <button
              type="button"
              onClick={() => { setSettingsOpen(false); setVoiceOpen(true) }}
              className="mt-2 w-full rounded-xl bg-white/10 py-3 text-sm"
            >
              Voice
            </button>
            <button
              type="button"
              onClick={() => { setSettingsOpen(false); setAppsOpen(true) }}
              className="mt-2 w-full rounded-xl bg-white/10 py-3 text-sm"
            >
              Connect apps
            </button>
          </div>
        </div>
      )}
      <ToolConfirmHost />
      <VoiceSheet
        open={voiceOpen}
        provider={provider}
        voice={voice}
        onClose={() => setVoiceOpen(false)}
        onVoiceChange={persistVoice}
      />
    </div>
  )}
