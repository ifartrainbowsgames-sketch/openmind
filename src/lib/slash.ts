import { SKILLS, type SkillId } from './skills'

export type SlashAction = 'files' | 'model' | 'connect' | 'settings' | 'browser'

export interface SlashCommand {
  cmd: string
  title: string
  desc: string
  skill?: SkillId
  prompt?: string
  action?: SlashAction
}

/** / commands in the composer — OpenMind skills plus work shortcuts. */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { cmd: '/plan', title: 'Plan', desc: 'Implementation plan. No send, commit, or click.', skill: 'plan' },
  { cmd: '/debug', title: 'Debug', desc: 'Find the root cause.', skill: 'debug' },
  { cmd: '/multitask', title: 'Multitask', desc: 'Crew in parallel, then they talk.', skill: 'multitask' },
  { cmd: '/ask', title: 'Ask', desc: 'Read-only answers.', skill: 'ask' },
  { cmd: '/inbox', title: 'Inbox', desc: 'List mail and draft together.', skill: 'multitask', prompt: 'List my unread email. Draft replies together on the table. Do not send until we agree.' },
  { cmd: '/business', title: 'Business', desc: 'Structure the offer and 14-day plan.', skill: 'plan', prompt: 'Structure the business: offer, who it is for, 14-day plan, and the next real action.' },
  { cmd: '/web', title: 'Web', desc: 'Hosted Chrome task (web_act).', skill: 'multitask', prompt: 'Open the site in Chrome and complete the task. Use web_act. Confirm before money: ' },
  { cmd: '/research', title: 'Research', desc: 'Cited web research brief.', skill: 'ask', prompt: 'Research this topic and give a concise cited brief: ' },
  { cmd: '/files', title: 'Files', desc: 'Attach a file.', action: 'files' },
  { cmd: '/model', title: 'Model', desc: 'Pick model and Browserless key.', action: 'model' },
  { cmd: '/connect', title: 'Connect', desc: 'Connect Gmail, GitHub, Slack.', action: 'connect' },
  { cmd: '/browser', title: 'Browser', desc: 'Show the browser pane.', action: 'browser' },
  { cmd: '/settings', title: 'Settings', desc: 'Account, keys, voice.', action: 'settings' },
]

export function slashQuery(draft: string): string | null {
  if (!draft.startsWith('/')) return null
  if (/\s/.test(draft)) return null
  return draft.toLowerCase()
}

export function matchSlashCommands(draft: string): SlashCommand[] {
  const q = slashQuery(draft)
  if (q === null) return []
  if (q === '/') return [...SLASH_COMMANDS]
  return SLASH_COMMANDS.filter((c) => c.cmd.startsWith(q) || c.title.toLowerCase().startsWith(q.slice(1)))
}

export function consumeSlash(draft: string): { command: SlashCommand; rest: string } | null {
  const trimmed = draft.trim()
  if (!trimmed.startsWith('/')) return null
  const [head, ...bits] = trimmed.split(/\s+/)
  const command = SLASH_COMMANDS.find((c) => c.cmd === head.toLowerCase())
  if (!command) return null
  return { command, rest: bits.join(' ') }
}

export function applySlashToDraft(command: SlashCommand, rest: string): string {
  if (command.prompt) return `${command.prompt}${rest}`.trim()
  return rest
}

export function lastHttpUrl(text: string): string | null {
  const matches = text.match(/https?:\/\/[^\s)"']+/gi)
  if (!matches?.length) return null
  return matches[matches.length - 1]?.replace(/[.,;]+$/, '') ?? null
}
