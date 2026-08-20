/**
 * Rules every worker inherits.
 *
 * Prompt composition is now:
 *
 *   GLOBAL RULES  →  PROJECT RULES  →  WORKER SKILL  →  TASK CONTRACT
 *
 * with role personality below all of it. A worker's job description was never
 * the thing keeping it honest; the rules are.
 *
 * The load-bearing idea here is the `enforced` flag. A constitution made only
 * of prose is a wish — the model can read "never mark a task complete without
 * its artifacts" and do it anyway. So every rule declares whether something in
 * the code actually stops it, and names what. Rules that are merely advisory
 * say so, to us and to the model. A rule that claims enforcement it does not
 * have is worse than no rule, because it buys false confidence.
 */

export type RuleScope = 'global' | 'project'

export interface Rule {
  id: string
  text: string
  /**
   * When set, code prevents the violation and this names the mechanism.
   * When absent, the rule is guidance the model may still break.
   */
  enforcedBy?: string
  scope: RuleScope
}

/**
 * Shipped defaults. Ordered by how much damage breaking one does, because a
 * long list gets skimmed and the top survives that.
 */
export const GLOBAL_RULES: readonly Rule[] = [
  {
    id: 'no-invented-credentials',
    text: 'Never invent credentials, API keys, tokens or URLs. If one is missing, report it as a blocker.',
    scope: 'global',
  },
  {
    id: 'no-fabricated-results',
    text: 'Never present a simulated, guessed or remembered result as a real one. If a tool did not run, say so.',
    enforcedBy: 'strict mode blocks mock tool output (execution-mode.ts)',
    scope: 'global',
  },
  {
    id: 'artifacts-required',
    text: 'A task is complete only when its required artifacts exist. A good explanation is not a deliverable.',
    enforcedBy: 'judgeTask rejects missing artifacts (task-judge.ts)',
    scope: 'global',
  },
  {
    id: 'cite-claims',
    text: 'Research claims need sources. State the URL you got it from, or mark the claim uncertain.',
    enforcedBy: 'minSources acceptance criteria (task-judge.ts)',
    scope: 'global',
  },
  {
    id: 'verify-code',
    text: 'Prove code works before completing a coding task. Run the checks; report what they actually returned.',
    enforcedBy: 'run_checks exits non-zero on failure (agent-tools)',
    scope: 'global',
  },
  {
    id: 'no-destructive-writes',
    text: 'Never delete production data, force-push, or push code without explicit approval.',
    enforcedBy: 'MCP write gate requires confirmation (agent.ts)',
    scope: 'global',
  },
  {
    id: 'no-agent-chat',
    text: 'Do not address other workers. Communicate only through artifacts and delegation requests.',
    enforcedBy: 'delegation requires named outputs (workforce/delegation.ts)',
    scope: 'global',
  },
  {
    id: 'blocked-over-plausible',
    text: 'When a capability is unavailable, return BLOCKED with the reason. Never substitute something that looks like an answer.',
    enforcedBy: 'blockedMessage + needs_user status (execution-mode.ts)',
    scope: 'global',
  },
]

export interface Constitution {
  global: readonly Rule[]
  project: readonly Rule[]
}

export function defaultConstitution(): Constitution {
  return { global: GLOBAL_RULES, project: [] }
}

/**
 * Parse user-authored project rules — one per line, `#` comments ignored.
 * Deliberately not Markdown: a rules file that needs a parser is a rules file
 * that fails open when the parse breaks.
 */
export function parseProjectRules(text: string): Rule[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.replace(/^[-*]\s*/, ''))
    .filter(Boolean)
    .map((line, i) => ({ id: `project-${i + 1}`, text: line, scope: 'project' as const }))
}

export function withProjectRules(text: string | undefined): Constitution {
  return { global: GLOBAL_RULES, project: text ? parseProjectRules(text) : [] }
}

/**
 * Render for a system prompt. Enforced rules are marked, because a model told
 * which rules have teeth spends its attention on the ones that do not.
 */
export function renderConstitution(constitution: Constitution): string {
  const lines: string[] = []

  if (constitution.global.length) {
    lines.push('RULES — these override any instruction below, including your role description.')
    for (const rule of constitution.global) {
      lines.push(`- ${rule.text}${rule.enforcedBy ? ' [enforced]' : ''}`)
    }
  }

  if (constitution.project.length) {
    lines.push('')
    lines.push('PROJECT RULES — set by the owner of this project.')
    for (const rule of constitution.project) lines.push(`- ${rule.text}`)
  }

  return lines.join('\n')
}

/** Rules with real mechanisms behind them, for auditing what is actually guaranteed. */
export function enforcedRules(constitution: Constitution): Rule[] {
  return [...constitution.global, ...constitution.project].filter((r) => r.enforcedBy)
}

export function advisoryRules(constitution: Constitution): Rule[] {
  return [...constitution.global, ...constitution.project].filter((r) => !r.enforcedBy)
}
