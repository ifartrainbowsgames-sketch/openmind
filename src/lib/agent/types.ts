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
}

export interface PlanStep {
  tool: string
  input: string
  /** Structured arguments produced by the planner for schema-aware tools. */
  args?: Record<string, unknown>
}

export interface ToolCall {
  tool: string
  input: string
  args?: Record<string, unknown>
  output: string
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
  run: (input: string, args?: Record<string, unknown>) => string | Promise<string>
}

export interface AgentTool extends ToolSpec {
  run: (input: string) => string
}

export interface AgentBrain {
  plan: (input: string, tools: ToolSpec[]) => Promise<PlanStep[]>
  respond: (input: string, observations: ToolCall[], employee: Employee) => Promise<string>
}
