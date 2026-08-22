/**
 * Standard operating procedures for workers.
 *
 * `skills.ts` already exists and stays as it is — those four are chat modes for
 * /app slash commands, a different thing from this. An SOP is the procedure a
 * worker follows for a *kind of work*, and it is deliberately more than a
 * prompt fragment.
 *
 * The part that makes it real: an SOP carries the acceptance criteria for the
 * work it describes. A prose skill saying "cite your sources" is a suggestion;
 * an SOP whose `acceptance.minSources` is 3 gets enforced by the judge that
 * already runs. Procedure and definition-of-done live together, so they cannot
 * drift apart — which is exactly how "researched" came to mean "wrote
 * something that sounded researched".
 */

import type { AcceptanceCriteria, WorkerKind } from '../task-ledger'
import type { WorkerCapability } from './capabilities'

export interface SopStep {
  /** Imperative, one action. Steps that bundle three things get skimmed. */
  text: string
  /** Why it exists. Dropped from the prompt; kept so the SOP is maintainable. */
  rationale?: string
}

/**
 * Where a skill is in its life.
 *
 * Borrowed from agentoperations/agent-registry, whose important property is
 * that EVALUATIONS ARE EXTERNAL SIGNALS: the registry never lets a thing decide
 * it deserves promotion. That matters more here than anywhere, because the
 * thing being evolved and the thing doing the evolving are both language
 * models.
 *
 *   candidate   a mutation exists; nothing has run it
 *   evaluated   it has been measured against the incumbent
 *   approved    measured better, and cleared for use
 *   active      what a specialist actually gets today
 *   superseded  a later version won
 *   rejected    measured, and not better
 *
 * Nothing is promoted automatically. Promotion stays gated until the
 * evaluation signal is trustworthy, and `activeSkills()` is the only thing the
 * prompt path reads.
 */
export type SkillStatus =
  | 'candidate' | 'evaluated' | 'approved' | 'active' | 'superseded' | 'rejected'

export interface Sop {
  id: string
  name: string
  /**
   * Bumped when the CONTENT changes, so evidence can distinguish
   * `systematic-debugging@7` from `@6`. Without it three variants of one skill
   * are indistinguishable in the routing evidence, which is precisely what
   * evolution needs to compare.
   */
  version: number
  /** The version this was mutated from, when it was. */
  parentVersion?: number
  status: SkillStatus
  /** The task types this procedure serves. */
  appliesTo: readonly WorkerKind[]
  whenToUse: string
  inputs: readonly string[]
  capabilities: readonly WorkerCapability[]
  process: readonly SopStep[]
  /** Artifact path suffixes this SOP expects to produce. */
  expectedOutputs: readonly string[]
  /** Merged into the task's own criteria — this is what makes an SOP binding. */
  acceptance: AcceptanceCriteria
  /** Conditions under which the worker must stop and report BLOCKED. */
  failureConditions: readonly string[]
}

export const SOPS: readonly Sop[] = [
  {
    id: 'deep-research',
    name: 'Deep Research',
    version: 1,
    status: 'active',
    appliesTo: ['research'],
    whenToUse: 'A question needs evidence from multiple independent sources.',
    inputs: ['the research question', 'any prior findings in the project ledger'],
    capabilities: ['web.search', 'browser.navigate', 'browser.extract'],
    process: [
      { text: 'Decompose the question into the specific claims that would answer it.' },
      {
        text: 'Search for each claim separately, not the question as one query.',
        rationale: 'One broad query returns one perspective and reads as consensus.',
      },
      { text: 'Open the primary source rather than trusting a search snippet.' },
      {
        text: 'Record every claim with the URL it came from.',
        rationale: 'A claim whose source cannot be named later is indistinguishable from one invented.',
      },
      {
        text: 'State conflicts between sources explicitly. Do not average them into one confident answer.',
        rationale: 'Conflicting evidence is a finding; hiding it is a fabrication.',
      },
      { text: 'Write the structured artifact, then the summary — never the reverse.' },
    ],
    expectedOutputs: ['.json'],
    acceptance: { minSources: 3 },
    failureConditions: [
      'Fewer than 3 usable sources found — report BLOCKED rather than padding.',
      'Search returned nothing and no fallback provider is available.',
    ],
  },
  {
    id: 'build-feature',
    name: 'Build a Feature',
    version: 1,
    status: 'active',
    appliesTo: ['code'],
    whenToUse: 'Code must be written or changed in a real workspace.',
    inputs: ['requirements', 'the existing repository'],
    capabilities: ['code.write', 'filesystem.read', 'filesystem.write', 'terminal.exec', 'testing.run'],
    process: [
      { text: 'Clone or open the workspace before writing anything.' },
      {
        text: 'Read the surrounding code first and match its conventions.',
        rationale: 'Code that reads as foreign is rejected by review even when correct.',
      },
      { text: 'Make the change.' },
      {
        text: 'Run run_checks and read what it actually returned.',
        rationale: 'Claiming tests pass without running them is the single most common failure.',
      },
      { text: 'If checks fail, fix and re-run. Do not report a red build as complete.' },
      { text: 'Output the real file contents, never a description of them.' },
    ],
    expectedOutputs: ['.json', '.md'],
    acceptance: { minBodyLength: 40 },
    failureConditions: [
      'No sandbox available — report BLOCKED, do not describe hypothetical code.',
      'Checks still failing after the retry budget is spent.',
    ],
  },
  {
    id: 'verify-work',
    name: 'Verify Work',
    version: 1,
    status: 'active',
    appliesTo: ['tester', 'reviewer'],
    whenToUse: "Another worker's output must be checked before it counts.",
    inputs: ['the artifacts under test', 'their acceptance criteria'],
    capabilities: ['testing.run', 'terminal.exec'],
    process: [
      { text: 'Read the acceptance criteria before looking at the work.' },
      {
        text: 'Run the project\'s own tooling. Report its exit code and output verbatim.',
        rationale: 'A summary of a test run is not a test run.',
      },
      { text: 'Check each criterion separately and record pass or fail per criterion.' },
      {
        text: 'Report every failure found, not just the first.',
        rationale: 'One-at-a-time failures cost a full retry cycle each.',
      },
    ],
    expectedOutputs: ['.json'],
    acceptance: { mustInclude: ['passed'] },
    failureConditions: ['The artifacts under test do not exist.'],
  },
  {
    id: 'analysis',
    name: 'Structured Analysis',
    version: 1,
    status: 'active',
    appliesTo: ['analyst'],
    whenToUse: 'Findings must be turned into a decision or a comparison.',
    inputs: ['upstream artifacts'],
    capabilities: ['data.analyze', 'writing.compose'],
    process: [
      { text: 'Read every input artifact before forming a view.' },
      { text: 'State the criteria you are comparing on, before the comparison.' },
      {
        text: 'Attribute each data point to the artifact it came from.',
        rationale: 'An analysis whose inputs cannot be traced cannot be rechecked.',
      },
      { text: 'Name what the evidence does not cover, rather than filling the gap.' },
    ],
    expectedOutputs: ['.md', '.json'],
    acceptance: { minBodyLength: 200 },
    failureConditions: ['Required input artifacts are missing or empty.'],
  },
  {
    id: 'browser-research',
    name: 'Browser Research',
    version: 1,
    status: 'active',
    appliesTo: ['browser'],
    whenToUse: 'Data lives behind interaction — a form, a login wall, a rendered page.',
    inputs: ['target URLs', 'what to extract'],
    capabilities: ['browser.navigate', 'browser.act'],
    process: [
      { text: 'Navigate and read the accessibility tree or DOM before considering a screenshot.',
        rationale: 'Vision is slower, costlier and less exact than the DOM that is already there.' },
      { text: 'Extract into a structured shape, not prose.' },
      { text: 'Record every URL visited.' },
      { text: 'Take a screenshot only as evidence for something the DOM could not show.' },
    ],
    expectedOutputs: ['.json'],
    acceptance: { minSources: 1 },
    failureConditions: [
      'Hosted Chrome unavailable — report BLOCKED rather than describing the page from memory.',
      'The page requires credentials that were not supplied.',
    ],
  },
  {
    id: 'write-deliverable',
    name: 'Write a Deliverable',
    version: 1,
    status: 'active',
    appliesTo: ['writer'],
    whenToUse: 'A finished document is the output.',
    inputs: ['upstream artifacts', 'the audience'],
    capabilities: ['writing.compose', 'document.create'],
    process: [
      { text: 'Work only from artifacts already in the project. Do not add new claims.' },
      { text: 'Lead with the conclusion, then the support.' },
      { text: 'Carry citations through from the source artifacts.' },
      { text: 'Write no meta-commentary about the process or other workers.' },
    ],
    expectedOutputs: ['.md', '.html'],
    acceptance: { minBodyLength: 300 },
    failureConditions: ['No upstream artifacts to write from.'],
  },
]

export function sopFor(worker: WorkerKind): Sop | undefined {
  return SOPS.find((s) => s.appliesTo.includes(worker))
}

/**
 * A skill and an SOP are the same object.
 *
 * `Sop` is the name this had first; `SkillDefinition` is the name the evolution
 * work uses. Deliberately an alias rather than a second type: an SOP already
 * carries capabilities, a procedure, expected outputs and acceptance criteria
 * that the judge ENFORCES, so a parallel SkillDefinition would be a second
 * source of truth for the same thing — the failure this codebase keeps removing.
 *
 * (Unrelated to `src/lib/skills.ts`, which names the chat modes — ask, plan,
 * debug, multitask. Same word, different concept, and worth saying once.)
 */
export type SkillDefinition = Sop

/** Only these reach a prompt. A candidate mutation must never leak into a run. */
export function activeSkills(skills: readonly Sop[] = SOPS): Sop[] {
  return skills.filter((s) => s.status === 'active')
}

export function sopById(id: string): Sop | undefined {
  return SOPS.find((s) => s.id === id)
}

/**
 * Merge an SOP's criteria with the task's own. The task wins on conflict — a
 * planner that asked for 8 sources meant it, and an SOP floor of 3 must not
 * quietly relax that.
 */
export function mergeAcceptance(
  sop: Sop | undefined,
  task: AcceptanceCriteria | undefined,
): AcceptanceCriteria | undefined {
  if (!sop) return task
  if (!task) return { ...sop.acceptance }
  return {
    ...sop.acceptance,
    ...task,
    minArrayLength: { ...sop.acceptance.minArrayLength, ...task.minArrayLength },
    mustInclude: [...(sop.acceptance.mustInclude ?? []), ...(task.mustInclude ?? [])],
    minSources: Math.max(sop.acceptance.minSources ?? 0, task.minSources ?? 0) || undefined,
    minBodyLength: Math.max(sop.acceptance.minBodyLength ?? 0, task.minBodyLength ?? 0) || undefined,
  }
}

/** Render for a worker prompt. Rationales are omitted — they are for us. */
export function renderSop(sop: Sop): string {
  const lines = [
    `PROCEDURE — ${sop.name}`,
    `Use when: ${sop.whenToUse}`,
    '',
    'Steps:',
    ...sop.process.map((step, i) => `${i + 1}. ${step.text}`),
  ]
  if (sop.failureConditions.length) {
    lines.push('', 'Stop and report BLOCKED if:')
    lines.push(...sop.failureConditions.map((c) => `- ${c}`))
  }
  return lines.join('\n')
}
