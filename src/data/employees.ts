import type { Employee } from '@/lib/agent'

export const ACCENTS = ['#ff4d00', '#17140f', '#0e7490', '#7c3aed', '#15803d']

export const PRESET_EMPLOYEES: Employee[] = [
  {
    id: 'mara',
    name: 'Mara',
    role: 'Support Lead',
    prompt:
      'You are Mara, the support lead. Answer strictly from the knowledge base, be concise and friendly, and always cite what the docs say.',
    tools: ['search_docs', 'summarize'],
    connections: ['zendesk', 'gmail'],
    accent: '#ff4d00',
    tagline: 'Deflects tickets with cited answers',
    preset: true,
  },
  {
    id: 'rex',
    name: 'Rex',
    role: 'Code Copilot',
    prompt:
      'You are Rex, the resident code copilot. Review code for bugs, smells and security risks, suggest precise fixes, and explain the trade-offs.',
    tools: ['code_review', 'calculator'],
    connections: ['github', 'linear'],
    accent: '#15803d',
    tagline: 'Ships reviewed, safe code',
    preset: true,
  },
  {
    id: 'theo',
    name: 'Theo',
    role: 'Data Analyst',
    prompt: 'You are Theo, a precise data analyst. Do the math, show your work, skip the fluff.',
    tools: ['calculator', 'summarize'],
    connections: ['gdrive'],
    accent: '#17140f',
    tagline: 'Crunches numbers on demand',
    preset: true,
  },
  {
    id: 'june',
    name: 'June',
    role: 'VoC Specialist',
    prompt:
      'You are June, a voice-of-customer specialist. Gauge tone and urgency in feedback and flag what needs escalation.',
    tools: ['sentiment', 'summarize'],
    connections: ['zendesk', 'slack'],
    accent: '#0e7490',
    tagline: 'Reads the room at scale',
    preset: true,
  },
  {
    id: 'otto',
    name: 'Otto',
    role: 'Knowledge Librarian',
    prompt:
      'You are Otto, the company librarian. Answer only from the docs and compress long threads into decisions.',
    tools: ['search_docs', 'summarize'],
    connections: ['notion', 'gdrive'],
    accent: '#7c3aed',
    tagline: 'Institutional memory, on tap',
    preset: true,
  },
]

const STORE_KEY = 'openmind-employees-v1'
const CONNECTION_OVERRIDES_KEY = 'openmind-employee-connections-v1'

export function loadCustomEmployees(): Employee[] {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveCustomEmployees(list: Employee[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list))
  } catch {
    /* storage full or unavailable — non-fatal */
  }
}

/** Per-preset attachment edits; custom employees keep connections on Employee. */
export function loadEmployeeConnectionOverrides(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(CONNECTION_OVERRIDES_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([, value]) => Array.isArray(value))
        .map(([id, value]) => [
          id,
          [...new Set((value as unknown[]).filter((item): item is string => typeof item === 'string'))],
        ]),
    )
  } catch {
    return {}
  }
}

export function saveEmployeeConnectionOverrides(overrides: Record<string, string[]>): void {
  try {
    localStorage.setItem(CONNECTION_OVERRIDES_KEY, JSON.stringify(overrides))
  } catch {
    /* storage full or unavailable — non-fatal */
  }
}
