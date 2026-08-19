export type WorkspaceKind = 'github' | 'slack' | 'openmind'

export interface WorkspaceChoice {
  id: WorkspaceKind
  label: string
  hint: string
}

export const WORKSPACE_CHOICES: WorkspaceChoice[] = [
  { id: 'github', label: 'GitHub · main', hint: 'Create a repo on main and code there' },
  { id: 'slack', label: 'Slack', hint: 'Post the brief and updates to Slack' },
  { id: 'openmind', label: 'OpenMind', hint: 'Stay in this chat only' },
]

export interface WorkspaceSpace {
  kind: WorkspaceKind
  slug: string
  branch: 'main'
  source: 'live' | 'mock'
  summary: string
  repoUrl?: string
  repoName?: string
  channel?: string
  /** Nango GitHub connection used for nango-act writes. */
  connectionId?: string
  providerId?: string
}

export function repoSlug(prompt: string): string {
  const s = prompt
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return s || 'openmind-project'
}

export function isWorkspaceKind(value: unknown): value is WorkspaceKind {
  return value === 'github' || value === 'slack' || value === 'openmind'
}

export function parseWorkspaceSpace(value: unknown): WorkspaceSpace | undefined {
  if (!value || typeof value !== 'object') return undefined
  const space = value as Partial<WorkspaceSpace>
  if (!isWorkspaceKind(space.kind) || typeof space.slug !== 'string' || typeof space.summary !== 'string') return undefined
  if (space.source !== 'live' && space.source !== 'mock') return undefined
  return {
    kind: space.kind,
    slug: space.slug,
    branch: 'main',
    source: space.source,
    summary: space.summary,
    repoUrl: typeof space.repoUrl === 'string' ? space.repoUrl : undefined,
    repoName: typeof space.repoName === 'string' ? space.repoName : undefined,
    channel: typeof space.channel === 'string' ? space.channel : undefined,
    connectionId: typeof space.connectionId === 'string' ? space.connectionId : undefined,
    providerId: typeof space.providerId === 'string' ? space.providerId : undefined,
  }
}

export function workspacePrompt(space: WorkspaceSpace, userPrompt: string): string {
  const where =
    space.kind === 'github'
      ? `Coding space: GitHub repo ${space.repoName ?? space.slug} (default branch ${space.branch})${space.repoUrl ? ` — ${space.repoUrl}` : ''}. ` +
        `Commit real files with github_write_file (one-line JSON: {"path","message","content","branch"?}). ` +
        `Do not invent fake files only in chat. Stay on ${space.branch} unless you create a feature branch from main and open a pull request into main.`
      : space.kind === 'slack'
        ? `Delivery space: Slack ${space.channel ?? '#general'}. Write the answer so it can be pasted as Slack updates.`
        : 'Delivery space: this OpenMind thread only.'
  return `${where}\n${space.summary}\n\nUser request:\n${userPrompt}`
}
