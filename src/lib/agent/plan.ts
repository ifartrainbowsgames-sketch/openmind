import type { PlanStep } from './types'

export const MAX_STEPS = 4

/**
 * How many steps a plan may be *parsed* into, before the per-employee ceiling
 * trims it. Parsing and executing are separate limits: a model that returns
 * eight sensible steps should not have five silently dropped at parse time,
 * where the loss is invisible.
 */
export const PLAN_PARSE_CEILING = 12

/** Parse planner lines while preserving the canonical casing of advertised tool ids. */
export function parsePlan(
  text: string,
  allowedTools: string[],
  cap = PLAN_PARSE_CEILING,
): PlanStep[] {
  const canonical = new Map(allowedTools.map((tool) => [tool.toLowerCase(), tool]))
  const steps: PlanStep[] = []
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(?:[-*•]\s*)?TOOL:\s*([a-z0-9_./:-]+)\s*\|\s*(.+)$/i)
    if (!match) continue
    const tool = canonical.get(match[1].toLowerCase())
    if (!tool) continue
    steps.push({ tool, input: match[2].trim() })
    // Parse up to the wider ceiling. Trimming to the executable limit happens
    // in the graph, where the employee's own maxSteps applies and the drop is
    // visible in the trace rather than silent here.
    if (steps.length >= cap) break
  }
  return steps
}

interface JsonSchemaProperty {
  type?: string
  items?: JsonSchemaProperty
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
}

interface JsonSchema {
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
}

function plannerJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = (fenced ?? text).trim()
  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(candidate.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

/** Parse the JSON planning contract, dropping unknown tools and unsafe arguments. */
export function parseStructuredPlan(
  text: string,
  allowedTools: string[],
  cap = PLAN_PARSE_CEILING,
): PlanStep[] {
  const parsed = plannerJson(text)
  const rawSteps = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { steps?: unknown }).steps)
      ? (parsed as { steps: unknown[] }).steps
      : []
  const canonical = new Map(allowedTools.map((tool) => [tool.toLowerCase(), tool]))
  const steps: PlanStep[] = []

  for (const value of rawSteps) {
    if (!value || typeof value !== 'object') continue
    const raw = value as Record<string, unknown>
    if (typeof raw.tool !== 'string') continue
    const tool = canonical.get(raw.tool.toLowerCase())
    if (!tool) continue
    const input = typeof raw.input === 'string' ? raw.input.trim() : ''
    const candidateArgs = raw.arguments ?? raw.args
    const args = safeRecord(candidateArgs)
    if (!input && !args) continue
    steps.push({
      tool,
      input: input || JSON.stringify(args),
      ...(args ? { args } : {}),
    })
    if (steps.length >= cap) break
  }
  return steps
}

/** Prefer structured JSON, retaining the legacy line parser for provider compatibility. */
export function parsePlannerOutput(
  text: string,
  allowedTools: string[],
  cap = PLAN_PARSE_CEILING,
): PlanStep[] {
  const structured = parseStructuredPlan(text, allowedTools, cap)
  return structured.length ? structured : parsePlan(text, allowedTools, cap)
}

function safeRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue
    output[key] = entry
  }
  return Object.keys(output).length ? output : undefined
}

function matchesType(value: unknown, schema: JsonSchemaProperty): boolean {
  if (!schema.type) return true
  if (schema.type === 'string') return typeof value === 'string'
  if (schema.type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (schema.type === 'integer') return typeof value === 'number' && Number.isInteger(value)
  if (schema.type === 'boolean') return typeof value === 'boolean'
  if (schema.type === 'null') return value === null
  if (schema.type === 'array') {
    return Array.isArray(value) && (!schema.items || value.every((entry) => matchesType(entry, schema.items!)))
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    if (!schema.properties) return true
    const record = value as Record<string, unknown>
    return Object.entries(record).every(([key, entry]) =>
      schema.properties?.[key] ? matchesType(entry, schema.properties[key]) : true)
  }
  return true
}

/**
 * Validate planner-supplied arguments against an MCP input schema. Unknown and
 * mistyped fields are removed; missing required fields fail before networking.
 */
export function argumentsForSchema(
  schema: unknown,
  candidate: Record<string, unknown> | undefined,
  input: string,
): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return candidate ?? (input ? { query: input } : {})
  const parsed = schema as JsonSchema
  if (!parsed.properties || typeof parsed.properties !== 'object') return candidate ?? {}

  const properties = parsed.properties
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(candidate ?? {})) {
    const property = properties[key]
    if (property && matchesType(value, property)) output[key] = value
  }

  const stringProps = Object.entries(properties)
    .filter(([, value]) => value?.type === 'string')
    .map(([key]) => key)
  const missingRequiredString = (parsed.required ?? []).find((key) =>
    stringProps.includes(key) && output[key] === undefined)
  const common = ['query', 'q', 'search', 'text', 'input', 'prompt', 'message']
    .find((key) => stringProps.includes(key) && output[key] === undefined)
  const target = missingRequiredString ?? common ?? (candidate ? undefined : stringProps[0])
  if (target && input) output[target] = input

  const missing = (parsed.required ?? []).filter((key) => output[key] === undefined)
  if (missing.length) throw new Error(`planner omitted required tool arguments: ${missing.join(', ')}`)
  return output
}

/** Backward-compatible free-text mapping for callers without structured plans. */
export function argsFromSchema(schema: unknown, input: string): Record<string, unknown> {
  return argumentsForSchema(schema, undefined, input)
}

/**
 * Whether this schema's required arguments can be satisfied from free text.
 *
 * `argumentsForSchema` throws when they cannot, which is right at call time and
 * wrong while scoring candidates — picking a tool should not depend on an
 * exception. Used by pickTool to prefer a tool it can actually invoke.
 */
export function canFillRequired(schema: unknown, input: string): boolean {
  try {
    argsFromSchema(schema, input)
    return true
  } catch {
    return false
  }
}
