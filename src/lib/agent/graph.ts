import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { ALL_TOOLS } from './connections'
import { resolveConnectionTools, type LiveConnectionConfig } from './live-connections'
import { MAX_STEPS } from './plan'
import { MAX_REPLANS, evaluateObservations, replanPrompt } from './verdict'
import { normalizeToolResult } from './types'
import { emit, type ExecutionContext } from '../workforce/execution-context'
import type { AgentBrain, Employee, PlanStep, RunResult, ToolCall, ToolSpec, TraceLine } from './types'

const AgentState = Annotation.Root({
  input: Annotation<string>(),
  plan: Annotation<PlanStep[]>({ reducer: (_a, b) => b, default: () => [] }),
  step: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  observations: Annotation<ToolCall[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  answer: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  replans: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  trace: Annotation<TraceLine[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
})

type AgentGraphState = typeof AgentState.State

export function buildEmployeeGraph(
  brain: AgentBrain,
  employee: Employee,
  configs?: LiveConnectionConfig[] | Record<string, LiveConnectionConfig>,
  /**
   * Where this employee's tools execute. Undefined on the chat surfaces, which
   * have no session and fall back to the module-level workspace binding.
   */
  context?: ExecutionContext,
) {
  const toolMap: Record<string, ToolSpec> = {}
  for (const id of employee.tools) if (ALL_TOOLS[id]) toolMap[id] = ALL_TOOLS[id]
  for (const tool of resolveConnectionTools(employee, configs)) toolMap[tool.id] = tool
  const tools = Object.values(toolMap)

  const planNode = async (state: AgentGraphState): Promise<Partial<AgentGraphState>> => {
    const plan = (await brain.plan(state.input, tools)).slice(0, employee.maxSteps ?? MAX_STEPS)
    return {
      plan,
      trace: [{
        node: 'plan',
        text: plan.length
          ? `${plan.length} step${plan.length > 1 ? 's' : ''} queued — ${plan.map((step) => step.tool).join(' → ')}`
          : 'no tools needed — answering directly',
      }],
    }
  }

  const actNode = async (state: AgentGraphState): Promise<Partial<AgentGraphState>> => {
    const spec = state.plan[state.step]
    const tool = toolMap[spec.tool] ?? ALL_TOOLS[spec.tool]

    // Tool events are emitted here, as the call happens, rather than replayed
    // from the finished result. A workspace tool can run for a minute; an event
    // stream that only reports it afterwards cannot show a task is moving.
    emit(context, 'tool_started', spec.tool, { tool: spec.tool })

    const raw = tool
      ? await tool.run(spec.input, spec.args, context)
      : `error: unknown tool "${spec.tool}"`
    const result = normalizeToolResult(raw)
    const output = result.content

    emit(
      context,
      result.error ? 'blocked' : 'tool_completed',
      result.error?.message ?? output.slice(0, 200),
      { tool: spec.tool },
    )
    return {
      step: state.step + 1,
      observations: [{
        tool: spec.tool,
        input: spec.input,
        args: spec.args,
        output,
        // Carried through so the evaluator can tell a blocked capability from a
        // failure, and so structured payloads survive the graph.
        data: result.data,
        artifacts: result.artifacts,
        error: result.error,
        source: result.source,
      }],
      trace: [{
        node: 'act',
        text: `${spec.tool}("${spec.input.length > 60 ? `${spec.input.slice(0, 57)}…` : spec.input}") → ${
          output.length > 110 ? `${output.slice(0, 107)}…` : output
        }`,
      }],
    }
  }

  const respondNode = async (state: AgentGraphState): Promise<Partial<AgentGraphState>> => {
    const answer = await brain.respond(state.input, state.observations, employee)
    return {
      answer,
      trace: [{
        node: 'respond',
        text: state.observations.length
          ? `answer composed from ${state.observations.length} observation${state.observations.length > 1 ? 's' : ''}`
          : 'answer composed from the employee prompt',
      }],
    }
  }

  const evaluateNode = async (state: AgentGraphState): Promise<Partial<AgentGraphState>> => {
    const evaluation = evaluateObservations(state.observations)
    // Silent on the happy path — a trace line every run would be noise, and the
    // interesting case is precisely when the evidence was not good enough.
    if (evaluation.verdict === 'sufficient') return {}
    return { trace: [{ node: 'act', text: `evaluate — ${evaluation.verdict}: ${evaluation.reason}` }] }
  }

  const replanNode = async (state: AgentGraphState): Promise<Partial<AgentGraphState>> => {
    const { reason } = evaluateObservations(state.observations)
    const steps = brain.replan
      ? await brain.replan(state.input, state.observations, tools)
      : await brain.plan(replanPrompt(state.input, state.observations, reason), tools)
    const plan = steps.slice(0, employee.maxSteps ?? MAX_STEPS)
    return {
      plan,
      step: 0,
      replans: state.replans + 1,
      trace: [{
        node: 'plan',
        text: plan.length
          ? `replan ${state.replans + 1} — ${plan.map((p) => p.tool).join(' → ')}`
          : 'replan produced no new steps — answering with what we have',
      }],
    }
  }

  // ACT → EVALUATE → (REPLAN | RESPOND). A blocked capability short-circuits to
  // the responder: replanning cannot conjure a connection that is not there.
  const routeAfterEvaluate = (state: AgentGraphState): 'replanner' | 'responder' => {
    const { verdict } = evaluateObservations(state.observations)
    if (verdict === 'retry' && state.replans < MAX_REPLANS) return 'replanner'
    return 'responder'
  }

  return new StateGraph(AgentState)
    .addNode('planner', planNode)
    .addNode('actor', actNode)
    .addNode('evaluator', evaluateNode)
    .addNode('replanner', replanNode)
    .addNode('responder', respondNode)
    .addEdge(START, 'planner')
    .addConditionalEdges('planner', (state) => state.plan.length ? 'actor' : 'responder', {
      actor: 'actor',
      responder: 'responder',
    })
    // The actor no longer runs straight to the responder. Exhausting the plan
    // means the evidence is in, not that it is any good.
    .addConditionalEdges('actor', (state) => state.step < state.plan.length ? 'actor' : 'evaluator', {
      actor: 'actor',
      evaluator: 'evaluator',
    })
    .addConditionalEdges('evaluator', routeAfterEvaluate, {
      replanner: 'replanner',
      responder: 'responder',
    })
    .addConditionalEdges('replanner', (state) => state.plan.length ? 'actor' : 'responder', {
      actor: 'actor',
      responder: 'responder',
    })
    .addEdge('responder', END)
    .compile()
}

export async function runEmployee(
  brain: AgentBrain,
  employee: Employee,
  input: string,
  onTrace?: (line: TraceLine) => void,
  configs?: LiveConnectionConfig[] | Record<string, LiveConnectionConfig>,
  context?: ExecutionContext,
): Promise<RunResult> {
  const app = buildEmployeeGraph(brain, employee, configs, context)
  const stream = await app.stream({ input }, { streamMode: 'updates' })
  const trace: TraceLine[] = []
  const toolCalls: ToolCall[] = []
  let plan: PlanStep[] = []
  let answer = ''
  for await (const chunk of stream) {
    for (const update of Object.values(chunk) as Partial<AgentGraphState>[]) {
      if (update.trace) for (const line of update.trace) {
        trace.push(line)
        onTrace?.(line)
      }
      if (update.observations) toolCalls.push(...update.observations)
      if (update.plan) plan = update.plan
      if (update.answer) answer = update.answer
    }
  }
  return { answer, plan, toolCalls, trace }
}
