export interface Capability {
  id: string
  index: string
  name: string
  tagline: string
  description: string
  providers: string[]
  api: boolean
  embed: boolean
  icon: string
  demoNote: string
  features: string[]
}

export const capabilities: Capability[] = [
  {
    id: 'chat',
    index: '01',
    name: 'Chatbot',
    tagline: 'Support & sales agent',
    description: 'Streaming chat prototype designed for provider-backed answers and future indexed sources.',
    providers: ['OpenAI', 'Anthropic', 'Mistral', 'Ollama'],
    api: true,
    embed: true,
    icon: 'MessageSquare',
    demoNote: 'Tries the secure gateway first and clearly labels the local fallback',
    features: ['Streaming replies', 'Custom knowledge', '32 languages'],
  },
]

export const providers = [
  { name: 'OpenAI', type: 'Cloud' },
  { name: 'Anthropic', type: 'Cloud' },
  { name: 'Google Gemini', type: 'Cloud' },
  { name: 'Mistral', type: 'Cloud' },
  { name: 'Groq', type: 'Cloud' },
  { name: 'Together', type: 'Cloud' },
  { name: 'Azure OpenAI', type: 'Cloud' },
  { name: 'Cohere', type: 'Cloud' },
  { name: 'OpenRouter', type: 'Router' },
  { name: 'Ollama', type: 'Local' },
  { name: 'vLLM', type: 'Self-host' },
  { name: 'LiteLLM', type: 'Router' },
]
