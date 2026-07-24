import { runEmployee } from './graph'
import type { LiveConnectionConfig } from './live-connections'
import type { AgentBrain, Employee, RunResult } from './types'

export interface AgentEvaluationCase {
  id: string
  category: 'knowledge' | 'analysis' | 'code' | 'connection' | 'multi-tool' | 'direct'
  input: string
  expectedTools: readonly string[]
  answerIncludes?: readonly string[]
}

export interface AgentEvaluationResult {
  caseId: string
  category: AgentEvaluationCase['category']
  score: number
  selection: number
  execution: number
  answer: number
  trace: number
  actualTools: string[]
  failures: string[]
  run: RunResult
}

export interface AgentEvaluationSummary {
  score: number
  passed: number
  total: number
  results: AgentEvaluationResult[]
  byCategory: Record<string, number>
}

export const AGENT_BENCHMARK_CASES: readonly AgentEvaluationCase[] = [
  { id: 'math-precedence', category: 'analysis', input: 'What is 12 * (3 + 4)?', expectedTools: ['calculator'], answerIncludes: ['84'] },
  { id: 'math-division', category: 'analysis', input: 'Calculate 144 / 12.', expectedTools: ['calculator'], answerIncludes: ['12'] },
  { id: 'math-percentage', category: 'analysis', input: 'Calculate 80 * 0.15.', expectedTools: ['calculator'], answerIncludes: ['12'] },
  { id: 'math-negative', category: 'analysis', input: 'Work out (9 - 14) * 3.', expectedTools: ['calculator'], answerIncludes: ['-15'] },
  { id: 'math-decimal', category: 'analysis', input: 'Calculate 2.5 * 8.', expectedTools: ['calculator'], answerIncludes: ['20'] },

  { id: 'docs-pricing', category: 'knowledge', input: 'How much will the Pro plan cost?', expectedTools: ['search_docs'] },
  { id: 'docs-refund', category: 'knowledge', input: 'What is the OpenMind refund policy?', expectedTools: ['search_docs'] },
  { id: 'docs-provider', category: 'knowledge', input: 'Which provider can OpenMind use?', expectedTools: ['search_docs'] },
  { id: 'docs-embed', category: 'knowledge', input: 'How will the widget embed work?', expectedTools: ['search_docs'] },
  { id: 'docs-keys', category: 'knowledge', input: 'Where do provider keys live?', expectedTools: ['search_docs'] },

  { id: 'summarize-short', category: 'analysis', input: 'Summarize: The launch went well. Activation rose. Support volume stayed flat.', expectedTools: ['summarize'] },
  { id: 'summarize-points', category: 'analysis', input: 'Give me the key points: Sales rose in May. Churn fell in June. Retention improved.', expectedTools: ['summarize'] },
  { id: 'summarize-condense', category: 'analysis', input: 'Condense this report: Customers value speed. They dislike setup. Documentation helps.', expectedTools: ['summarize'] },
  { id: 'summarize-tldr', category: 'analysis', input: 'TL;DR: The migration completed, checks passed, and no rollback was required.', expectedTools: ['summarize'] },

  { id: 'sentiment-positive', category: 'analysis', input: 'Check sentiment: I love the fast and excellent support.', expectedTools: ['sentiment'] },
  { id: 'sentiment-negative', category: 'analysis', input: 'Analyze this feedback: I am angry and disappointed with the broken app.', expectedTools: ['sentiment'] },
  { id: 'sentiment-urgent', category: 'analysis', input: 'What is the urgency and tone? This outage is critical and we need help now.', expectedTools: ['sentiment'] },
  { id: 'sentiment-neutral', category: 'analysis', input: 'Score the sentiment of this feedback: The package arrived on Tuesday.', expectedTools: ['sentiment'] },

  { id: 'code-var', category: 'code', input: 'Review this code: var value = input; console.log(value)', expectedTools: ['code_review'] },
  { id: 'code-eval', category: 'code', input: 'Review this JavaScript function that calls eval(userInput).', expectedTools: ['code_review'] },
  { id: 'code-clean', category: 'code', input: 'Review this TypeScript code: const upper = (value: string) => value.toUpperCase()', expectedTools: ['code_review'] },
  { id: 'code-todo', category: 'code', input: 'Check this script for bugs: const ready = true // TODO handle failure', expectedTools: ['code_review'] },

  { id: 'conn-gmail', category: 'connection', input: 'Find refund emails in Gmail.', expectedTools: ['gmail'] },
  { id: 'conn-outlook', category: 'connection', input: 'Check my Outlook inbox.', expectedTools: ['outlook'] },
  { id: 'conn-calendar', category: 'connection', input: 'What meetings are on my calendar today?', expectedTools: ['gcal'] },
  { id: 'conn-slack', category: 'connection', input: 'Show recent Slack mentions.', expectedTools: ['slack'] },
  { id: 'conn-github', category: 'connection', input: 'Which GitHub pull requests are ready?', expectedTools: ['github'] },
  { id: 'conn-linear', category: 'connection', input: 'Show active Linear issues.', expectedTools: ['linear'] },
  { id: 'conn-jira', category: 'connection', input: 'List high priority Jira tickets.', expectedTools: ['jira'] },
  { id: 'conn-zendesk', category: 'connection', input: 'Search the support ticket queue.', expectedTools: ['zendesk'] },
  { id: 'conn-hubspot', category: 'connection', input: 'Which HubSpot deals are in the pipeline?', expectedTools: ['hubspot'] },
  { id: 'conn-notion', category: 'connection', input: 'Find the launch checklist in Notion.', expectedTools: ['notion'] },
  { id: 'conn-drive', category: 'connection', input: 'Find the roadmap file in Google Drive.', expectedTools: ['gdrive'] },

  { id: 'multi-summary-sentiment', category: 'multi-tool', input: 'Summarize this feedback and check sentiment: I love the speed but setup is frustrating.', expectedTools: ['summarize', 'sentiment'] },
  { id: 'multi-mail-calendar', category: 'multi-tool', input: 'Check my email and calendar for today.', expectedTools: ['gmail', 'gcal'] },
  { id: 'direct-greeting', category: 'direct', input: 'Hello there!', expectedTools: [] },
] as const

function sameTools(actual: readonly string[], expected: readonly string[]): boolean {
  const normalize = (values: readonly string[]) => [...new Set(values)].sort()
  return JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected))
}

export function scoreAgentRun(testCase: AgentEvaluationCase, run: RunResult): AgentEvaluationResult {
  const actualTools = run.toolCalls.map((call) => call.tool)
  const failures: string[] = []
  const selection = sameTools(actualTools, testCase.expectedTools) ? 1 : 0
  if (!selection) failures.push(`expected tools [${testCase.expectedTools.join(', ')}], got [${actualTools.join(', ')}]`)

  const execution = run.toolCalls.every((call) => !/(?:^|\]\s)error:/i.test(call.output)) ? 1 : 0
  if (!execution) failures.push('one or more tools returned an error')

  const missingTerms = (testCase.answerIncludes ?? [])
    .filter((term) => !run.answer.toLowerCase().includes(term.toLowerCase()))
  const answer = run.answer.trim() && !missingTerms.length ? 1 : 0
  if (!answer) failures.push(missingTerms.length ? `answer omitted: ${missingTerms.join(', ')}` : 'answer was empty')

  const nodes = run.trace.map((line) => line.node)
  const trace = nodes[0] === 'plan' && nodes.at(-1) === 'respond' &&
    nodes.filter((node) => node === 'act').length === run.toolCalls.length ? 1 : 0
  if (!trace) failures.push('trace did not match plan/act/respond execution')

  const score = selection * 0.5 + execution * 0.25 + answer * 0.15 + trace * 0.1
  return {
    caseId: testCase.id,
    category: testCase.category,
    score,
    selection,
    execution,
    answer,
    trace,
    actualTools,
    failures,
    run,
  }
}

export async function runAgentEvaluation(
  brain: AgentBrain,
  employee: Employee,
  cases: readonly AgentEvaluationCase[] = AGENT_BENCHMARK_CASES,
  configs?: LiveConnectionConfig[] | Record<string, LiveConnectionConfig>,
): Promise<AgentEvaluationSummary> {
  const results: AgentEvaluationResult[] = []
  for (const testCase of cases) {
    const run = await runEmployee(brain, employee, testCase.input, undefined, configs)
    results.push(scoreAgentRun(testCase, run))
  }

  const categories = [...new Set(results.map((result) => result.category))]
  const byCategory = Object.fromEntries(categories.map((category) => {
    const matching = results.filter((result) => result.category === category)
    return [category, matching.reduce((sum, result) => sum + result.score, 0) / matching.length]
  }))
  return {
    score: results.reduce((sum, result) => sum + result.score, 0) / Math.max(1, results.length),
    passed: results.filter((result) => result.score === 1).length,
    total: results.length,
    results,
    byCategory,
  }
}
