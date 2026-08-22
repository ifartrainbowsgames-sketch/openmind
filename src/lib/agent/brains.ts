import { toolName } from './connections'
import { stripWorkspacePrompt } from '../workspace'
import { parsePlannerOutput } from './plan'
import type { AgentBrain, PlanStep } from './types'

const ARITHMETIC = /[-\d(][\d\s+\-*/().%]*\d\)*/
const CONNECTION_ROUTES: { pattern: RegExp; ids: string[]; unless?: RegExp }[] = [
  { pattern: /\b(n8n|workflow|automation|automate)\b/i, ids: ['n8n'] },
  { pattern: /\b(openclaw|delegate|sub-?agent)\b/i, ids: ['openclaw'] },
  { pattern: /\bgmail\b/i, ids: ['gmail'] },
  { pattern: /\boutlook\b/i, ids: ['outlook'] },
  { pattern: /\b(e-?mails?|inbox|mail)\b/i, ids: ['gmail', 'outlook'], unless: /\b(gmail|outlook)\b/i },
  { pattern: /\b(calendar|meetings?|schedule|agenda|events?)\b/i, ids: ['gcal'] },
  { pattern: /\b(slack|channels?|mentions?)\b/i, ids: ['slack'] },
  { pattern: /\b(github|pull requests?|prs?|commits?|merge)\b/i, ids: ['github'] },
  { pattern: /\blinear\b/i, ids: ['linear'] },
  { pattern: /\bjira\b/i, ids: ['jira'] },
  { pattern: /\b(tickets?|queue)\b/i, ids: ['zendesk', 'jira'], unless: /\bjira\b/i },
  { pattern: /\b(deals?|crm|leads?|pipeline|contacts?)\b/i, ids: ['hubspot'], unless: /\bn8n\b/i },
  { pattern: /\b(notion|wiki|pages?)\b/i, ids: ['notion'] },
  { pattern: /\b(drive|files?|folders?|spreadsheets?|docs?)\b/i, ids: ['gdrive', 'notion'], unless: /\bnotion\b/i },
]

export function simulatedBrain(): AgentBrain {
  return {
    plan: async (input, tools) => {
      const user = stripWorkspacePrompt(input)
      if (user.length < 120 && /^(hi|hello|hey|yo|thanks|thank you|ok|okay)\b[!.?\s]*$/i.test(user.trim())) {
        return []
      }
      const has = (id: string) => tools.some((t) => t.id === id)
      const steps: PlanStep[] = []
      const push = (tool: string, toolInput: string) => {
        if (!steps.some((s) => s.tool === tool)) steps.push({ tool, input: toolInput })
      }
      const math = input.match(ARITHMETIC)
      if (math && /[+\-*/%]/.test(math[0]) && has('calculator')) push('calculator', math[0].trim())
      if (/\b(code|bug|refactor|function|script|typescript|javascript|python|review this)\b/i.test(input) && has('code_review'))
        push('code_review', input)
      if (/\b(https?:\/\/[^\s]+)\b/i.test(input) && has('browse_url')) {
        const url = input.match(/https?:\/\/[^\s]+/i)?.[0] ?? input
        push('browse_url', url)
      }
      if (/\b(search the web|look up|latest|trends?|research|who is|what is happening)\b/i.test(input) && has('web_search'))
        push('web_search', input)
      if (/\b(run this|execute|sandbox|python -c)\b/i.test(input) && has('run_code'))
        push('run_code', input)
      const writeJson = user.match(/\{\s*"path"\s*:\s*"[\s\S]*"content"\s*:/) ? user.match(/\{[\s\S]*\}/)?.[0] : undefined
      if (has('github_write_file') && (/github_write_file|Coding space: GitHub/i.test(input) || /\b(commit|write files?)\b/i.test(user)))
        push('github_write_file', writeJson ?? user)
      if (has('github_create_branch') && /github_create_branch|feature branch from main/i.test(user))
        push('github_create_branch', user)
      if (has('github_open_pr') && /github_open_pr|\bopen a (pr|pull request)\b/i.test(user))
        push('github_open_pr', user)
      if (has('slack_post') && /slack_post|\b(slack|post to (the )?channel)\b/i.test(input))
        push('slack_post', input)
      if (has('gmail_send') && /gmail_send|\b(send (an? )?e-?mail|email .+@)\b/i.test(input))
        push('gmail_send', input)
      if (has('gmail_list') && /gmail_list|\b(inbox|unread|e-?mails?|triage (the )?mail)\b/i.test(input))
        push('gmail_list', input)
      if (has('gmail_read') && /gmail_read/.test(input))
        push('gmail_read', input)
      if (has('web_act') && /web_act|\b(click|fill (the |this )?form|hosted chrome|do this on the (web|site)|complete (this|the) (web )?task)\b/i.test(input))
        push('web_act', input)
      if (has('business_plan') && /business_plan|\b(structure (the |our )?business|business plan|offer and price)\b/i.test(input))
        push('business_plan', input)
      if (has('gdrive_list') && /gdrive_list|\b(google drive|list (my )?files)\b/i.test(input))
        push('gdrive_list', input)
      if (has('memory_save') && /\b(remember (that|this)|save this (note|fact)|don'?t forget)\b/i.test(input))
        push('memory_save', stripWorkspacePrompt(input))
      if (has('memory_search') && /\b(what do you (know|remember)|recall|you said)\b/i.test(input))
        push('memory_search', stripWorkspacePrompt(input))
      for (const { pattern, ids, unless } of CONNECTION_ROUTES) {
        if (steps.length >= 3) break
        // A specific github_* tool already covers this; the generic connection
        // would duplicate the call against the same server.
        if (ids.includes('github') && steps.some((s) => s.tool.startsWith('github_'))) continue
        if (unless?.test(user)) continue
        const hit = ids.find(has)
        if (hit && pattern.test(user)) push(hit, user)
      }
      if (/summar|tl;dr|shorten|condense|key points/i.test(input) && has('summarize'))
        push('summarize', input)
      if (/sentiment|feeling|feels|opinion|feedback|happy|angry|upset|satisfied|tone|urgenc|critical|outage/i.test(input) && has('sentiment'))
        push('sentiment', input)
      if (steps.length === 0 && has('search_docs') && /\?|widget|price|pricing|cost|key|embed|install|provider|refund|pro plan|capabilit/i.test(user))
        push('search_docs', user)
      return steps.slice(0, 3)
    },
    respond: async (input, observations, employee) => {
      const intro = `${employee.name} here — ${employee.role.toLowerCase()}.`
      if (observations.length === 0) {
        return `${intro} My instructions: "${employee.prompt}". I don't need tools for this one — ` +
          `in live mode I'd reason it through with your configured provider. You asked: "${input}". ` +
          'Give me a task that needs research, math, summaries or tone analysis and watch the graph fire.'
      }
      const lines = observations.map((observation) => `• ${toolName(observation.tool)}: ${observation.output}`)
      return `${intro} Working per my instructions — "${employee.prompt}".\n\n${lines.join('\n')}\n\n` +
        `That's what the graph came back with. In live mode I'd phrase this in my own voice via your provider.`
    },
  }
}

export interface LiveProvider {
  baseUrl: string
  model: string
  key: string
}

export interface LiveProviderSpec {
  id: string
  name: string
  baseUrl: string
  model: string
  fixedParams?: boolean
  keyRequired?: boolean
  keyUrl: string
}

export const LIVE_PROVIDERS: readonly LiveProviderSpec[] = [
  { id: 'kimi', name: 'Kimi (Moonshot)', baseUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k3', fixedParams: true, keyUrl: 'platform.moonshot.ai → API Keys' },
  { id: 'kimi-cn', name: 'Kimi (Moonshot · CN)', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k3', fixedParams: true, keyUrl: 'platform.moonshot.cn → API Keys' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', keyUrl: 'platform.openai.com/api-keys' },
  // Anthropic serves an OpenAI-shaped endpoint at /v1/chat/completions, so it
  // needs no new client — verified against the live API before adding, not
  // assumed from documentation. Its absence was why nothing could use an
  // Anthropic key, including the Claude Code runtime that requires one.
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-haiku-4-5-20251001', keyUrl: 'console.anthropic.com → API Keys' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'moonshotai/kimi-k2.5', keyUrl: 'openrouter.ai/keys' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', keyUrl: 'console.groq.com/keys' },

  // Every entry below serves an OpenAI-shaped /chat/completions, and every
  // baseUrl was probed against the live API before being added — an
  // unauthenticated POST that came back "invalid API key" rather than 404 or a
  // DNS failure. That is the same bar the Anthropic entry above was held to.
  //
  // The MODEL ids are the weak part of this table, and that is now measured
  // rather than suspected. The first two that a real key could be tested
  // against were BOTH already dead:
  //
  //   gemini-2.5-flash     "no longer available to new users" → gemini-3.6-flash
  //   llama-3.1-8b-instant "does not exist or you do not have access"
  //
  // Both had been picked as stable-looking published ids. Two for two, within
  // days. A hard-coded default model per provider is therefore a decaying
  // asset, not a stable one: it cannot be verified without a key, and it stops
  // being true without any change on our side.
  //
  // The fix is a real catalogue plus per-key discovery, not more careful
  // guessing — models.dev covers all fifteen of these providers, and every one
  // of them serves GET /v1/models for what a specific key can actually reach.
  // See docs/PROVIDER-PLATFORM-RESEARCH.md. Until that lands, treat a model id
  // here as a default that was true when written.
  //
  // Fireworks is deliberately ABSENT. Its endpoint is real and answers, but it
  // resolves models before auth, so every id returns "not found" to an
  // unauthenticated caller and no model could be confirmed. Shipping a guessed
  // one would have meant a provider that looks connected and fails on first use.
  { id: 'xai', name: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', model: 'grok-4', keyUrl: 'console.x.ai → API Keys' },
  { id: 'google', name: 'Google (Gemini)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.6-flash', keyUrl: 'aistudio.google.com/apikey' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keyUrl: 'platform.deepseek.com → API Keys' },
  { id: 'mistral', name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', keyUrl: 'console.mistral.ai → API Keys' },
  { id: 'together', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', keyUrl: 'api.together.xyz/settings/api-keys' },
  { id: 'perplexity', name: 'Perplexity', baseUrl: 'https://api.perplexity.ai', model: 'sonar', keyUrl: 'perplexity.ai/settings/api' },
  { id: 'cohere', name: 'Cohere', baseUrl: 'https://api.cohere.ai/compatibility/v1', model: 'command-r-plus', keyUrl: 'dashboard.cohere.com/api-keys' },
  { id: 'cerebras', name: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', model: 'llama3.3-70b', keyUrl: 'cloud.cerebras.ai → API Keys' },

  { id: 'ollama', name: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', keyRequired: false, keyUrl: 'no key needed — local' },
]

/**
 * The spec for a stored provider id, or null when this build has never heard
 * of it.
 *
 * Null rather than a default, and that distinction is a security boundary.
 * Callers used to write `find(...) ?? LIVE_PROVIDERS[0]`, so a provider id that
 * had been renamed, retired, or simply mistyped did not fail — it sent the
 * CUSTOMER'S API KEY to whichever provider happened to sit first in this array.
 * A stored credential must only ever be presented to the provider it belongs
 * to, so an unknown id has to stop the run, not pick a neighbour.
 */
export function providerSpec(id: string): LiveProviderSpec | null {
  return LIVE_PROVIDERS.find((p) => p.id === id) ?? null
}

export async function chatComplete(
  provider: LiveProvider & { fixedParams?: boolean },
  system: string,
  user: string,
): Promise<string> {
  const response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.key}` },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      ...(provider.fixedParams ? {} : { temperature: 0.4 }),
    }),
  })
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} — ${await response.text().then((text) => text.slice(0, 140))}`)
  }
  const data = await response.json() as {
    choices?: { message?: { content?: string } }[]
    usage?: unknown
  }
  // Record what the provider actually billed. Estimating from character count
  // is a fallback, not a substitute — see estimateRunSpend in task-runner.
  recordUsage(data.usage)
  return data.choices?.[0]?.message?.content ?? ''
}

export function liveBrain(provider: LiveProvider & { fixedParams?: boolean }): AgentBrain {
  return {
    plan: async (input, tools) => {
      if (!tools.length) return []
      const contracts = tools.map((tool) => ({
        id: tool.id,
        description: tool.desc,
        inputSchema: tool.inputSchema ?? null,
      }))
      const system =
        'You are the planning node of a LangGraph agent. Return JSON only, without markdown, using this contract: ' +
        '{"steps":[{"tool":"exact advertised id","input":"short human-readable instruction",' +
        '"arguments":{"schemaField":"typed value"}}]}. Use at most 3 steps. Use {"steps":[]} when no tool is needed. ' +
        'Never invent a tool or argument field. For tools with an inputSchema, satisfy every required field and use ' +
        'the declared JSON types. For tools without a schema, omit arguments and put the request in input.\n' +
        `Available tools:\n${JSON.stringify(contracts)}`
      return parsePlannerOutput(await chatComplete(provider, system, input), tools.map((tool) => tool.id))
    },
    respond: async (input, observations, employee) => {
      const system =
        `You are ${employee.name}, ${employee.role}. Follow these instructions from your owner exactly: "${employee.prompt}". ` +
        'Answer in character, concisely, using any tool observations provided.'
      const user = observations.length
        ? `Request: ${input}\n\nTool observations:\n${observations.map((observation) =>
          `- ${observation.tool}: ${observation.output}`).join('\n')}`
        : input
      return chatComplete(provider, system, user)
    },
  }
}

// ── Token accounting ─────────────────────────────────────────────────────────
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** False when no provider in this window reported usage. */
  measured: boolean
}

const ZERO_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, measured: false }
let usageAccumulator: TokenUsage = { ...ZERO_USAGE }

function recordUsage(usage: unknown): void {
  const u = usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined
  if (!u || typeof u !== 'object') return
  const prompt = typeof u.prompt_tokens === 'number' ? u.prompt_tokens : 0
  const completion = typeof u.completion_tokens === 'number' ? u.completion_tokens : 0
  const total = typeof u.total_tokens === 'number' ? u.total_tokens : prompt + completion
  if (!prompt && !completion && !total) return
  usageAccumulator = {
    promptTokens: usageAccumulator.promptTokens + prompt,
    completionTokens: usageAccumulator.completionTokens + completion,
    totalTokens: usageAccumulator.totalTokens + total,
    measured: true,
  }
}

/** Read the tokens billed since the last reset, then start a fresh window. */
export function takeTokenUsage(): TokenUsage {
  const taken = usageAccumulator
  usageAccumulator = { ...ZERO_USAGE }
  return taken
}

export function resetTokenUsage(): void {
  usageAccumulator = { ...ZERO_USAGE }
}
