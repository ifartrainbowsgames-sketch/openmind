import { toolName } from './connections'
import { parsePlannerOutput } from './plan'
import type { AgentBrain, PlanStep } from './types'

const ARITHMETIC = /[-\d(][\d\s+\-*/().%]*\d\)*/
const CONNECTION_ROUTES: { pattern: RegExp; ids: string[]; unless?: RegExp }[] = [
  { pattern: /\bgmail\b/i, ids: ['gmail'] },
  { pattern: /\boutlook\b/i, ids: ['outlook'] },
  { pattern: /\b(e-?mails?|inbox|mail)\b/i, ids: ['gmail', 'outlook'], unless: /\b(gmail|outlook)\b/i },
  { pattern: /\b(calendar|meetings?|schedule|agenda|events?)\b/i, ids: ['gcal'] },
  { pattern: /\b(slack|channels?|mentions?)\b/i, ids: ['slack'] },
  { pattern: /\b(github|pull requests?|prs?|commits?|merge)\b/i, ids: ['github'] },
  { pattern: /\blinear\b/i, ids: ['linear'] },
  { pattern: /\bjira\b/i, ids: ['jira'] },
  { pattern: /\b(tickets?|queue)\b/i, ids: ['zendesk', 'jira'], unless: /\bjira\b/i },
  { pattern: /\b(deals?|crm|leads?|pipeline|contacts?)\b/i, ids: ['hubspot'] },
  { pattern: /\b(notion|wiki|pages?)\b/i, ids: ['notion'] },
  { pattern: /\b(drive|files?|folders?|spreadsheets?|docs?)\b/i, ids: ['gdrive', 'notion'], unless: /\bnotion\b/i },
]

export function simulatedBrain(): AgentBrain {
  return {
    plan: async (input, tools) => {
      const has = (id: string) => tools.some((tool) => tool.id === id)
      const steps: PlanStep[] = []
      const push = (tool: string, toolInput: string) => {
        if (!steps.some((step) => step.tool === tool)) steps.push({ tool, input: toolInput })
      }
      const math = input.match(ARITHMETIC)
      if (math && /[+\-*/%]/.test(math[0]) && has('calculator')) push('calculator', math[0].trim())
      if (/\b(code|bug|refactor|function|script|typescript|javascript|python|review this)\b/i.test(input) && has('code_review')) {
        push('code_review', input)
      }
      for (const { pattern, ids, unless } of CONNECTION_ROUTES) {
        if (steps.length >= 3) break
        const hit = ids.find(has)
        if (hit && pattern.test(input) && !unless?.test(input)) push(hit, input)
      }
      if (/summar|tl;dr|shorten|condense|key points/i.test(input) && has('summarize')) push('summarize', input)
      if (/sentiment|feeling|feels|opinion|feedback|happy|angry|upset|satisfied/i.test(input) && has('sentiment')) {
        push('sentiment', input)
      }
      if (steps.length === 0 && has('search_docs') &&
          /\?|openmind|widget|price|pricing|cost|key|embed|install|provider|refund|pro plan|capabilit/i.test(input)) {
        push('search_docs', input)
      }
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
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'moonshotai/kimi-k2.5', keyUrl: 'openrouter.ai/keys' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant', keyUrl: 'console.groq.com/keys' },
  { id: 'ollama', name: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', keyRequired: false, keyUrl: 'no key needed — local' },
]

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
  const data = await response.json() as { choices?: { message?: { content?: string } }[] }
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
