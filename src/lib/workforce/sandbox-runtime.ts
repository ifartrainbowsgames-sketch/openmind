/**
 * The E2B-backed Runtime.
 *
 * Deliberately a thin adapter over `invokeCrewTool` rather than a second
 * client: the tool path is the one that has been exercised against the real
 * API, and a parallel implementation would be a second thing to keep correct.
 * Everything here is translation — typed call in, tool call out, typed result
 * back — plus the one thing the tool layer cannot do, which is refuse to
 * report simulated output as success.
 */

import { invokeCrewTool } from '../crew-tools'
import type { ExecutionContext } from './execution-context'
import {
  RuntimeUnavailableError, WORKSPACE_ROOT, makeWorkspace, toExecResult,
  type ExecOptions, type ExecResult, type GitResult, type Runtime, type Workspace,
} from './runtime'

async function callTool(tool: string, input: unknown, context?: ExecutionContext): Promise<string> {
  return invokeCrewTool(
    tool as Parameters<typeof invokeCrewTool>[0],
    typeof input === 'string' ? input : JSON.stringify(input),
    undefined,
    context,
  )
}

/**
 * Bound to a context when one exists, so the typed edge and the agent's own
 * tools resolve the same machine by construction rather than by both happening
 * to read the same global.
 */
export function sandboxRuntime(context?: ExecutionContext): Runtime {
  const call = (tool: string, input: unknown) => callTool(tool, input, context)
  return {
    id: 'e2b',

    async readFile(path: string): Promise<string> {
      const result = toExecResult(await call('workspace_read_file', { path }))
      if (!result.ran) {
        throw new RuntimeUnavailableError('filesystem', `cannot read ${path}: no sandbox`)
      }
      if (result.exitCode !== 0) throw new Error(`read ${path} failed: ${result.stderr.slice(0, 200)}`)
      return result.stdout
    },

    async writeFile(path: string, content: string): Promise<void> {
      const result = toExecResult(await call('workspace_write_file', { path, content }))
      if (!result.ran) {
        throw new RuntimeUnavailableError('filesystem', `cannot write ${path}: no sandbox`)
      }
      if (result.exitCode !== 0) throw new Error(`write ${path} failed: ${result.stderr.slice(0, 200)}`)
    },

    async list(path = '.'): Promise<string[]> {
      const result = toExecResult(await call('workspace_ls', { path }))
      if (!result.ran) throw new RuntimeUnavailableError('filesystem', 'cannot list: no sandbox')
      return result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        // Drop `ls -l`'s size header BEFORE taking the last field. Filtering
        // afterwards checked the *name*, and the name of "total 5" is "5" — so
        // every listing carried a phantom numeric file.
        .filter((line) => !/^total\s+\d+$/.test(line))
        // The name is the last field, and . / .. are noise.
        .map((line) => line.split(/\s+/).pop() ?? '')
        .filter((name) => name && name !== '.' && name !== '..')
    },

    async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
      const cwd = options.cwd && options.cwd !== WORKSPACE_ROOT ? `cd ${options.cwd} && ` : ''
      return toExecResult(await call('workspace_run', { command: `${cwd}${command}` }))
    },

    async git(args: string[]): Promise<GitResult> {
      // Clone has its own tool because it also creates the workspace.
      if (args[0] === 'clone' && args[1]) {
        const out = toExecResult(await call('git_clone', { repo: args[1], branch: args[2] }))
        return { ...out, summary: out.stdout.split('\n').filter(Boolean).pop() }
      }
      const out = await this.exec(`git ${args.map(shellQuote).join(' ')}`)
      return { ...out, summary: out.stdout.split('\n').filter(Boolean).pop() }
    },

    async createWorkspace(projectId: string): Promise<Workspace> {
      // The sandbox is created lazily by the first tool call; this only names
      // it. Provisioning eagerly would burn a sandbox for runs that never
      // touch the filesystem.
      return makeWorkspace(projectId)
    },
  }
}

function shellQuote(value: string): string {
  return /^[\w.\-/=]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}
