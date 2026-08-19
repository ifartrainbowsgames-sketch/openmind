import {
  createProject,
  DEFAULT_LIMITS,
  logEvent,
  makeTaskId,
  type AcceptanceCriteria,
  type ProjectState,
  type TaskRecord,
  type WorkerKind,
} from './task-ledger'
import { stripWorkspacePrompt } from './workspace'

const RESEARCH_RE = /\b(research|competitor|compare|market|trends?|find|look up|who is|what is|sources?)\b/i
const BUILD_RE = /\b(build|create|landing page|website|app|implement|code|develop|write files?)\b/i
const ANALYSIS_RE = /\b(analy[sz]e|analysis|report|brief|summary|breakdown)\b/i
const TEST_RE = /\b(test|qa|verify|validate|check that)\b/i

export interface PlanResult {
  project: ProjectState
  contracts: Array<{ taskId: string; path: string; kind: 'markdown' | 'html' | 'json' | 'csv'; title: string }>
}

/** Heuristic task DAG — replaces role-play hiring. LLM planner can plug in later. */
export function planProject(rawGoal: string, limits = DEFAULT_LIMITS): PlanResult {
  const goal = stripWorkspacePrompt(rawGoal)
  let project = createProject(goal, limits)
  const tasks: TaskRecord[] = []
  let n = 1

  const add = (
    type: WorkerKind,
    taskGoal: string,
    outputs: string[],
    dependsOn: string[],
    acceptance?: AcceptanceCriteria,
  ) => {
    const id = makeTaskId(n++)
    tasks.push({
      id,
      type,
      goal: taskGoal,
      inputs: { industry: goal.slice(0, 200) },
      outputs,
      acceptance,
      dependsOn,
      status: 'pending',
      worker: type,
      limits,
      retries: 0,
      stepsUsed: 0,
      costUsd: 0,
      artifactIds: [],
    })
    return id
  }

  const wantsResearch = RESEARCH_RE.test(goal)
  const wantsBuild = BUILD_RE.test(goal)
  const wantsAnalysis = ANALYSIS_RE.test(goal) || (wantsResearch && wantsBuild)
  const wantsTest = TEST_RE.test(goal) || wantsBuild

  let researchIds: string[] = []
  if (wantsResearch) {
    const competitors = add(
      'research',
      'Find major competitors and cite sources',
      ['research/competitors.json'],
      [],
      { minArrayLength: { competitors: 3 }, minSources: 5 },
    )
    const pricing = add(
      'research',
      'Collect pricing tiers and packaging',
      ['research/pricing.json'],
      [],
      { minSources: 3 },
    )
    const features = add(
      'research',
      'Extract product features and differentiators',
      ['research/features.json'],
      [],
      { minSources: 3 },
    )
    researchIds = [competitors, pricing, features]
  } else if (goal.length > 80 || /\?/.test(goal)) {
    researchIds = [
      add('research', 'Gather evidence for the user goal', ['research/dossier.json'], [], { minSources: 3 }),
    ]
  }

  let analysisId: string | undefined
  if (wantsAnalysis && researchIds.length) {
    analysisId = add(
      'analyst',
      'Synthesize research into a structured analysis',
      ['analysis/report.md'],
      researchIds,
      { minBodyLength: 200, mustInclude: ['##'] },
    )
  }

  let buildId: string | undefined
  if (wantsBuild) {
    const deps = analysisId ? [analysisId] : researchIds.length ? researchIds.slice(0, 1) : []
    buildId = add(
      'code',
      'Produce working deliverable files for the goal',
      wantsBuild && /landing|website|page/i.test(goal) ? ['website/index.html', 'website/styles.css'] : ['output/deliverable.md'],
      deps,
      { minBodyLength: 100 },
    )
  }

  if (wantsTest && buildId) {
    add(
      'tester',
      'Validate deliverable against requirements',
      ['qa/test_results.json'],
      [buildId],
      { minBodyLength: 20 },
    )
  }

  if (!tasks.length) {
    add('writer', 'Answer the user goal directly', ['output/answer.md'], [], { minBodyLength: 20 })
  }

  project = { ...project, tasks, requirements: extractRequirements(goal) }
  project = logEvent(project, {
    action: 'create_task',
    worker: 'planner',
    detail: `Task graph: ${tasks.length} tasks — ${tasks.map((t) => t.worker).join(' → ')}`,
  })

  const contracts = tasks.flatMap((t) =>
    t.outputs.map((path) => ({
      taskId: t.id,
      path,
      kind: path.endsWith('.json') ? 'json' as const : path.endsWith('.html') ? 'html' as const : 'markdown' as const,
      title: path.split('/').pop() ?? path,
    })),
  )

  return { project, contracts }
}

function extractRequirements(goal: string): string[] {
  const reqs: string[] = []
  if (RESEARCH_RE.test(goal)) reqs.push('Evidence-backed research with sources')
  if (BUILD_RE.test(goal)) reqs.push('Concrete files or code, not prose-only')
  if (ANALYSIS_RE.test(goal)) reqs.push('Structured analysis document')
  if (TEST_RE.test(goal)) reqs.push('Validation with pass/fail criteria')
  if (!reqs.length) reqs.push('Clear answer with artifact on disk')
  return reqs
}

export function needsTaskGraph(rawGoal: string): boolean {
  const goal = stripWorkspacePrompt(rawGoal)
  if (isSimpleGoal(goal)) return false
  return goal.length > 60 || BUILD_RE.test(goal) || (RESEARCH_RE.test(goal) && goal.length > 30)
}

function isSimpleGoal(goal: string): boolean {
  if (goal.length < 120 && /^(hi|hello|hey|yo|thanks|thank you|ok|okay)\b[!.?\s]*$/i.test(goal.trim())) return true
  if (goal.length < 40 && !/\b(build|research|create|analyze|compare|deploy|write|code|find|list)\b/i.test(goal)) return true
  return false
}
