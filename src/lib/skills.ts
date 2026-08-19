// Skills are modes for the same crew — same pattern as Continue / Cline / goose,
// not a Cursor clone. Plan and Ask cannot send mail, commit, or click Chrome.

export type SkillId = 'plan' | 'debug' | 'multitask' | 'ask'

export interface SkillSpec {
  id: SkillId
  name: string
  desc: string
  accent: string
}

export const SKILLS: readonly SkillSpec[] = [
  { id: 'plan', name: 'Plan', desc: 'Generate an implementation plan.', accent: '#c2410c' },
  { id: 'debug', name: 'Debug', desc: 'Pinpoint the root cause of an issue.', accent: '#b91c1c' },
  { id: 'multitask', name: 'Multitask', desc: 'Hire a crew, work in parallel, one merged answer.', accent: '#6d28d9' },
  { id: 'ask', name: 'Ask', desc: 'Answer questions without sending, committing, or clicking.', accent: '#15803d' },
]

const SIDE_EFFECTS = new Set([
  'gmail_send',
  'slack_post',
  'github_write_file',
  'github_create_branch',
  'github_open_pr',
  'web_act',
])

export function isSkillId(value: string): value is SkillId {
  return SKILLS.some((s) => s.id === value)
}

export function wrapSkillPrompt(skill: SkillId, task: string): string {
  if (skill === 'plan') {
    return `SKILL: PLAN. Produce a concrete implementation plan with steps and risks. Do not send email, commit, or use web_act.\n\n${task}`
  }
  if (skill === 'debug') {
    return `SKILL: DEBUG. Find the root cause. Use search, inbox, code review, and browse. Only write or send if the user asked to fix it.\n\n${task}`
  }
  if (skill === 'ask') {
    return `SKILL: ASK. Read-only. Answer from tools and the table. No gmail_send, slack_post, github writes, or web_act.\n\n${task}`
  }
  return `SKILL: MULTITASK. Hire specialists, run in parallel, merge into one answer.\n\n${task}`
}

export function toolsForSkill(tools: string[], skill: SkillId = 'multitask'): string[] {
  if (skill !== 'ask' && skill !== 'plan') return tools
  return tools.filter((id) => !SIDE_EFFECTS.has(id))
}

export function filterSkills(query: string): SkillSpec[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...SKILLS]
  return SKILLS.filter((s) => `${s.name} ${s.desc} ${s.id}`.toLowerCase().includes(q))
}
