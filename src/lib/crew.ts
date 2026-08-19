// Supervisor crew — staff → dispatch specialists in parallel → synthesize.
import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import {
  liveBrain,
  runEmployee,
  simulatedBrain,
  type AgentBrain,
  type Employee,
  type LiveConnectionConfig,
  type RunResult,
  type TraceLine,
} from './agent'
import { generateStaff, MAX_HIRES } from './staffing'
import { setActiveCrewToolKeys, setActiveWorkspace, type CrewToolKeys } from './crew-tools'
import type { WorkspaceSpace } from './workspace'

export interface CrewArtifact {
  id: string
  kind: 'markdown' | 'html'
  title: string
  body: string
}

export interface CrewMemberResult {
  employeeId: string
  name: string
  role: string
  result: RunResult
}

export interface CrewRun {
  answer: string
  members: CrewMemberResult[]
  artifacts: CrewArtifact[]
  trace: TraceLine[]
  employeeIds: string[]
}

export interface RunCrewOptions {
  onTrace?: (line: TraceLine) => void
  configs?: LiveConnectionConfig[] | Record<string, LiveConnectionConfig>
  toolKeys?: CrewToolKeys
  workspace?: WorkspaceSpace
  /** When empty, the staff node hires from the task via generateStaff. */
  employees?: Employee[]
}

const RESEARCH_RE = /research|search|analyst|knowledge|librarian|web|brief|trend/i
const CODE_RE = /code|engineer|develop|copilot|program|software/i
const WRITE_RE = /writ|content|copy|present|slide|deck|editor|author/i

export function toolsForRole(employee: Employee): string[] {
  const hay = `${employee.role} ${employee.prompt}`
  const extra: string[] = []
  if (RESEARCH_RE.test(hay)) extra.push('web_search', 'browse_url', 'search_docs', 'summarize')
  if (CODE_RE.test(hay)) extra.push('run_code', 'code_review', 'calculator', 'github_write_file', 'github_create_branch', 'github_open_pr')
  if (WRITE_RE.test(hay)) extra.push('summarize', 'web_search')
  extra.push('web_search')
  return [...new Set([...employee.tools, ...extra])]
}

export function withCrewTools(employee: Employee): Employee {
  return { ...employee, tools: toolsForRole(employee) }
}

export function withGithubWorkspaceTools(employee: Employee, space?: WorkspaceSpace): Employee {
  if (space?.kind !== 'github') return employee
  return {
    ...employee,
    tools: [...new Set([...employee.tools, 'github_write_file', 'github_create_branch', 'github_open_pr'])],
  }
}

export function assembleCrew(lead: Employee | undefined, task: string): Employee[] {
  const hired = generateStaff(task).map(withCrewTools)
  if (!lead) return hired.slice(0, MAX_HIRES)
  const leadReady = withCrewTools(lead)
  if (hired.length === 1 && hired[0].role === 'Generalist') return [leadReady]
  const seen = new Set<string>([leadReady.id])
  const out = [leadReady]
  for (const e of hired) {
    if (seen.has(e.id) || e.role === leadReady.role) continue
    seen.add(e.id)
    out.push(e)
    if (out.length >= MAX_HIRES) break
  }
  return out
}

export function extractArtifacts(task: string, answer: string, members: CrewMemberResult[]): CrewArtifact[] {
  const artifacts: CrewArtifact[] = []
  const fence = /```(markdown|md|html)\n([\s\S]*?)```/gi
  let m: RegExpExecArray | null
  let i = 0
  while ((m = fence.exec(answer))) {
    const lang = m[1].toLowerCase()
    artifacts.push({
      id: `artifact-${++i}`,
      kind: lang === 'html' ? 'html' : 'markdown',
      title: lang === 'html' ? 'HTML deck' : 'Markdown note',
      body: m[2].trim(),
    })
  }

  const brief = [
    `# ${task.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Crew brief'}`,
    '',
    answer.trim(),
    '',
    '## Specialists',
    ...members.map((mem) => `- **${mem.name}** (${mem.role}): ${mem.result.answer.replace(/\s+/g, ' ').slice(0, 220)}`),
  ].join('\n')

  artifacts.unshift({
    id: 'artifact-brief',
    kind: 'markdown',
    title: 'Crew brief',
    body: brief,
  })

  if (/\b(slide|deck|presentation)\b/i.test(task)) {
    const slides = answer
      .split(/\n(?=#{1,3}\s)/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8)
    const sections = (slides.length ? slides : [answer]).map(
      (s) => `<section><pre>${escapeHtml(s.slice(0, 1200))}</pre></section>`,
    )
    artifacts.push({
      id: 'artifact-deck',
      kind: 'html',
      title: 'Slide deck',
      body: `<!doctype html><html><body>${sections.join('')}</body></html>`,
    })
  }

  return artifacts
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const CrewState = Annotation.Root({
  task: Annotation<string>(),
  employees: Annotation<Employee[]>({ reducer: (_a, b) => b, default: () => [] }),
  members: Annotation<CrewMemberResult[]>({ reducer: (_a, b) => b, default: () => [] }),
  answer: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  artifacts: Annotation<CrewArtifact[]>({ reducer: (_a, b) => b, default: () => [] }),
  trace: Annotation<TraceLine[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
})

type CS = typeof CrewState.State

export async function runCrew(
  task: string,
  brain: AgentBrain,
  options: RunCrewOptions = {},
): Promise<CrewRun> {
  setActiveCrewToolKeys(options.toolKeys ?? {})
  setActiveWorkspace(options.workspace)
  const supervisor: Employee = {
    id: 'supervisor',
    name: 'Supervisor',
    role: 'Crew lead',
    prompt: 'Synthesize specialist findings into one clear answer. Prefer evidence over speculation.',
    tools: [],
    accent: '#17140f',
  }

  const staffNode = async (state: CS): Promise<Partial<CS>> => {
    const employees = (state.employees.length ? state.employees : generateStaff(state.task))
      .map(withCrewTools)
      .map((employee) => withGithubWorkspaceTools(employee, options.workspace))
      .slice(0, MAX_HIRES)
    return {
      employees,
      trace: [{
        node: 'plan',
        text: `crew of ${employees.length} — ${employees.map((e) => e.role).join(' → ')}`,
      }],
    }
  }

  const dispatchNode = async (state: CS): Promise<Partial<CS>> => {
    const members = await Promise.all(
      state.employees.map(async (employee) => {
        const result = await runEmployee(
          brain,
          employee,
          state.task,
          (line) => options.onTrace?.({ ...line, text: `${employee.name}: ${line.text}` }),
          options.configs,
        )
        return { employeeId: employee.id, name: employee.name, role: employee.role, result }
      }),
    )
    return {
      members,
      trace: members.map((mem) => ({
        node: 'act' as const,
        text: `${mem.name} (${mem.role}) — ${mem.result.toolCalls.length} tool call${mem.result.toolCalls.length === 1 ? '' : 's'}`,
      })),
    }
  }

  const synthesizeNode = async (state: CS): Promise<Partial<CS>> => {
    const observations = state.members.flatMap((mem) =>
      mem.result.toolCalls.map((c) => ({ ...c, tool: `${mem.name}:${c.tool}` })),
    )
    const dossier = state.members
      .map((mem) => `### ${mem.name} — ${mem.role}\n${mem.result.answer}`)
      .join('\n\n')
    const answer = await brain.respond(
      `${state.task}\n\nSpecialist reports:\n${dossier}`,
      observations,
      supervisor,
    )
    const artifacts = extractArtifacts(state.task, answer, state.members)
    return {
      answer,
      artifacts,
      trace: [{
        node: 'respond',
        text: `synthesized from ${state.members.length} specialist${state.members.length === 1 ? '' : 's'} · ${artifacts.length} artifact${artifacts.length === 1 ? '' : 's'}`,
      }],
    }
  }

  const app = new StateGraph(CrewState)
    .addNode('staff', staffNode)
    .addNode('dispatch', dispatchNode)
    .addNode('synthesize', synthesizeNode)
    .addEdge(START, 'staff')
    .addEdge('staff', 'dispatch')
    .addEdge('dispatch', 'synthesize')
    .addEdge('synthesize', END)
    .compile()

  const seed: Partial<CS> = {
    task,
    employees: (options.employees ?? []).map(withCrewTools).map((employee) => withGithubWorkspaceTools(employee, options.workspace)).slice(0, MAX_HIRES),
  }

  try {
    const stream = await app.stream(seed, { streamMode: 'updates' })
    const trace: TraceLine[] = []
    let members: CrewMemberResult[] = []
    let employees: Employee[] = options.employees ?? []
    let answer = ''
    let artifacts: CrewArtifact[] = []
    for await (const chunk of stream) {
      for (const update of Object.values(chunk) as Partial<CS>[]) {
        if (update.trace) {
          for (const line of update.trace) {
            trace.push(line)
            options.onTrace?.(line)
          }
        }
        if (update.employees) employees = update.employees
        if (update.members) members = update.members
        if (update.answer) answer = update.answer
        if (update.artifacts) artifacts = update.artifacts
      }
    }
    return {
      answer,
      members,
      artifacts,
      trace,
      employeeIds: employees.map((e) => e.id),
    }
  } finally {
    setActiveCrewToolKeys({})
    setActiveWorkspace(undefined)
  }
}

/** Resolve a brain the same way the UIs do — live when keyed, else simulated. */
export function crewBrain(live?: { baseUrl: string; model: string; key: string; fixedParams?: boolean }): AgentBrain {
  return live?.key ? liveBrain(live) : simulatedBrain()
}
