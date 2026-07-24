import type { PlanStep } from './types'

export const MAX_STEPS = 4

/** Parse planner lines while preserving the canonical casing of advertised tool ids. */
export function parsePlan(text: string, allowedTools: string[]): PlanStep[] {
  const canonical = new Map(allowedTools.map((tool) => [tool.toLowerCase(), tool]))
  const steps: PlanStep[] = []
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(?:[-*•]\s*)?TOOL:\s*([a-z0-9_./:-]+)\s*\|\s*(.+)$/i)
    if (!match) continue
    const tool = canonical.get(match[1].toLowerCase())
    if (!tool) continue
    steps.push({ tool, input: match[2].trim() })
    if (steps.length >= MAX_STEPS) break
  }
  return steps
}

interface JsonSchemaProperty {
  type?: string
}

interface JsonSchema {
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
}

/** Map free text onto the most likely string field in an MCP input schema. */
export function argsFromSchema(schema: unknown, input: string): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return input ? { query: input } : {}
  const parsed = schema as JsonSchema
  if (!parsed.properties || typeof parsed.properties !== 'object') return {}

  const stringProps = Object.entries(parsed.properties)
    .filter(([, value]) => value?.type === 'string')
    .map(([key]) => key)
  const required = (parsed.required ?? []).find((key) => stringProps.includes(key))
  const common = ['query', 'q', 'search', 'text', 'input', 'prompt', 'message']
    .find((key) => stringProps.includes(key))
  const target = required ?? common ?? stringProps[0]
  return target && input ? { [target]: input } : {}
}
