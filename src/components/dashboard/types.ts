export interface Source {
  id: string
  name: string
  type: 'file' | 'url' | 'text'
  size: string
  chunks: number
  status: 'indexing' | 'indexed'
  progress: number
  attached: string[] // capability ids
  addedAt: string
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** Which parameters each capability exposes in its settings panel. */
export interface CapSettings {
  models: string[]
  params: ('temperature' | 'systemPrompt' | 'language' | 'voice' | 'length' | 'glossary')[]
  dataHint: string
  widget: boolean
}

export const CAP_SETTINGS: Record<string, CapSettings> = {
  chat: {
    models: ['gpt-4o-mini', 'claude-sonnet-4.5', 'mistral-large', 'llama3.3-70b (local)'],
    params: ['temperature', 'systemPrompt'],
    dataHint: 'Docs, FAQs and pages the chatbot answers from.',
    widget: true,
  },
  image: {
    models: ['flux.1-dev', 'sdxl-1.0', 'dall-e-3'],
    params: [],
    dataHint: 'Brand style references and product photos for visual grounding.',
    widget: true,
  },
  stt: {
    models: ['whisper-large-v3', 'nova-3', 'assembly-universal'],
    params: ['language'],
    dataHint: 'Custom vocabulary lists — product names, jargon, acronyms.',
    widget: false,
  },
  tts: {
    models: ['tts-1-hd', 'eleven-v3', 'xtts-v2 (local)'],
    params: ['voice'],
    dataHint: 'Voice samples (WAV/MP3) to clone your brand voice.',
    widget: true,
  },
  translate: {
    models: ['deepl-v3', 'gpt-4o-mini', 'claude-haiku'],
    params: ['language', 'glossary'],
    dataHint: 'Glossary / termbase files (CSV, TBX) enforcing your terminology.',
    widget: true,
  },
  code: {
    models: ['claude-sonnet-4.5', 'gpt-5-codex', 'deepseek-coder-v2'],
    params: ['temperature'],
    dataHint: 'Repos and style guides so completions match your conventions.',
    widget: false,
  },
  docqa: {
    models: ['claude-sonnet-4.5', 'gpt-4o', 'llama3.3-70b (local)'],
    params: ['temperature', 'systemPrompt'],
    dataHint: 'The knowledge base: PDFs, wikis, sites — cited in every answer.',
    widget: true,
  },
  sentiment: {
    models: ['roberta-large-ft', 'gpt-4o-mini', 'custom-vllm'],
    params: [],
    dataHint: 'Labeled examples (CSV) to fine-tune classes for your domain.',
    widget: false,
  },
  summarize: {
    models: ['gpt-4o-mini', 'claude-haiku', 'flan-t5-xxl (local)'],
    params: ['length'],
    dataHint: 'Example summaries that set house tone and structure.',
    widget: true,
  },
  vision: {
    models: ['gpt-4o', 'claude-sonnet-4.5', 'gemini-2.5-pro'],
    params: [],
    dataHint: 'Product catalog images for recognition and visual Q&A.',
    widget: false,
  },
}
