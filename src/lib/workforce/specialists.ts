/**
 * What expertise a task needs — never what software will provide it.
 *
 * The strongest idea in the agent-registry projects (MarimerLLC/AgentRegistry,
 * A2A Registry) is one separation:
 *
 *   capabilities and skills   describe the THING
 *   protocol and transport    describe HOW YOU REACH IT
 *
 * So a `SpecialistDefinition` says "a deep researcher needs web.search,
 * browser.extract and the source-triangulation skill". It does not say Claude,
 * or Claude Code, or Anthropic. Those are routing decisions, made later, from
 * the eligible set — and a specialist that named one would have pre-empted
 * every decision the router exists to make.
 *
 *     SpecialistDefinition        "what expertise do I need?"
 *              ↓
 *     required capabilities
 *              ↓
 *     ExecutionTarget discovery   "what software can execute it?"
 *              ↓
 *     AgentRuntime / ACP / A2A / MCP
 *
 * That split is also what lets an external agent — Claude Code, Codex,
 * OpenHands, an MCP-discovered tool — satisfy a specialist without BEING one.
 *
 * ## No routing here
 *
 * This file defines and finds. It never chooses. `eligibility.ts` filters the
 * candidates and, at Stage D, a Thompson router picks among what survives.
 */

import { WORKER_CAPABILITIES, type WorkerCapability } from './capabilities'
import { SOPS, type Sop } from './sop'
import type { WorkerKind } from '../task-ledger'

/**
 * Lifecycle, mirroring skills but shorter.
 *
 * A specialist is authored rather than evolved, so it has no candidate or
 * superseded state: the versioned, mutated thing is the SKILL it uses.
 */
export type SpecialistStatus = 'draft' | 'active' | 'deprecated'

export interface SkillRequirement {
  skillId: string
  /** Pinned version, when a specialist depends on specific wording. */
  version?: number
  /** A specialist can work without an optional skill; not without a required one. */
  required: boolean
}

export interface SpecialistDefinition {
  id: string
  version: number
  displayName: string
  description: string

  /** What this specialist can do, in the shared vocabulary. */
  capabilities: readonly WorkerCapability[]
  skills: readonly SkillRequirement[]

  execution: {
    /** Hard requirements. An execution target lacking one is ineligible. */
    requiredCapabilities: readonly WorkerCapability[]
    /**
     * A hint, never a constraint. 'workspace' means a machine helps; it does
     * not mean a particular runtime, and the router may ignore it.
     */
    prefers?: readonly ('workspace' | 'browser' | 'network')[]
  }

  /** What a MODEL must be able to do. Still not which model. */
  model?: {
    requiredCapabilities?: readonly ('reasoning' | 'vision' | 'tools' | 'structuredOutput')[]
  }

  instructions: string
  status: SpecialistStatus

  /**
   * The built-in worker kind this replaces, while the two vocabularies coexist.
   *
   * Present so migration is reversible and evidence recorded against a worker
   * kind stays attributable. It disappears when nothing routes on WorkerKind.
   */
  legacyWorkerKind?: WorkerKind
}

/**
 * The eight built-in worker kinds, as specialists.
 *
 * Capabilities come from `WORKER_CAPABILITIES` rather than being restated, so
 * the two cannot drift; a specialist claiming a capability its worker has no
 * tool for would make the scheduler confident and wrong.
 *
 * Instructions are carried across verbatim from `WORKER_PROMPTS`, because this
 * is a migration and rewriting the prompts at the same time would make any
 * behaviour change impossible to attribute.
 */
export const SPECIALISTS: readonly SpecialistDefinition[] = [
  {
    id: 'planner',
    version: 1,
    displayName: 'Planner',
    description: 'Breaks a goal into tasks with concrete artifact outputs.',
    capabilities: WORKER_CAPABILITIES.planner,
    skills: [],
    execution: { requiredCapabilities: [] },
    model: { requiredCapabilities: ['reasoning', 'structuredOutput'] },
    instructions: 'Break goals into tasks with concrete artifact outputs.',
    status: 'active',
    legacyWorkerKind: 'planner',
  },
  {
    id: 'deep-researcher',
    version: 1,
    displayName: 'Deep Researcher',
    description: 'Gathers evidence from the open web and cites what it found.',
    capabilities: WORKER_CAPABILITIES.research,
    skills: [{ skillId: 'deep-research', required: true }],
    execution: { requiredCapabilities: ['web.search'], prefers: ['network'] },
    model: { requiredCapabilities: ['tools'] },
    instructions:
      'Gather evidence. Output JSON artifacts with sources array. No opinions without citations.',
    status: 'active',
    legacyWorkerKind: 'research',
  },
  {
    id: 'browser-operator',
    version: 1,
    displayName: 'Browser Operator',
    description: 'Drives a real browser and records what it actually visited.',
    capabilities: WORKER_CAPABILITIES.browser,
    skills: [{ skillId: 'browser-research', required: true }],
    execution: { requiredCapabilities: ['browser.navigate'], prefers: ['browser'] },
    instructions:
      'Complete web actions. Record URLs visited and extracted data as JSON artifacts.',
    status: 'active',
    legacyWorkerKind: 'browser',
  },
  {
    id: 'engineer',
    version: 1,
    displayName: 'Engineer',
    description: 'Writes working code and proves it works with the project\'s own checks.',
    capabilities: WORKER_CAPABILITIES.code,
    skills: [{ skillId: 'build-feature', required: true }],
    execution: {
      requiredCapabilities: ['code.write', 'filesystem.write'],
      prefers: ['workspace'],
    },
    model: { requiredCapabilities: ['tools', 'reasoning'] },
    instructions:
      'Write working code or files, then prove they work with run_checks. '
      + 'Output real file contents, never descriptions of files.',
    status: 'active',
    legacyWorkerKind: 'code',
  },
  {
    id: 'analyst',
    version: 1,
    displayName: 'Analyst',
    description: 'Turns inputs into a structured report with sections and citations.',
    capabilities: WORKER_CAPABILITIES.analyst,
    skills: [{ skillId: 'analysis', required: true }],
    execution: { requiredCapabilities: ['data.analyze'] },
    model: { requiredCapabilities: ['reasoning'] },
    instructions:
      'Synthesize inputs into a structured markdown report with sections and citations.',
    status: 'active',
    legacyWorkerKind: 'analyst',
  },
  {
    id: 'writer',
    version: 1,
    displayName: 'Writer',
    description: 'Produces polished deliverables a person would actually send.',
    capabilities: WORKER_CAPABILITIES.writer,
    skills: [{ skillId: 'write-deliverable', required: true }],
    execution: { requiredCapabilities: ['writing.compose'] },
    instructions: 'Produce polished markdown deliverables. No meta-commentary about other agents.',
    status: 'active',
    legacyWorkerKind: 'writer',
  },
  {
    id: 'reviewer',
    version: 1,
    displayName: 'Reviewer',
    description: 'Validates artifacts against acceptance criteria and returns pass or fail.',
    capabilities: WORKER_CAPABILITIES.reviewer,
    skills: [],
    execution: { requiredCapabilities: [] },
    model: { requiredCapabilities: ['structuredOutput'] },
    instructions: 'Validate artifacts against acceptance criteria. Return structured pass/fail only.',
    status: 'active',
    legacyWorkerKind: 'reviewer',
  },
  {
    id: 'qa-engineer',
    version: 1,
    displayName: 'QA Engineer',
    description: "Runs the project's own tooling and reports what it returned.",
    capabilities: WORKER_CAPABILITIES.tester,
    skills: [{ skillId: 'verify-work', required: true }],
    execution: { requiredCapabilities: ['testing.run'], prefers: ['workspace'] },
    instructions:
      "Run run_checks and report what the project's own tooling returned. "
      + 'Output test_results.json with passed, problems, exit codes — never a guess.',
    status: 'active',
    legacyWorkerKind: 'tester',
  },
]

// ── Discovery ───────────────────────────────────────────────────────────────

export function specialistById(id: string): SpecialistDefinition | undefined {
  return SPECIALISTS.find((s) => s.id === id)
}

/** Only these may be routed to. A draft or deprecated specialist is not a candidate. */
export function activeSpecialists(
  specialists: readonly SpecialistDefinition[] = SPECIALISTS,
): SpecialistDefinition[] {
  return specialists.filter((s) => s.status === 'active')
}

/** Bridge while both vocabularies exist. */
export function specialistForWorker(worker: WorkerKind): SpecialistDefinition | undefined {
  return SPECIALISTS.find((s) => s.legacyWorkerKind === worker)
}

/**
 * Specialists whose capabilities cover everything a task requires.
 *
 * Discovery, not selection: it narrows by what is possible and says nothing
 * about what is best. `eligibility.ts` then applies the customer and runtime
 * gates, and only what survives both reaches a router.
 */
export function specialistsForCapabilities(
  required: readonly WorkerCapability[],
  specialists: readonly SpecialistDefinition[] = SPECIALISTS,
): SpecialistDefinition[] {
  return activeSpecialists(specialists)
    .filter((s) => required.every((c) => s.capabilities.includes(c)))
}

/** The skills a specialist needs before it can work. */
export function requiredSkills(
  specialist: SpecialistDefinition,
  skills: readonly Sop[] = SOPS,
): { resolved: Sop[]; missing: SkillRequirement[] } {
  const resolved: Sop[] = []
  const missing: SkillRequirement[] = []

  for (const requirement of specialist.skills) {
    // A pinned version must match exactly; an unpinned one takes whatever is
    // active. Silently falling back to a different version would make a
    // specialist's behaviour change without its definition changing.
    const found = skills.find((s) =>
      s.id === requirement.skillId
      && s.status === 'active'
      && (requirement.version === undefined || s.version === requirement.version))

    if (found) resolved.push(found)
    else if (requirement.required) missing.push(requirement)
  }

  return { resolved, missing }
}
