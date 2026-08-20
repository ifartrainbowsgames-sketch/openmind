export interface WebActStep {
  click?: string
  type?: { selector: string; text: string }
  waitMs?: number
}

export interface WebActSpec {
  url: string
  goal: string
  steps: WebActStep[]
}

const HTTP = /^https?:\/\//i

export function parseWebActInput(input: string): WebActSpec {
  const raw = input.trim()
  if (raw.startsWith('{')) {
    try {
      const rec = JSON.parse(raw) as Record<string, unknown>
      const url = typeof rec.url === 'string' && HTTP.test(rec.url) ? rec.url.trim() : ''
      const goal = typeof rec.goal === 'string' ? rec.goal.trim() : (typeof rec.task === 'string' ? rec.task.trim() : '')
      const steps = Array.isArray(rec.steps) ? rec.steps.slice(0, 8).map(parseStep).filter(Boolean) as WebActStep[] : []
      if (url) return { url, goal: goal.slice(0, 500), steps }
    } catch {
      /* fall through */
    }
  }
  const url = raw.match(/https?:\/\/[^\s]+/i)?.[0] ?? 'https://example.com'
  return { url, goal: raw.replace(url, '').trim().slice(0, 500) || 'Read the page and complete the task', steps: [] }
}

function parseStep(value: unknown): WebActStep | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const rec = value as Record<string, unknown>
  if (typeof rec.click === 'string' && rec.click.trim()) return { click: rec.click.trim().slice(0, 200) }
  if (rec.type && typeof rec.type === 'object' && !Array.isArray(rec.type)) {
    const t = rec.type as Record<string, unknown>
    if (typeof t.selector === 'string' && typeof t.text === 'string') {
      return { type: { selector: t.selector.trim().slice(0, 200), text: t.text.slice(0, 500) } }
    }
  }
  if (typeof rec.selector === 'string' && typeof rec.text === 'string') {
    return { type: { selector: rec.selector.trim().slice(0, 200), text: rec.text.slice(0, 500) } }
  }
  if (typeof rec.waitMs === 'number' && rec.waitMs > 0) return { waitMs: Math.min(rec.waitMs, 8000) }
  return null
}

export function mockWebAct(spec: WebActSpec): string {
  const steps = spec.steps.length
    ? spec.steps.map((s, i) => `${i + 1}. ${s.click ? `click ${s.click}` : s.type ? `type into ${s.type.selector}` : `wait ${s.waitMs}ms`}`).join('\n')
    : '(open page and read)'
  return `[MOCK · web_act] Hosted Chrome is not wired yet.
Goal: ${spec.goal}
URL: ${spec.url}
Steps:
${steps}

Cursor's mini desktop is a cloud VM with Chrome. OpenMind can do the same with a Browserless key (real Chrome) or E2B desktop — set BROWSERLESS_API_KEY on agent-tools, or paste a Browserless token in /app. Without that, this is a plan only.`
}
