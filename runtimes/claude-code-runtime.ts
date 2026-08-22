/**
 * Claude Code as an OpenMind AgentRuntime.
 *
 * NODE ONLY — it spawns a CLI. This is the first external runtime, and it was
 * chosen as the conformance test for `AgentRuntime` rather than for its own
 * sake: it has a real resumable provider session id, which is precisely what
 * `providerSessionId` and the restart harness were built to exercise. A more
 * ambitious runtime would test too many things at once, and a failure would
 * not say whether the fault was ours or theirs.
 *
 * ## Memory ownership
 *
 * Claude Code remembers its own conversation, and that is *not* authoritative.
 *
 *   OpenMind memory              canonical project facts
 *   Claude Code session context  local continuity, private to the provider
 *
 * So every task — including a resumed one — receives the kernel's TaskContext
 * in its prompt, stated as overriding anything the session remembers. A
 * provider that resumes with a stale belief and is never corrected is how a
 * multi-runtime system ends up with two different views of the same project.
 *
 * ## What this deliberately does not do
 *
 * No fallback. If the CLI is missing, unauthenticated, or exits non-zero, the
 * task fails or blocks. Substituting the builtin runtime would produce a
 * plausible answer from a different agent entirely, which is the failure class
 * this codebase keeps removing.
 */

import type { TaskRecord } from '../src/lib/task-ledger'
import type { RunResult, ToolArtifact, ToolCall } from '../src/lib/agent'
import {
  type AgentRuntime, type AgentSession, type CreateSessionInput,
  type RuntimeAvailability, type SessionCheckpoint, type TaskContext,
  type WorkspaceState,
} from '../src/lib/workforce/agent-runtime'
import { runtimeCapabilities, type RuntimeCapabilities } from '../src/lib/workforce/capabilities'
import { event, type OpenMindEvent, type RunOutcome } from '../src/lib/workforce/events'
import { localRuntime } from './local-runtime'
import {
  closed, isResumable, newSession, touch, type WorkerSession,
} from '../src/lib/workforce/sessions'
import {
  repositories, scopeProjectId, type Repositories, type SessionScope,
} from '../src/lib/workforce/session-repository'
import {
  makeWorkspaceRecord, recoverWorkspace, toWorkspace,
  type WorkspaceRecord, type WorkspaceRecovery,
} from '../src/lib/workforce/workspaces'
import {
  NULL_SINK, createExecutionContext,
  type ExecutionContext, type PermissionContext,
} from '../src/lib/workforce/execution-context'

/**
 * What Claude Code can do, in the shared vocabulary.
 *
 * Not `ALL_CAPABILITIES`: it edits files, runs commands and uses git, but it
 * has no hosted browser and no MCP servers we configured. Claiming those would
 * make the scheduler confident and wrong.
 */
export const CLAUDE_CODE_CAPABILITIES: RuntimeCapabilities = runtimeCapabilities(
  [
    'filesystem.read', 'filesystem.write', 'terminal.exec',
    'git.read', 'git.write', 'code.write', 'testing.run',
    'web.search', 'writing.compose', 'document.create',
  ],
  {
    // The one that matters here, and the reason this runtime went first.
    resumable: true,
    // It resumes a conversation, not a machine. That is not a checkpoint: the
    // workspace can be gone while the session id still resolves.
    checkpointable: false,
    inspectable: true,
    persistentWorkspace: true,
  },
)

/**
 * What Claude Code may do unattended.
 *
 * Not "full autonomy" and not "hang waiting for a prompt" — both are wrong for
 * a background runtime. Reading, editing the workspace, inspecting git and
 * running the project's own checks are the work; installing packages,
 * committing, pushing and reaching the network are decisions a person should
 * make. Anything outside `allow` comes back as a permission denial, which this
 * runtime surfaces as `needs_user` rather than swallowing.
 *
 * Delivered as a settings FILE rather than `--allowedTools` arguments: on
 * Windows the CLI is spawned through a shell, and patterns like
 * `Bash(git status:*)` contain characters a shell rewrites. A file has no
 * quoting rules — the same reason the prompt goes on stdin.
 */
export const DEFAULT_PERMISSIONS = {
  allow: [
    'Read', 'Glob', 'Grep', 'Write', 'Edit', 'NotebookEdit', 'TodoWrite',
    'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git add:*)',
    'Bash(ls:*)', 'Bash(cat:*)', 'Bash(pwd)',
    'Bash(npm test:*)', 'Bash(npm run test:*)', 'Bash(npm run lint:*)',
    'Bash(npm run build:*)', 'Bash(npx tsc:*)',
    'Bash(pytest:*)', 'Bash(go test:*)', 'Bash(cargo test:*)',
  ],
  deny: [
    // Escaping the workspace, spending money, or publishing. A denial here is
    // reported to the user, never quietly worked around.
    'Bash(rm -rf /:*)', 'Bash(curl:*)', 'Bash(wget:*)',
    'Bash(git push:*)', 'Bash(npm publish:*)', 'Bash(docker push:*)',
  ],
  defaultMode: 'default' as const,
}

export interface ClaudeCodeDeps {
  /** Directory that holds one subdirectory per project workspace. */
  workspaceRoot: string
  /** The CLI. Overridable so a test can point at a fake. */
  command?: string
  /**
   * Overrides DEFAULT_PERMISSIONS. Widening this is a policy decision, so it
   * is a parameter rather than a default nobody notices.
   */
  permissions_policy?: { allow: string[]; deny: string[]; defaultMode?: string }
  permissions?: PermissionContext
  repositories?: Repositories
  /** Wall-clock ceiling for one task. */
  timeoutSeconds?: number
  env?: Record<string, string>
}

// ── The provider's stream ───────────────────────────────────────────────────

interface StreamInit {
  type: 'system'
  subtype: string
  session_id?: string
  cwd?: string
}

interface StreamAssistant {
  type: 'assistant'
  message?: { content?: Array<{ type: string; text?: string; name?: string; input?: unknown; id?: string }> }
}

interface StreamUser {
  type: 'user'
  message?: { content?: Array<{ type: string; tool_use_id?: string; content?: unknown; is_error?: boolean }> }
}

interface StreamResult {
  type: 'result'
  subtype?: string
  is_error?: boolean
  result?: string
  session_id?: string
  total_cost_usd?: number
  /**
   * Tools the provider wanted and was not allowed.
   *
   * Reported alongside `subtype: 'success'`, which is the trap: a task that
   * could not do its job because it needed permission looks completed. These
   * become `needs_user` — OpenMind is the policy authority, so a provider
   * asking for something is a question for the user, not a failure and
   * certainly not a success.
   */
  permission_denials?: Array<{ tool_name?: string; tool_input?: Record<string, unknown> }>
}

export interface PermissionRequest {
  tool: string
  detail: string
}

export function permissionRequests(result: StreamResult): PermissionRequest[] {
  return (result.permission_denials ?? []).map((denial) => ({
    tool: denial.tool_name ?? 'unknown',
    detail: String(
      denial.tool_input?.command
      ?? denial.tool_input?.file_path
      ?? JSON.stringify(denial.tool_input ?? {}),
    ).slice(0, 300),
  }))
}

type StreamLine = StreamInit | StreamAssistant | StreamUser | StreamResult | { type: string }

export function parseStreamLine(line: string): StreamLine | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    return JSON.parse(trimmed) as StreamLine
  } catch {
    // A truncated line is not an error worth failing a task over; the result
    // event is what decides the outcome.
    return null
  }
}

/** Flatten a tool_result payload to the text a model would have seen. */
export function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'object' && part && 'text' in part ? String((part as { text: unknown }).text) : ''))
      .filter(Boolean)
      .join('\n')
  }
  return content === undefined ? '' : JSON.stringify(content)
}

/**
 * The prompt.
 *
 * Canonical memory is stated as authoritative *explicitly*, because the whole
 * risk of a resumable provider is that it argues with its own recollection.
 */
export function buildPrompt(task: TaskRecord, context: TaskContext, resumed: boolean): string {
  const memory = context.memory.text
  return [
    resumed
      ? 'This session continues earlier work. The block below is OpenMind\'s canonical project memory. Where it disagrees with anything you remember, it wins.'
      : '',
    memory ? `${memory}\n` : '',
    `TASK ${task.id}: ${task.goal}`,
    task.outputs.length
      ? `\nWrite these files in the workspace:\n${task.outputs.map((p) => `- ${p}`).join('\n')}`
      : '',
    context.memory.priorFailures.length
      ? `\nDo not repeat these past failures:\n${context.memory.priorFailures.map((f) => `- ${f.text}`).join('\n')}`
      : '',
    '\nWork in the current directory. When you are done, state briefly what you changed.',
  ].filter(Boolean).join('\n')
}

// ── The runtime ─────────────────────────────────────────────────────────────

export function createClaudeCodeRuntime(deps: ClaudeCodeDeps): AgentRuntime {
  const repos = deps.repositories ?? repositories()
  const permissions: PermissionContext = deps.permissions ?? { platformKeys: false }
  const command = deps.command ?? 'claude'
  const cancelled = new Set<string>()
  const running = new Map<string, { kill: () => void }>()

  const pathFor = (projectId: string) =>
    `${deps.workspaceRoot.replace(/[\\/]+$/, '')}/${projectId.replace(/[^\w.-]+/g, '-')}`

  function contextFor(session: WorkerSession, record: WorkspaceRecord): ExecutionContext {
    return createExecutionContext({
      session,
      runtime: () => localRuntime({ root: record.path, env: deps.env }),
      workspace: toWorkspace(record),
      capabilities: CLAUDE_CODE_CAPABILITIES,
      permissions,
      eventSink: NULL_SINK,
    })
  }

  return {
    id: 'claude-code',

    async capabilities() {
      return CLAUDE_CODE_CAPABILITIES
    },

    async available(): Promise<RuntimeAvailability> {
      // Ask the CLI, rather than assuming a PATH entry means a working install.
      // The failure this catches is a worker deployed without Claude Code, where
      // every selected run would otherwise die mid-task with a spawn error.
      const { spawn } = await import('node:child_process')
      return new Promise<RuntimeAvailability>((resolve) => {
        const probe = spawn(command, ['--version'], {
          env: { ...process.env, ...deps.env },
          shell: process.platform === 'win32',
        })
        let out = ''
        probe.stdout?.on('data', (d: Buffer) => { out += d.toString() })
        probe.on('error', (error: Error) => resolve({
          ok: false,
          reason: `Claude Code is not installed on this worker (${error.message})`,
        }))
        probe.on('close', (code: number | null) => resolve(
          code === 0
            ? { ok: true, reason: out.trim().slice(0, 80) }
            : { ok: false, reason: `\`${command} --version\` exited with ${code}` },
        ))
      })
    },

    async createSession(input: CreateSessionInput): Promise<AgentSession> {
      const scope: SessionScope = { kind: 'project', projectId: input.projectId, worker: input.worker }
      const existing = await repos.sessions.find(scope, 'claude-code')
      const resumed = Boolean(existing && isResumable(existing))
      let session = resumed && existing
        ? touch(existing, { status: 'running' })
        : newSession(scope, 'claude-code')

      let record = session.workspaceId ? await repos.workspaces.get(session.workspaceId) : null
      record ??= makeWorkspaceRecord({
        projectId: scopeProjectId(scope),
        kind: 'shared',
        runtime: 'local',
        path: pathFor(input.projectId),
      })

      // A local directory is its own external id: if the path is gone, the
      // workspace is gone, and the provider session id resolving is no comfort
      // because the files it edited do not exist.
      record = { ...record, runtime: 'local', externalId: record.path }
      const { mkdir } = await import('node:fs/promises')
      await mkdir(record.path, { recursive: true })

      const recovery: WorkspaceRecovery = await recoverWorkspace({
        record,
        context: contextFor(session, record),
      })
      record = recovery.record
      await repos.workspaces.save(record)
      session = touch(session, { workspaceId: record.id })
      await repos.sessions.save(session)

      return { ...session, workspace: toWorkspace(record), recovery }
    },

    async resumeSession(sessionId: string): Promise<AgentSession | null> {
      const session = await repos.sessions.get(sessionId)
      if (!session) return null
      const record = session.workspaceId ? await repos.workspaces.get(session.workspaceId) : null
      return { ...session, workspace: record ? toWorkspace(record) : undefined }
    },

    async *runTask(
      session: AgentSession,
      task: TaskRecord,
      taskContext: TaskContext,
    ): AsyncIterable<OpenMindEvent> {
      const ctx = { sessionId: session.id, taskId: task.id, worker: task.worker }

      // The store is the truth; the argument is a snapshot from createSession.
      const stored = (await repos.sessions.get(session.id)) ?? session
      let current: WorkerSession = touch(stored, { status: 'running', taskId: task.id })
      await repos.sessions.save(current)

      if (cancelled.has(session.id)) {
        yield event('task_finished', 'cancelled before start', { ...ctx, outcome: 'cancelled' })
        return
      }

      const record = current.workspaceId ? await repos.workspaces.get(current.workspaceId) : null
      if (!record) {
        yield event('task_finished', 'no workspace for this session', { ...ctx, outcome: 'failed' })
        return
      }

      yield event('task_started', task.goal, ctx)

      const resume = current.providerSessionId
      // The policy goes in a file for the same reason the prompt goes on stdin.
      const settingsPath = `${record.path}/.openmind-claude-settings.json`
      const { writeFile } = await import('node:fs/promises')
      await writeFile(
        settingsPath,
        JSON.stringify({ permissions: deps.permissions_policy ?? DEFAULT_PERMISSIONS }, null, 2),
        'utf8',
      )

      const args = [
        '-p',
        '--output-format', 'stream-json',
        '--verbose',
        '--settings', settingsPath,
      ]
      if (resume) args.push('--resume', resume)

      // The prompt goes on stdin, not in argv.
      //
      // Found by the conformance harness: on Windows the CLI must be spawned
      // through a shell (there is no bare `claude` executable, only `claude.cmd`),
      // and a shell destroys a multi-line argument. The prompt contains the
      // memory block, so it is always multi-line — passing it as an argv
      // element silently truncated it to the first line and the provider
      // answered a question nobody asked. stdin has no quoting rules.

      const pending: OpenMindEvent[] = []
      let wake: (() => void) | undefined
      const push = (e: OpenMindEvent) => { pending.push(e); wake?.() }

      const toolCalls: ToolCall[] = []
      const openTools = new Map<string, { tool: string; input: string }>()
      let answer = ''
      let providerSession: string | undefined
      let failure: string | undefined
      let sawResult = false
      let denials: PermissionRequest[] = []
      let done = false

      const { spawn } = await import('node:child_process')
      const child = spawn(command, args, {
        cwd: record.path,
        env: { ...process.env, ...deps.env },
        shell: process.platform === 'win32',
      })
      running.set(session.id, { kill: () => child.kill('SIGTERM') })

      child.stdin?.write(buildPrompt(task, taskContext, Boolean(resume)))
      child.stdin?.end()

      const timeout = setTimeout(
        () => { failure ??= 'the provider exceeded its time limit'; child.kill('SIGKILL') },
        (deps.timeoutSeconds ?? 600) * 1000,
      )

      let buffer = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const parsed = parseStreamLine(line)
          if (!parsed) continue

          if (parsed.type === 'system' && (parsed as StreamInit).subtype === 'init') {
            const init = parsed as StreamInit
            if (init.session_id) {
              providerSession = init.session_id
              push(event('session_opened', `claude-code session ${init.session_id}`, ctx))
            }
            continue
          }

          if (parsed.type === 'assistant') {
            for (const part of (parsed as StreamAssistant).message?.content ?? []) {
              if (part.type === 'text' && part.text) {
                answer = part.text
                push(event('agent_thinking', part.text.slice(0, 400), ctx))
              }
              if (part.type === 'tool_use' && part.name) {
                const input = typeof part.input === 'string' ? part.input : JSON.stringify(part.input ?? {})
                if (part.id) openTools.set(part.id, { tool: part.name, input })
                push(event('tool_started', part.name, { ...ctx, tool: part.name }))
              }
            }
            continue
          }

          if (parsed.type === 'user') {
            for (const part of (parsed as StreamUser).message?.content ?? []) {
              if (part.type !== 'tool_result' || !part.tool_use_id) continue
              const opened = openTools.get(part.tool_use_id)
              const text = toolResultText(part.content)
              openTools.delete(part.tool_use_id)
              toolCalls.push({
                tool: opened?.tool ?? 'unknown',
                input: opened?.input ?? '',
                output: text,
                source: 'live',
                error: part.is_error ? { kind: 'error', message: text.slice(0, 300) } : undefined,
              })
              push(event(
                part.is_error ? 'blocked' : 'tool_completed',
                text.slice(0, 200),
                { ...ctx, tool: opened?.tool },
              ))
            }
            continue
          }

          if (parsed.type === 'result') {
            sawResult = true
            const result = parsed as StreamResult
            if (result.session_id) providerSession = result.session_id
            if (typeof result.result === 'string' && result.result) answer = result.result
            if (result.is_error) failure = result.result || result.subtype || 'the provider reported an error'
            denials = permissionRequests(result)
            for (const request of denials) {
              push(event('blocked', `${request.tool} needs approval: ${request.detail}`, {
                ...ctx, tool: request.tool,
              }))
            }
          }
        }
      })

      let stderr = ''
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

      const exited = new Promise<number>((resolve) => {
        child.on('error', (error: Error) => {
          // The CLI is missing or could not start. No fallback: a plausible
          // answer from a different agent is worse than no answer.
          failure ??= `could not start ${command}: ${error.message}`
          resolve(-1)
        })
        child.on('close', (code: number | null) => resolve(code ?? -1))
      })

      const finished = exited.then((code) => {
        clearTimeout(timeout)
        if (code !== 0 && !failure) {
          failure = stderr.trim().slice(0, 400) || `the provider exited with code ${code}`
        }
        done = true
        wake?.()
        return code
      })

      while (!done || pending.length) {
        if (!pending.length) {
          await new Promise<void>((resolve) => { wake = resolve })
          wake = undefined
          continue
        }
        yield pending.shift() as OpenMindEvent
      }
      await finished
      running.delete(session.id)

      // Persist the provider's own session id. This is the thing that makes
      // the next task a continuation rather than a cold start, and it is the
      // single most important field this runtime contributes.
      if (providerSession && providerSession !== current.providerSessionId) {
        current = touch(current, { providerSessionId: providerSession })
        await repos.sessions.save(current)
      }

      if (cancelled.has(session.id)) {
        current = touch(current, { status: 'blocked' })
        await repos.sessions.save(current)
        yield event('task_finished', 'cancelled', { ...ctx, outcome: 'cancelled' })
        return
      }

      // A provider that exits 0 having emitted no terminal result did not
      // succeed — it did nothing. Reporting that as completed is how a
      // mis-spawned CLI passes for a finished task, which is exactly what
      // happened the first time this harness ran.
      if (!failure && !sawResult) {
        failure = stderr.trim().slice(0, 400)
          || 'the provider exited without producing a result'
      }

      if (failure) {
        current = touch(current, { status: 'failed' })
        await repos.sessions.save(current)
        yield event('task_finished', failure, { ...ctx, outcome: 'failed' })
        return
      }

      // A provider that asked for permission and was refused did not fail and
      // did not finish. The decision is the user's, and OpenMind is where it
      // gets made — letting the provider invent its own approval flow is how a
      // second policy authority appears inside the first.
      if (denials.length) {
        current = touch(current, { status: 'waiting' })
        await repos.sessions.save(current)
        const summary = denials.map((d) => `${d.tool}: ${d.detail}`).join('; ')
        yield event('task_finished', `approval required — ${summary}`, {
          ...ctx,
          outcome: 'needs_user',
          result: {
            answer,
            plan: [],
            toolCalls,
            trace: [{ node: 'act' as const, text: `claude-code — awaiting approval for ${denials.length} action(s)` }],
          },
        })
        return
      }

      // Files it actually changed, read back from the workspace rather than
      // taken from its description of them. The ledger records provenance, and
      // "the provider said it wrote this" is not the same as "this is on disk".
      const artifacts = await changedFiles(contextFor(current, record), task)
      if (artifacts.length) {
        toolCalls.push({
          tool: 'claude-code:workspace',
          input: 'read back the files this task changed',
          output: artifacts.map((a) => a.path).join('\n'),
          artifacts,
          source: 'live',
        })
        for (const artifact of artifacts) {
          yield event('artifact_created', artifact.path, { ...ctx, artifactPath: artifact.path })
        }
      }

      await repos.workspaces.save({ ...record, status: 'active', lastVerifiedAt: Date.now() })
      current = touch(current, { status: 'idle' })
      await repos.sessions.save(current)

      const result: RunResult = {
        answer,
        plan: [],
        toolCalls,
        trace: [{ node: 'act', text: `claude-code — ${toolCalls.length} tool call(s)` }],
      }
      const outcome: RunOutcome = 'completed'
      yield event('task_finished', 'task complete', { ...ctx, outcome, result })
    },

    async checkpoint(sessionId: string): Promise<SessionCheckpoint> {
      // Honest negative. Claude Code resumes a *conversation*; it cannot
      // restore a workspace. Reporting captured:true would let a caller build
      // recovery on something that recovers nothing.
      return { sessionId, at: Date.now(), state: null, captured: false }
    },

    async inspectWorkspace(sessionId: string): Promise<WorkspaceState> {
      const session = await repos.sessions.get(sessionId)
      const record = session?.workspaceId ? await repos.workspaces.get(session.workspaceId) : null
      if (!session || !record) return { changedFiles: [], inspected: false }
      const workspace = toWorkspace(record)
      const status = await contextFor(session, record).runtime.exec(
        'git status --porcelain 2>/dev/null || true',
      )
      if (!status.ran) return { workspace, changedFiles: [], inspected: false }
      return { workspace, changedFiles: parseStatus(status.stdout), inspected: true }
    },

    async cancel(sessionId: string): Promise<void> {
      cancelled.add(sessionId)
      running.get(sessionId)?.kill()
      const session = await repos.sessions.get(sessionId)
      if (session) await repos.sessions.save(touch(session, { status: 'blocked' }))
    },

    async close(sessionId: string): Promise<void> {
      cancelled.delete(sessionId)
      running.get(sessionId)?.kill()
      running.delete(sessionId)
      const session = await repos.sessions.get(sessionId)
      if (session) await repos.sessions.save(closed(session))
    },
  }
}

export function parseStatus(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\S+\s+/, ''))
}

/** Cap on how much of the workspace comes back as artifacts. */
const MAX_ARTIFACTS = 12
const MAX_ARTIFACT_BYTES = 64_000

async function changedFiles(context: ExecutionContext, task: TaskRecord): Promise<ToolArtifact[]> {
  const out: ToolArtifact[] = []
  const seen = new Set<string>()

  // The declared outputs first: those are the contract, and a task is judged
  // on them whether or not git happens to be initialised here.
  const candidates = [...task.outputs]
  const status = await context.runtime.exec('git status --porcelain 2>/dev/null || true')
  if (status.ran && status.exitCode === 0) candidates.push(...parseStatus(status.stdout))

  for (const path of candidates) {
    if (seen.has(path) || out.length >= MAX_ARTIFACTS) continue
    seen.add(path)
    try {
      const body = await context.runtime.readFile(path)
      if (body.trim()) out.push({ path, body: body.slice(0, MAX_ARTIFACT_BYTES) })
    } catch {
      // Named but not written. Its absence is the judge's business, not a
      // reason to invent an empty artifact.
    }
  }
  return out
}
