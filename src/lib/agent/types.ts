import type { ExecutionContext } from '../workforce/execution-context'

export interface Employee {
  id: string
  name: string
  role: string
  /** The owner's own prompt — becomes the system prompt. */
  prompt: string
  /** Tool ids from TOOL_REGISTRY. */
  tools: string[]
  /** Connection ids from CONNECTIONS (Gmail, Calendar…). */
  connections?: string[]
  accent: string
  tagline?: string
  preset?: boolean
  /**
   * Steps this employee may plan. Defaults to MAX_STEPS; workers with a
   * sandbox need more, because clone/install/edit/test/fix is a sequence.
   */
  maxSteps?: number
}

export interface PlanStep {
  tool: string
  input: string
  /** Structured arguments produced by the planner for schema-aware tools. */
  args?: Record<string, unknown>
}

/** Why a tool call produced nothing usable. */
export interface ToolError {
  kind: 'blocked' | 'error' | 'declined'
  message: string
}

/** A file a tool produced directly, rather than describing in prose. */
export interface ToolArtifact {
  path: string
  body: string
}

export interface ToolCall {
  tool: string
  input: string
  args?: Record<string, unknown>
  output: string
  /** Structured payload, when the tool returned one rather than prose. */
  data?: unknown
  artifacts?: ToolArtifact[]
  /**
   * Set when the call did not succeed. The distinction matters downstream:
   * 'blocked' means a capability is missing and the user must act, while
   * 'error' is worth retrying. Collapsing them into an error string is how a
   * missing connection became a plausible-looking answer.
   */
  error?: ToolError
  source?: 'live' | 'mock'
}

/**
 * What a tool returns. `content` is the text a model reads; everything else is
 * for code, which used to be discarded by flattening every result to a string.
 */
export interface ToolResult {
  content: string
  data?: unknown
  arguments?: Record<string, unknown>
  artifacts?: ToolArtifact[]
  error?: ToolError
  source?: 'live' | 'mock'
}

/** Accept either shape from a tool, so existing string-returning tools work. */
export function normalizeToolResult(value: string | ToolResult): ToolResult {
  return typeof value === 'string' ? { content: value } : value
}

export interface TraceLine {
  node: 'plan' | 'act' | 'respond'
  text: string
}

export interface RunResult {
  answer: string
  plan: PlanStep[]
  toolCalls: ToolCall[]
  trace: TraceLine[]
}

/** Anything the graph can call — sync (built-ins, mocks) or async (live MCP/REST). */
export interface ToolSpec {
  id: string
  name: string
  desc: string
  inputSchema?: unknown
  /**
   * Returns prose, or a ToolResult when the tool has more to say than text —
   * whether it was live or mocked, structured data, or why it failed. Callers
   * normalize with `normalizeToolResult`, so a plain string still works.
   */
  run: (
    input: string,
    args?: Record<string, unknown>,
    /**
     * Where this call executes. Present whenever the tool runs inside a task
     * session; absent on the context-free surfaces (chat crew, evaluation
     * harness), which fall back to the module-level workspace binding.
     *
     * A tool that needs a machine must prefer this over module state — that
     * preference is what makes "one session, one workspace" structural rather
     * than a rule the runtime has to remember.
     */
    context?: ExecutionContext,
  ) => string | ToolResult | Promise<string | ToolResult>
}

/**
 * Kept as an alias rather than a narrowing. It used to force `run` to be
 * synchronous, which was true when every tool was local string manipulation
 * and false the moment tools reached a sandbox, a search API or an MCP server.
 */
export type AgentTool = ToolSpec

export interface AgentBrain {
  plan: (input: string, tools: ToolSpec[]) => Promise<PlanStep[]>
  respond: (input: string, observations: ToolCall[], employee: Employee) => Promise<string>
  /**
   * Plan again after a round of tool calls came back useless. Optional — a
   * brain without it gets the default: plan() over a prompt annotated with
   * what already failed.
   */
  replan?: (input: string, observations: ToolCall[], tools: ToolSpec[]) => Promise<PlanStep[]>
}
