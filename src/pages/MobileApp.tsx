import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import {
  ArrowLeft,
  ArrowUp,
  BarChart3,
  Bot,
  Check,
  ChevronDown,
  Code2,
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
  Presentation,
  Search,
  Sparkles,
  SquarePen,
  Trash2,
  Volume2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import { PRESET_EMPLOYEES } from '@/data/employees'
import {
  liveBrain,
  simulatedBrain,
  type Employee,
  type TraceLine,
} from '@/lib/agent'
import { assembleCrew, runCrew } from '@/lib/crew'
import {
  loadMobileVoiceSettings,
  OPENAI_TTS_VOICES,
  playOpenAiSpeech,
  recordMicrophone,
  saveMobileVoiceSettings,
  stopOpenAiSpeech,
  transcribeOpenAi,
  type MobileVoiceSettings,
  type OpenAiTtsVoice,
} from '@/lib/openai-voice'
import {
  loadMobileProvider,
  mobileLiveReady,
  resolveMobileProviderSpec,
  saveMobileProvider,
  type MobileProviderConfig,
} from '@/lib/mobile-provider'
import {
  MOBILE_THREADS_KEY,
  createMobileThread,
  makeId,
  parseMobileThreads,
  sortMobileThreads,
  titleFromPrompt,
  type MobileMessage,
  type MobileThread,
} from '@/lib/mobile-chat'
import { defaultWorkspaceKind, provisionWorkspace } from '@/lib/workspace-act'
import {
  WORKSPACE_CHOICES,
  workspacePrompt,
  type WorkspaceKind,
} from '@/lib/workspace'
import ConnectAppsSheet from '@/components/mobile/ConnectAppsSheet'
import { getSession } from '@/lib/auth'
import { setNangoOwner } from '@/lib/nango'

const MOBILE_ASSISTANT: Employee = {
  id: 'openmind',
  name: 'OpenMind',
  role: 'General Assistant',
  prompt:
    'You are a capable, practical assistant. Break work into clear steps, use tools when useful, and be honest about what you can and cannot access.',
    tools: ['search_docs', 'summarize', 'sentiment', 'calculator', 'code_review', 'web_search', 'browse_url', 'run_code', 'github_write_file', 'github_create_branch', 'github_open_pr', 'slack_post', 'gmail_send', 'gdrive_list'],
  connections: ['github', 'gdrive', 'slack'],
  accent: '#ff4d00',
  tagline: 'Research, reason and get work done',
}

const MOBILE_EMPLOYEES = [MOBILE_ASSISTANT, ...PRESET_EMPLOYEES]

const STARTERS = [
  {
    label: 'Research a topic',
    prompt: 'Research the most important trends in open-source AI agents and give me a concise brief.',
    icon: Search,
    color: '#286a54',
  },
  {
    label: 'Review code',
    prompt: 'Review this code and help me find the most important bugs and risks.',
    icon: Code2,
    color: '#6c50a1',
  },
  {
    label: 'Analyze data',
    prompt: 'Help me analyze a dataset and turn the findings into clear recommendations.',
    icon: BarChart3,
    color: '#2f6594',
  },
  {
    label: 'Create a deck',
    prompt: 'Create an outline for a clear 8-slide presentation about my next big idea.',
    icon: Presentation,
    color: '#a34f36',
  },
]

interface PendingAttachment {
  name: string
  text?: string
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(timestamp)
}

function getStoredThreads(): MobileThread[] {
  if (typeof window === 'undefined') return [createMobileThread()]
  const saved = parseMobileThreads(localStorage.getItem(MOBILE_THREADS_KEY))
  return saved.length ? saved : [createMobileThread()]
}

function AgentMark({ employee, small = false }: { employee: Employee; small?: boolean }) {
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
  )
}

function ThreadList({
  threads,
  activeId,
  onPick,
  onNew,
  onDelete,
}: {
  threads: MobileThread[]
  activeId: string
  onPick: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}) {
  return (
    <>
      <div className="flex items-center justify-between px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
        <Link to="/" className="flex items-center gap-2 rounded-xl px-1 py-1 transition-colors hover:bg-black/5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#17140f] text-white">
            <Bot className="h-4 w-4" />
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.02em]">OpenMind</span>
        </Link>
        <button
          type="button"
          onClick={onNew}
          className="mobile-tap flex h-9 w-9 items-center justify-center rounded-xl text-[#686761] hover:bg-black/5 hover:text-[#17140f]"
          aria-label="New session"
        >
          <SquarePen className="h-[18px] w-[18px]" />
        </button>
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={onNew}
          className="mobile-tap flex w-full items-center gap-2.5 rounded-xl bg-[#17140f] px-3.5 py-3 text-sm font-medium text-white hover:bg-[#2a2722]"
        >
          <Plus className="h-4 w-4" />
          New session
        </button>
      </div>

      <div className="mt-6 flex items-center gap-2 px-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8d8b84]">
        <History className="h-3.5 w-3.5" />
        Recent
      </div>

      <nav className="mt-2 flex-1 space-y-1 overflow-y-auto px-2 pb-4" aria-label="Recent sessions">
        {sortMobileThreads(threads).map((thread) => (
          <div
            key={thread.id}
            className={`group flex items-center rounded-xl transition-colors ${
              activeId === thread.id ? 'bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'hover:bg-white/70'
            }`}
          >
            <button
              type="button"
              onClick={() => onPick(thread.id)}
              className="min-w-0 flex-1 px-3 py-2.5 text-left"
            >
              <span className="block truncate text-[13px] font-medium text-[#292722]">{thread.title}</span>
              <span className="mt-0.5 block text-[11px] text-[#939089]">
                {thread.messages.length ? `${thread.messages.length} messages` : 'Ready when you are'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onDelete(thread.id)}
              className="mobile-tap mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#aaa7a0] opacity-100 hover:bg-[#f2efea] hover:text-red-600 lg:opacity-0 lg:group-hover:opacity-100"
              aria-label={`Delete ${thread.title}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </nav>

      <div className="border-t border-black/[0.07] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Link
          to="/dashboard"
          className="flex items-center gap-3 rounded-xl px-2 py-2 text-xs text-[#77746d] transition-colors hover:bg-white hover:text-[#17140f]"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white">
            <ArrowLeft className="h-3.5 w-3.5" />
          </span>
          Open desktop console
        </Link>
      </div>
    </>
  )
}

function AssistantPicker({
  open,
  selected,
  onClose,
  onPick,
}: {
  open: boolean
  selected: Employee
  onClose: () => void
  onPick: (employee: Employee) => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center lg:items-center" role="dialog" aria-modal="true" aria-label="Choose an assistant">
      <button className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={onClose} aria-label="Close assistant picker" />
      <div className="mobile-sheet-in relative z-10 w-full rounded-t-[28px] bg-white px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl lg:max-w-md lg:rounded-[24px] lg:p-5">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-black/15 lg:hidden" />
        <div className="mb-4 flex items-center justify-between px-1">
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.02em]">Choose an assistant</h2>
            <p className="mt-0.5 text-xs text-[#85827b]">Each one brings a different brief and toolset.</p>
          </div>
          <button onClick={onClose} className="mobile-tap flex h-9 w-9 items-center justify-center rounded-full bg-[#f3f1ed]" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2">
          {MOBILE_EMPLOYEES.map((employee) => (
            <button
              key={employee.id}
              type="button"
              onClick={() => onPick(employee)}
              className={`mobile-tap flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${
                selected.id === employee.id ? 'border-[#17140f] bg-[#faf9f6]' : 'border-black/[0.07] hover:bg-[#faf9f6]'
              }`}
            >
              <AgentMark employee={employee} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {employee.name}
                  <span className="text-[11px] font-normal text-[#96938c]">{employee.role}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-[#7e7b74]">{employee.tagline}</span>
              </span>
              {selected.id === employee.id && <Check className="h-4 w-4 text-[#17140f]" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function VoiceSheet({
  open,
  provider,
  voice,
  onClose,
  onProviderChange,
  onVoiceChange,
}: {
  open: boolean
  provider: MobileProviderConfig
  voice: MobileVoiceSettings
  onClose: () => void
  onProviderChange: (next: MobileProviderConfig) => void
  onVoiceChange: (next: MobileVoiceSettings) => void
}) {
  if (!open) return null
  const spec = resolveMobileProviderSpec(provider)
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center lg:items-center" role="dialog" aria-modal="true" aria-label="Voice settings">
      <button className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={onClose} aria-label="Close voice settings" />
      <div className="mobile-sheet-in relative z-10 w-full rounded-t-[28px] bg-white px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl lg:max-w-md lg:rounded-[24px] lg:p-5">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-black/15 lg:hidden" />
        <div className="mb-4 flex items-center justify-between px-1">
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.02em]">Voice & model</h2>
            <p className="mt-0.5 text-xs text-[#85827b]">OpenAI Whisper in · OpenAI voices out. Key stays on your device.</p>
          </div>
          <button onClick={onClose} className="mobile-tap flex h-9 w-9 items-center justify-center rounded-full bg-[#f3f1ed]" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8d8b84]">OpenAI API key</label>
        <input
          type="password"
          value={provider.apiKey}
          onChange={(event) => onProviderChange({ ...provider, apiKey: event.target.value })}
          placeholder="sk-..."
          className="mt-1.5 w-full rounded-xl border border-black/10 bg-[#faf9f6] px-3 py-2.5 text-sm outline-none focus:border-[#17140f]"
          autoComplete="off"
        />
        <p className="mt-1.5 text-[11px] text-[#aaa7a0]">
          Chat uses {spec.model}. Search and browse are open-source by default (DuckDuckGo + Jina) once agent-tools is deployed. Keys below are optional upgrades.
        </p>
        <label className="mt-5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8d8b84]">Tavily (optional search upgrade)</label>
        <input
          type="password"
          value={provider.tavilyKey ?? ''}
          onChange={(event) => onProviderChange({ ...provider, tavilyKey: event.target.value })}
          placeholder="tvly-... leave empty to use DuckDuckGo"
          className="mt-1.5 w-full rounded-xl border border-black/10 bg-[#faf9f6] px-3 py-2.5 text-sm outline-none focus:border-[#17140f]"
          autoComplete="off"
        />
        <label className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8d8b84]">Firecrawl (optional browse upgrade)</label>
        <input
          type="password"
          value={provider.firecrawlKey ?? ''}
          onChange={(event) => onProviderChange({ ...provider, firecrawlKey: event.target.value })}
          placeholder="fc-... leave empty to use Jina / fetch"
          className="mt-1.5 w-full rounded-xl border border-black/10 bg-[#faf9f6] px-3 py-2.5 text-sm outline-none focus:border-[#17140f]"
          autoComplete="off"
        />
        <label className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8d8b84]">E2B (run code)</label>
        <input
          type="password"
          value={provider.e2bKey ?? ''}
          onChange={(event) => onProviderChange({ ...provider, e2bKey: event.target.value })}
          placeholder="e2b_... (optional)"
          className="mt-1.5 w-full rounded-xl border border-black/10 bg-[#faf9f6] px-3 py-2.5 text-sm outline-none focus:border-[#17140f]"
          autoComplete="off"
        />
        <label className="mt-5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8d8b84]">Voice</label>
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
          Save
        </button>
      </div>
    </div>
  )
}

export default function MobileApp() {
  const [threads, setThreads] = useState<MobileThread[]>(getStoredThreads)
  const [activeId, setActiveId] = useState(() => threads[0].id)
  const [draft, setDraft] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [appsOpen, setAppsOpen] = useState(false)
  const [provider, setProvider] = useState<MobileProviderConfig>(() => loadMobileProvider())
  const [voice, setVoice] = useState<MobileVoiceSettings>(() => loadMobileVoiceSettings())
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null)
  const [liveTrace, setLiveTrace] = useState<TraceLine[]>([])
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null)
  const [destination, setDestination] = useState<WorkspaceKind>(() => defaultWorkspaceKind())
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const recordingRef = useRef<{ stop: () => void } | null>(null)

  const liveReady = mobileLiveReady(provider)
  const providerSpec = resolveMobileProviderSpec(provider)
  const openAiVoiceReady = provider.providerId === 'openai' && provider.apiKey.trim().length > 0

  const brain = () =>
    liveReady
      ? liveBrain({
          baseUrl: providerSpec.baseUrl,
          model: providerSpec.model,
          key: provider.apiKey.trim(),
          fixedParams: providerSpec.fixedParams,
        })
      : simulatedBrain()

  const persistProvider = (next: MobileProviderConfig) => {
    setProvider(next)
    saveMobileProvider(next)
  }

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
  const selectedEmployee =
    MOBILE_EMPLOYEES.find((employee) => employee.id === activeThread?.employeeId) ?? MOBILE_ASSISTANT
  const hasMessages = (activeThread?.messages.length ?? 0) > 0

  useEffect(() => {
    localStorage.setItem(MOBILE_THREADS_KEY, JSON.stringify(threads))
  }, [threads])

  useEffect(() => {
    void getSession().then((session) => {
      if (session?.user.id) setNangoOwner(session.user.id)
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
  }, [activeThread?.messages.length, pendingThreadId, liveTrace.length])

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

  const deleteThread = (id: string) => {
    if (pendingThreadId === id) return
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

  const sendPrompt = async (override?: string) => {
    const text = (override ?? draft).trim()
    const thread = activeThread
    if (!text || !thread || pendingThreadId) return

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
    setPendingThreadId(threadId)
    setLiveTrace([])

    try {
      const space = thread.workspace ?? (await provisionWorkspace(destination, text))
      if (!thread.workspace) {
        updateThread(threadId, (current) => ({ ...current, workspace: space, updatedAt: Date.now() }))
      }
      const crewPrompt = workspacePrompt(space, runtimePrompt)
      const crew = assembleCrew(employee, crewPrompt)
      const result = await runCrew(crewPrompt, brain(), {
        employees: crew,
        workspace: space,
        onTrace: (line) => setLiveTrace((trace) => [...trace, line]),
        toolKeys: {
          tavily: provider.tavilyKey,
          firecrawl: provider.firecrawlKey,
          e2b: provider.e2bKey,
        },
      })
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
      setPendingThreadId(null)
      setLiveTrace([])
    }
  }

  const handleFile = async (file?: File) => {
    if (!file) return
    const readable = /^(text\/|application\/(json|csv))/.test(file.type) || /\.(md|txt|csv|json)$/i.test(file.name)
    const text = readable && file.size <= 250_000 ? await file.text() : undefined
    setAttachment({ name: file.name, text })
  }

  const toggleRecording = async () => {
    if (transcribing || pendingThreadId) return
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

  const selectEmployee = (employee: Employee) => {
    updateThread(activeThread.id, (thread) => ({ ...thread, employeeId: employee.id, updatedAt: Date.now() }))
    setPickerOpen(false)
  }

  const activeStatus = useMemo(() => {
    if (!pendingThreadId) return ''
    return liveTrace.at(-1)?.text ?? `${selectedEmployee.name} is thinking…`
  }, [liveTrace, pendingThreadId, selectedEmployee.name])

  return (
    <div className="mobile-app relative flex h-[100dvh] overflow-hidden bg-[#f8f7f4] text-[#17140f]">
      <aside className="hidden w-[276px] shrink-0 flex-col border-r border-black/[0.07] bg-[#efede8] lg:flex">
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
          <aside className="mobile-drawer-in absolute inset-y-0 left-0 flex w-[min(84vw,320px)] flex-col bg-[#efede8] shadow-2xl">
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

      <main className="relative flex min-w-0 flex-1 flex-col bg-[#fbfaf8]">
        <header className="z-20 flex h-[calc(3.75rem+env(safe-area-inset-top))] shrink-0 items-end border-b border-black/[0.06] bg-[#fbfaf8]/90 px-3 pb-2.5 pt-[env(safe-area-inset-top)] backdrop-blur-xl sm:px-5">
          <div className="flex w-full items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="mobile-tap flex h-10 w-10 items-center justify-center rounded-xl text-[#5f5d57] hover:bg-black/5 lg:hidden"
              aria-label="Open session history"
            >
              <Menu className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="mobile-tap flex min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-black/5"
            >
              <AgentMark employee={selectedEmployee} small />
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-[13px] font-semibold leading-none">
                  {selectedEmployee.name}
                  <ChevronDown className="h-3.5 w-3.5 text-[#8a8780]" />
                </span>
                <span className="mt-1 flex items-center gap-1 text-[10px] leading-none text-[#908d86]">
                  {online ? <Wifi className="h-2.5 w-2.5" /> : <WifiOff className="h-2.5 w-2.5" />}
                  {online
                    ? liveReady
                      ? `Live · ${providerSpec.name}`
                      : 'Simulated · tap speaker to add key'
                    : 'Offline'}
                </span>
              </span>
            </button>
            <span className="min-w-0 flex-1 truncate text-center text-xs font-medium text-[#77746d]">
              {hasMessages ? activeThread.title : ''}
            </span>
            <button
              type="button"
              onClick={() => setAppsOpen(true)}
              className="mobile-tap flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[#5f5d57] hover:bg-black/5"
              aria-label="Connect your apps"
            >
              <Plug className="h-[18px] w-[18px]" />
            </button>
            <button
              type="button"
              onClick={newThread}
              className="mobile-tap flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[#5f5d57] hover:bg-black/5"
              aria-label="New session"
            >
              <SquarePen className="h-[18px] w-[18px]" />
            </button>
            <button
              type="button"
              className="mobile-tap hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[#5f5d57] hover:bg-black/5 sm:flex"
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
                <p className="mx-auto mt-3 max-w-md text-center text-sm leading-6 text-[#77746d]">
                  Connect GitHub / Slack / Gmail, then pick where work should land.
                </p>
                <div className="mt-8 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {STARTERS.map((starter, index) => (
                    <button
                      key={starter.label}
                      type="button"
                      onClick={() => void sendPrompt(starter.prompt)}
                      className="mobile-starter-in mobile-tap group flex min-h-[112px] flex-col justify-between rounded-2xl border border-black/[0.07] bg-white p-3.5 text-left shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-all hover:-translate-y-0.5 hover:border-black/15 hover:shadow-md"
                      style={{ animationDelay: `${index * 55 + 100}ms` }}
                    >
                      <span
                        className="flex h-8 w-8 items-center justify-center rounded-xl text-white"
                        style={{ background: starter.color }}
                      >
                        <starter.icon className="h-4 w-4" />
                      </span>
                      <span className="text-[13px] font-medium leading-4 text-[#37342f]">{starter.label}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-5 text-center text-[11px] text-[#a09d96]">
                  Open source · your models · your keys
                </p>
              </div>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl space-y-7 px-4 py-7 sm:px-8 sm:py-10">
              {activeThread.workspace && (
                <div className="rounded-2xl border border-black/[0.07] bg-white px-3.5 py-2.5 text-[12px] leading-5 text-[#5f5c56]">
                  <span className="font-medium text-[#37342f]">
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
                      <div className="whitespace-pre-wrap text-[14px] leading-6 text-[#36332e]">{message.content}</div>
                      {!!message.crewRun?.memberNames.length && (
                        <p className="mt-2 text-[11px] text-[#7a7770]">
                          Crew: {message.crewRun.memberNames.join(' · ')}
                        </p>
                      )}
                      {!!message.crewRun?.artifacts.length && (
                        <div className="mt-3 space-y-2">
                          {message.crewRun.artifacts.map((artifact) => (
                            <details key={artifact.id} className="rounded-xl border border-black/[0.07] bg-white">
                              <summary className="cursor-pointer px-3 py-2 text-[11px] font-medium text-[#6f6c65]">
                                {artifact.title} · {artifact.kind}
                              </summary>
                              <pre className="max-h-64 overflow-auto border-t border-black/[0.06] px-3 py-2 text-[11px] leading-5 text-[#4a4742] whitespace-pre-wrap">
                                {artifact.body}
                              </pre>
                            </details>
                          ))}
                        </div>
                      )}
                      {!!message.toolCalls?.length && (
                        <details className="mt-3 rounded-xl border border-black/[0.07] bg-white">
                          <summary className="cursor-pointer list-none px-3 py-2 text-[11px] font-medium text-[#6f6c65]">
                            <span className="flex items-center gap-2">
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                              {message.toolCalls.length} tool {message.toolCalls.length === 1 ? 'step' : 'steps'} completed
                              <ChevronDown className="ml-auto h-3.5 w-3.5" />
                            </span>
                          </summary>
                          <div className="space-y-2 border-t border-black/[0.06] px-3 py-2.5">
                            {message.toolCalls.map((call, index) => (
                              <div key={`${call.tool}-${index}`} className="text-[11px] leading-5 text-[#7a7770]">
                                <span className="font-mono-spec font-medium text-[#34312d]">{call.tool}</span>
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

              {pendingThreadId === activeThread.id && (
                <div className="mobile-message-in flex gap-3" aria-live="polite">
                  <AgentMark employee={selectedEmployee} small />
                  <div className="min-w-0 flex-1 pt-1">
                    <div className="mb-2 text-xs font-semibold">{selectedEmployee.name}</div>
                    <div className="inline-flex max-w-full items-center gap-2 rounded-xl border border-black/[0.07] bg-white px-3 py-2 text-[11px] text-[#77746d] shadow-sm">
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

        <div className="relative z-20 shrink-0 bg-gradient-to-t from-[#fbfaf8] via-[#fbfaf8] to-[#fbfaf8]/0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
          <div className="mx-auto max-w-3xl">
            {attachment && (
              <div className="mb-2 inline-flex max-w-full items-center gap-2 rounded-xl border border-black/[0.08] bg-white px-2.5 py-1.5 text-[11px] text-[#5f5c56] shadow-sm">
                <FileText className="h-3.5 w-3.5 shrink-0 text-[#ff4d00]" />
                <span className="truncate">{attachment.name}</span>
                <button onClick={() => setAttachment(null)} className="rounded-full p-0.5 hover:bg-black/5" aria-label="Remove attachment">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            <div className="rounded-[22px] border border-black/[0.11] bg-white p-2 shadow-[0_8px_30px_rgba(36,32,26,0.09)] transition-shadow focus-within:shadow-[0_10px_36px_rgba(36,32,26,0.14)]">
              {!hasMessages && (
                <div className="mb-1 flex flex-wrap gap-1.5 px-1 pt-1">
                  {WORKSPACE_CHOICES.map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      title={choice.hint}
                      onClick={() => setDestination(choice.id)}
                      disabled={!!pendingThreadId}
                      className={`mobile-tap inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                        destination === choice.id
                          ? 'bg-[#17140f] text-white'
                          : 'bg-[#f2f0ec] text-[#5f5c56] hover:bg-[#e8e5df]'
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
                      destination === 'github'
                        ? 'Describe the project — I’ll create a GitHub repo on main…'
                        : destination === 'slack'
                          ? 'Describe the work — I’ll post it to Slack…'
                          : 'Ask the crew anything…'
                    }
                className="block max-h-[120px] min-h-11 w-full resize-none bg-transparent px-2.5 py-2 text-[15px] leading-6 outline-none placeholder:text-[#aaa7a0]"
                disabled={!!pendingThreadId}
              />
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void toggleRecording()}
                  disabled={!!pendingThreadId || transcribing}
                  className={`mobile-tap flex h-9 w-9 items-center justify-center rounded-full ${
                    recording ? 'bg-[#ff4d00]/15 text-[#ff4d00]' : 'text-[#68655e] hover:bg-[#f2f0ec]'
                  }`}
                  aria-label={recording ? 'Stop recording' : 'Speak your message'}
                >
                  <Mic className={`h-[18px] w-[18px] ${recording ? 'animate-pulse' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={() => setVoiceOpen(true)}
                  className="mobile-tap flex h-9 w-9 items-center justify-center rounded-full text-[#68655e] hover:bg-[#f2f0ec]"
                  aria-label="Voice settings"
                >
                  <Volume2 className="h-[18px] w-[18px]" />
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
                  onClick={() => fileRef.current?.click()}
                  className="mobile-tap flex h-9 w-9 items-center justify-center rounded-full text-[#68655e] hover:bg-[#f2f0ec]"
                  aria-label="Attach a file"
                >
                  <Plus className="h-[18px] w-[18px]" />
                </button>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="mobile-tap flex h-9 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium text-[#66635d] hover:bg-[#f2f0ec]"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {selectedEmployee.name}
                  <ChevronDown className="h-3 w-3" />
                </button>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => void sendPrompt()}
                  disabled={!draft.trim() || !!pendingThreadId}
                  className="mobile-tap flex h-9 w-9 items-center justify-center rounded-full bg-[#ff4d00] text-white shadow-sm transition-colors hover:bg-[#e94500] disabled:bg-[#dedbd5] disabled:text-[#a5a29b]"
                  aria-label="Send message"
                >
                  <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.5} />
                </button>
              </div>
            </div>
            <p className="mt-2 hidden text-center text-[10px] text-[#aaa7a0] sm:block">
              Agents can make mistakes. Review important work.
            </p>
          </div>
        </div>
      </main>

      <ConnectAppsSheet open={appsOpen} onClose={() => setAppsOpen(false)} />
      <AssistantPicker
        open={pickerOpen}
        selected={selectedEmployee}
        onClose={() => setPickerOpen(false)}
        onPick={selectEmployee}
      />
      <VoiceSheet
        open={voiceOpen}
        provider={provider}
        voice={voice}
        onClose={() => setVoiceOpen(false)}
        onProviderChange={persistProvider}
        onVoiceChange={persistVoice}
      />
    </div>
  )
}
