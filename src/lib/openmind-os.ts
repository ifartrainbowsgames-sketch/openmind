// One crew. Shared board. Shared tools. Not siloed "apps that never talk."
import { assembleCrew, runCrew, type CrewRun, type RunCrewOptions } from './crew'
import type { AgentBrain, Employee } from './agent'
import { setMemoryOwner } from './memory'
import { setNangoOwner } from './nango'

export type OsAppId = 'research' | 'developer' | 'browser' | 'office' | 'memory' | 'connect'

export interface OsApp {
  id: OsAppId
  name: string
  status: 'live' | 'partial' | 'later'
  kernel: string
}

/** Shared tools the one crew can use. Not separate products. */
export const OS_APPS: readonly OsApp[] = [
  { id: 'research', name: 'Research', status: 'live', kernel: 'skill: search/browse when the task needs it' },
  { id: 'developer', name: 'Developer', status: 'partial', kernel: 'customer GitHub via Nango + E2B run_code' },
  { id: 'browser', name: 'Browser', status: 'partial', kernel: 'web_act hosted Chrome (Browserless); Jina fallback' },
  { id: 'office', name: 'Office', status: 'partial', kernel: 'business_plan + markdown artifacts' },
  { id: 'memory', name: 'Memory', status: 'live', kernel: 'memory_save/search + agent_memories' },
  { id: 'connect', name: 'Connect', status: 'partial', kernel: 'Nango Gmail list/read/send + Slack + Drive' },
]

export interface BootKernelOptions {
  userId?: string
}

/** Bind this signed-in customer to Connect + memory. Call once per session. */
export function bootKernel(options: BootKernelOptions = {}): void {
  if (options.userId) {
    setNangoOwner(options.userId)
    setMemoryOwner(options.userId)
  }
}

export type RunTurnOptions = RunCrewOptions & {
  lead?: Employee
}

/** One Super Agent turn. UI should call this instead of assembling a crew by hand. */
export async function runTurn(
  task: string,
  brain: AgentBrain,
  options: RunTurnOptions = {},
): Promise<CrewRun> {
  const employees = options.employees?.length
    ? options.employees
    : assembleCrew(options.lead, task)
  return runCrew(task, brain, { ...options, employees })
}
