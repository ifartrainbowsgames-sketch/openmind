import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { ALL_TOOLS } from './connections'
import { resolveConnectionTools, type LiveConnectionConfig } from './live-connections'
import { MAX_STEPS } from './plan'
import type { AgentBrain, Employee, PlanStep, RunResult, ToolCall, ToolSpec, TraceLine } from './types'

const AgentState = Annotation.Root({
  input: Annotation<string>(),
  plan: Annotation<PlanStep[]>({ reducer: (_a, b) => b, default: () => [] }),
  step: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  observations: Annotation<ToolCall[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  answer: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  trace: Annotation<TraceLine[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
})

type AgentGraphState = typeof AgentState.State

export function buildEmployeeGraph(
  brain: AgentBrain,
  employee: Employee,
  configs?: LiveConnectionConfig[] | Record<string, LiveConnectionConfig>,
) {
  const toolMap: Record<string, ToolSpec> = {}
  for (const id of employee.tools) if (ALL_TOOLS[id]) toolMap[id] = ALL_TOOLS[id]
  for (const tool of resolveConnectionTools(employee, configs)) toolMap[tool.id] = tool
  const tools = Object.values(toolMap)

  const planNode = async (state: AgentGraphState): Promise<Partial<AgentGraphState>> => {
    const plan = (await brain.plan(state.input, tools)).slice(0, MAX_STEPS)
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
    const output = tool ? await tool.run(spec.input, spec.args) : `error: unknown tool "${spec.tool}"`
    return {
      step: state.step + 1,
      observations: [{ tool: spec.tool, input: spec.input, args: spec.args, output }],
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

  return new StateGraph(AgentState)
    .addNode('planner', planNode)
    .addNode('actor', actNode)
    .addNode('responder', respondNode)
    .addEdge(START, 'planner')
    .addConditionalEdges('planner', (state) => state.plan.length ? 'actor' : 'responder', {
      actor: 'actor',
      responder: 'responder',
    })
    .addConditionalEdges('actor', (state) => state.step < state.plan.length ? 'actor' : 'responder', {
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
): Promise<RunResult> {
  const app = buildEmployeeGraph(brain, employee, configs)
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
