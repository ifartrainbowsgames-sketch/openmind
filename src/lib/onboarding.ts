// ── Onboarding / chatbot setup model ─────────────────────────────────────────
// The single source of truth for the setup wizard. One primary job: get a
// chatbot embedded on the user's site using their own provider key. The raw
// API key is never part of this config — only non-secret metadata is persisted
// (see ProviderConn). The wizard state persists to Supabase (table `onboarding`)
// and falls back to localStorage when Supabase is unconfigured or the migration
// hasn't been applied yet.

export type BuildType = 'chatbot' | 'employee'

export type Tone = 'friendly' | 'professional' | 'concise' | 'playful'

/** What we remember about a connected provider — NEVER the raw key. */
export interface ProviderConn {
  /** Provider id from SETUP_PROVIDERS, e.g. "openai". */
  id?: string
  /** Display name, e.g. "OpenAI" / "Anthropic". */
  provider: string
  /** Chosen model id, e.g. "gpt-4o-mini". */
  model?: string
  /** Base URL for custom / self-host targets (non-secret). */
  baseUrl?: string
  /** Masked hint for display only, e.g. "sk-…9f2a". */
  masked?: string
  /** True once a successful connection test has run this session. */
  connected: boolean
}

export interface WidgetAppearance {
  accent: string
  theme: 'light' | 'dark' | 'auto'
  radius: number
  voice: boolean
  video: boolean
}

export interface ChatbotConfig {
  buildType?: BuildType
  provider?: ProviderConn
  name?: string
  greeting?: string
  tone?: Tone
  /** User explicitly skipped the knowledge step. */
  knowledgeSkipped?: boolean
  appearance?: WidgetAppearance
  /** User confirmed the widget loads on their site. */
  verified?: boolean
}

export interface WizardState {
  step: number
  completed: boolean
  config: ChatbotConfig
}

export interface WizardStepDef {
  id: string
  /** Short title for the progress rail. */
  title: string
  /** Plain, non-technical heading shown at the top of the step. */
  heading: string
  /** Whether this step offers a Skip action. */
  canSkip: boolean
}

/** The happy path — steps may merge later but this is the canonical order. */
export const WIZARD_STEPS: WizardStepDef[] = [
  { id: 'welcome', title: 'Welcome', heading: "Let's get your AI live in about 5 minutes", canSkip: false },
  { id: 'provider', title: 'Provider', heading: 'Connect your AI provider', canSkip: false },
  { id: 'type', title: 'Build', heading: 'What are you building?', canSkip: false },
  { id: 'identity', title: 'Personality', heading: 'Name and personality', canSkip: false },
  { id: 'knowledge', title: 'Knowledge', heading: 'Give it knowledge (optional)', canSkip: true },
  { id: 'appearance', title: 'Appearance', heading: 'Make it look like you', canSkip: true },
  { id: 'preview', title: 'Preview', heading: 'Preview and test', canSkip: true },
  { id: 'embed', title: 'Embed', heading: 'Get your embed code', canSkip: false },
  { id: 'verify', title: 'Verify', heading: 'Verify it loaded', canSkip: true },
  { id: 'done', title: 'Done', heading: "You're live", canSkip: false },
]

export const WIZARD_STEP_COUNT = WIZARD_STEPS.length

export const DEFAULT_APPEARANCE: WidgetAppearance = {
  accent: '#ff4d00',
  theme: 'light',
  radius: 0,
  voice: false,
  video: false,
}

export const INITIAL_WIZARD_STATE: WizardState = {
  step: 0,
  completed: false,
  config: {},
}

/** Clamp a step index into range. */
export function clampStep(step: number): number {
  if (!Number.isFinite(step)) return 0
  return Math.min(Math.max(0, Math.trunc(step)), WIZARD_STEP_COUNT - 1)
}

/** Normalize whatever came back from storage into a valid WizardState. */
export function normalizeState(raw: unknown): WizardState {
  if (!raw || typeof raw !== 'object') return { ...INITIAL_WIZARD_STATE }
  const r = raw as Partial<WizardState>
  return {
    step: clampStep(typeof r.step === 'number' ? r.step : 0),
    completed: Boolean(r.completed),
    config: (r.config && typeof r.config === 'object' ? r.config : {}) as ChatbotConfig,
  }
}
