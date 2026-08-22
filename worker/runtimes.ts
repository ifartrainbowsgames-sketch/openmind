/**
 * The server-side runtime registry.
 *
 * Initialised in the worker's boot path and nowhere else. The browser must
 * stay unaware that `claude-code` is a CLI on a machine — it sends
 * `{ runtimeId: 'claude-code' }` and the worker resolves it. Anything else
 * would put `node:child_process` on a path the bundler can reach.
 *
 * `runtimeFor()` still throws when an id is not registered, and that is the
 * point: a run that asked for Claude Code on a worker without Claude Code must
 * block, not quietly execute on the builtin runtime and answer with a
 * different agent.
 */

import { registerRuntime } from '../src/lib/workforce/agent-runtime'
import { createClaudeCodeRuntime } from '../runtimes/claude-code-runtime'
import { repositories } from '../src/lib/workforce/session-repository'

/** Where local workspaces live on the worker's disk. */
const WORKSPACE_ROOT = process.env.OPENMIND_WORKSPACE_ROOT
  ?? `${process.env.HOME ?? process.env.USERPROFILE ?? '.'}/.openmind/workspaces`

export interface RegisteredRuntime {
  id: string
  available: boolean
  detail: string
}

/**
 * Register every runtime this worker can host, and report what each one said
 * about itself.
 *
 * Availability is checked at boot and logged rather than swallowed, so a
 * worker deployed without Claude Code says so once at startup instead of
 * failing every selected run mid-task. The runtime is still registered when
 * unavailable — `available()` is re-checked per run, and reporting "not
 * installed" is more useful to a user than "unknown runtime".
 */
export async function registerWorkerRuntimes(): Promise<RegisteredRuntime[]> {
  const claudeCode = createClaudeCodeRuntime({
    workspaceRoot: WORKSPACE_ROOT,
    repositories: repositories(),
    timeoutSeconds: Number(process.env.CLAUDE_CODE_TIMEOUT_SECONDS ?? 900),
  })

  // Deliberately not the default. The builtin runtime is constructed per run by
  // task-runner because it carries the brain and the composed prompt; external
  // runtimes are singletons because they carry neither.
  registerRuntime(claudeCode)

  const status = await claudeCode.available?.() ?? { ok: true }
  return [{
    id: claudeCode.id,
    available: status.ok,
    detail: status.reason ?? '',
  }]
}
