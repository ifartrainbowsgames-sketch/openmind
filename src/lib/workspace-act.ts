import { getSession } from './auth'
import { customerConnectError, nangoLinked } from './nango'
import { SUPABASE_KEY, SUPABASE_URL, isSupabaseConfigured } from './supabase'
import { mockGithubWorkspace, repoSlug, type WorkspaceKind, type WorkspaceSpace } from './workspace'

export function defaultWorkspaceKind(): WorkspaceKind {
  if (nangoLinked('github')) return 'github'
  if (nangoLinked('slack')) return 'slack'
  return 'openmind'
}

async function nangoAct(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!isSupabaseConfigured || !SUPABASE_URL) throw new Error('Couldn’t reach Connect. Try again in a moment.')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (SUPABASE_KEY) headers.Authorization = `Bearer ${SUPABASE_KEY}`
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/nango-act`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  })
  const data = (await res.json()) as Record<string, unknown> & { error?: string }
  if (!res.ok) throw new Error(customerConnectError(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`))
  return data
}

/** Open a coding space from the first user message — GitHub repo on main, Slack post, or chat-only. */
export async function provisionWorkspace(kind: WorkspaceKind, prompt: string): Promise<WorkspaceSpace> {
  const slug = repoSlug(prompt)
  if (kind === 'openmind') {
    return { kind, slug, branch: 'main', source: 'mock', summary: 'Working in this OpenMind thread. No external project was created.' }
  }

  if (kind === 'github') {
    const linked = nangoLinked('github')
    if (!linked) {
      return mockGithubWorkspace(
        slug,
        `GitHub is not connected. Connect your GitHub in the app, then I can create \`${slug}\` on main in your account.`,
      )
    }
    try {
      const session = await getSession()
      const data = await nangoAct({
        action: 'github.createRepo',
        providerId: linked.providerId,
        connectionId: linked.connectionId,
        userId: session?.user.id,
        name: slug,
        description: prompt.slice(0, 140),
      })
      const htmlUrl = typeof data.html_url === 'string' ? data.html_url : undefined
      const fullName = typeof data.full_name === 'string' ? data.full_name : slug
      return {
        kind, slug, branch: 'main', source: 'live',
        repoName: fullName,
        repoUrl: htmlUrl ?? `https://github.com/${fullName}`,
        connectionId: linked.connectionId,
        providerId: linked.providerId,
        summary: `Created GitHub repo ${fullName} on branch main. Use github_write_file to commit there — not chat-only dumps.`,
      }
    } catch (err) {
      const msg = customerConnectError(err)
      return mockGithubWorkspace(
        slug,
        `Could not create the GitHub repo yet (${msg}). Connect your GitHub and try a new session.`,
        linked,
      )
    }
  }

  const linked = nangoLinked('slack')
  if (!linked) {
    return {
      kind, slug, branch: 'main', source: 'mock', channel: '#general',
      summary: 'Slack is not connected. Connect Slack to post this brief. Simulated post to #general.',
    }
  }
  try {
    const session = await getSession()
    await nangoAct({
      action: 'slack.post',
      providerId: linked.providerId,
      connectionId: linked.connectionId,
      userId: session?.user.id,
      channel: 'general',
      text: `OpenMind project \`${slug}\`\n${prompt.slice(0, 500)}`,
    })
    return {
      kind, slug, branch: 'main', source: 'live', channel: '#general',
      summary: `Posted the project brief to Slack #general. Updates from this crew will go there.`,
    }
  } catch (err) {
    const msg = customerConnectError(err)
    return {
      kind, slug, branch: 'main', source: 'mock', channel: '#general',
      summary: `Could not post to Slack yet (${msg}). Simulated #general post.`,
    }
  }
}
