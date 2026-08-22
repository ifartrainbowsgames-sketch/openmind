/**
 * OpenMind provider id → models.dev provider id.
 *
 * A map rather than an assumption that the ids match, because most of them do
 * not: Kimi is `moonshotai` upstream, Together is `togetherai`, and Ollama's
 * hosted catalogue is `ollama-cloud`. Guessing by substring silently matched
 * the wrong provider during research.
 *
 * The sync script FAILS if an entry here has no upstream match, so a rename on
 * models.dev is a loud error at sync time rather than a provider that quietly
 * loses its model list.
 */
export const CATALOG_PROVIDERS: Readonly<Record<string, string>> = {
  kimi: 'moonshotai',
  'kimi-cn': 'moonshotai-cn',
  openai: 'openai',
  anthropic: 'anthropic',
  openrouter: 'openrouter',
  groq: 'groq',
  xai: 'xai',
  google: 'google',
  deepseek: 'deepseek',
  mistral: 'mistral',
  together: 'togetherai',
  perplexity: 'perplexity',
  cohere: 'cohere',
  cerebras: 'cerebras',
  ollama: 'ollama-cloud',
}
