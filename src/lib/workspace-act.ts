import { getSession } from './auth'
import { nangoLinked } from './nango'
import { SUPABASE_KEY, SUPABASE_URL, isSupabaseConfigured } from './supabase'
import { repoSlug, type WorkspaceKind, type WorkspaceSpace } from './workspace'

export function defaultWorkspaceKind(): WorkspaceKind {
  if (nangoLinked('github')) return 'github'
  if (nangoLinked('slack')) return 'slack'
  return 'openmind'
}

async function nangoAct(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!isSupabaseConfigured || !SUPABASE_URL) throw new Error('nango-act is not deployed')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (SUPABASE_KEY) headers.Authorization = `Bearer ${SUPABASE_KEY}`
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/nango-act`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  })
  const data = (await res.json()) as Record<string, unknown> & { error?: string }
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`)
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
      return {
        kind, slug, branch: 'main', source: 'mock',
        repoName: slug,
        repoUrl: `https://github.com/openmind/${slug}`,
        summary: `GitHub is not connected. Connect GitHub in the marketplace, then I can create \`${slug}\` on branch main. For now this is a simulated repo URL.`,
      }
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
      const msg = err instanceof Error ? err.message : String(err)
      return {
        kind, slug, branch: 'main', source: 'mock',
        repoName: slug,
        repoUrl: `https://github.com/openmind/${slug}`,
        summary: `Could not create the GitHub repo yet (${msg}). Simulated space \`${slug}\` on main — connect GitHub in Nango and retry.`,
      }
    }
  }

  const linked = nangoLinked('slack')
  if (!linked) {
    return {
      kind, slug, branch: 'main', source: 'mock', channel: '#general',
      summary: 'Slack is not connected. Connect Slack in the marketplace to post this brief. Simulated post to #general.',
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
    const msg = err instanceof Error ? err.message : String(err)
    return {
      kind, slug, branch: 'main', source: 'mock', channel: '#general',
      summary: `Could not post to Slack yet (${msg}). Simulated #general post.`,
    }
  }
}
