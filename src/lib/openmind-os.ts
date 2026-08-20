// /app = one chat assistant (Claude/ChatGPT-shaped). Substantive goals use artifact-first task graph.
import { runCrew, withCrewTools, withGithubWorkspaceTools, type CrewRun, type RunCrewOptions } from './crew'
import { runEmployee, type AgentBrain, type Employee } from './agent'
import { setActiveCrewToolKeys, setPlatformKeysAllowed } from './crew-tools'
import { setMemoryOwner } from './memory'
import { setNangoOwner } from './nango'
import { toolsForSkill, wrapSkillPrompt, type SkillId } from './skills'
import { isSimpleChat } from './task-ledger'
import { needsTaskGraph } from './task-planner'
import { runTaskGraph, type RunTaskGraphOptions } from './task-runner'
import { setProjectOwner } from './project-store'
import { stripWorkspacePrompt } from './workspace'

export type OsAppId = 'research' | 'developer' | 'browser' | 'office' | 'memory' | 'connect'

export interface OsApp {
  id: OsAppId
  name: string
  status: 'live' | 'partial' | 'later'
  kernel: string
}

export const OS_APPS: readonly OsApp[] = [
  { id: 'research', name: 'Research', status: 'live', kernel: 'task graph → research/*.json artifacts' },
  { id: 'developer', name: 'Developer', status: 'partial', kernel: 'customer GitHub via Nango + E2B run_code' },
  { id: 'browser', name: 'Browser', status: 'partial', kernel: 'web_act hosted Chrome (Browserless); Jina fallback' },
  { id: 'office', name: 'Office', status: 'partial', kernel: 'business_plan + markdown artifacts' },
  { id: 'memory', name: 'Memory', status: 'live', kernel: 'memory_save/search + agent_memories' },
  { id: 'connect', name: 'Connect', status: 'partial', kernel: 'Nango Gmail list/read/send + Slack + Drive' },
]

export interface BootKernelOptions {
  userId?: string
}

export function bootKernel(options: BootKernelOptions = {}): void {
  if (options.userId) {
    setNangoOwner(options.userId)
    setMemoryOwner(options.userId)
    setProjectOwner(options.userId)
  }
}

export type RunTurnOptions = RunCrewOptions & {
  lead?: Employee
  /** Explicit multi-agent crew (WorkforceStudio only). /app never sets this. */
  crew?: boolean
  /** Force artifact-first task graph even for short prompts. */
  taskGraph?: boolean
} & Pick<RunTaskGraphOptions, 'planner' | 'persist' | 'budget' | 'platformKeys'>

/** One chat turn — single assistant for small talk; task graph for real work. */
export async function runTurn(
  task: string,
  brain: AgentBrain,
  options: RunTurnOptions = {},
): Promise<CrewRun> {
  if (options.crew || (options.employees?.length ?? 0) > 1) {
    return runCrew(task, brain, options)
  }

  const userGoal = stripWorkspacePrompt(task)
  if (options.taskGraph || (!isSimpleChat(userGoal) && needsTaskGraph(userGoal))) {
    return runTaskGraph(task, brain, options)
  }

  const lead = options.lead
  if (!lead) throw new Error('runTurn needs a lead assistant')

  setActiveCrewToolKeys(options.toolKeys ?? {})
  setPlatformKeysAllowed(options.platformKeys === true)
  try {
    const skill: SkillId = options.skill ?? 'multitask'
    let prompt = skill === 'multitask' ? task : wrapSkillPrompt(skill, task)
    let employee = withGithubWorkspaceTools(withCrewTools(lead), options.workspace)
    employee = { ...employee, tools: toolsForSkill(employee.tools, skill) }

    const result = await runEmployee(
      brain,
      employee,
      prompt,
      options.onTrace,
      options.configs,
    )

    return {
      answer: result.answer,
      members: [{
        employeeId: employee.id,
        name: employee.name,
        role: employee.role,
        result,
      }],
      artifacts: [],
      trace: result.trace,
      employeeIds: [employee.id],
    }
  } finally {
    setActiveCrewToolKeys({})
    setPlatformKeysAllowed(false)
  }
}
