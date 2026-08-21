/**
 * A Runtime backed by the local filesystem.
 *
 * NODE ONLY. Nothing in the browser bundle may import this — the node builtins
 * are loaded dynamically so a stray import fails at call time rather than
 * breaking the build silently, and `runtime-boundary.test.ts` checks that no
 * app code reaches for it.
 *
 * It exists because the first external runtime does not run in E2B. Claude
 * Code edits a directory on the machine it is running on, so a
 * `WorkspaceRecord` with `runtime: 'local'` needs a typed edge that speaks to
 * that directory. That the same `Runtime` interface covers both is the claim
 * the workspace/session split was making; this is what tests it.
 *
 * Every path is confined to the workspace root. A runtime that will happily
 * read `/etc/passwd` because an agent asked nicely is not a sandbox, and the
 * whole point of a workspace is that it bounds what a task can touch.
 */

import {
  RuntimeUnavailableError,
  type ExecResult, type ExecOptions, type GitResult, type Runtime, type Workspace,
} from '../src/lib/workforce/runtime'

const DEFAULT_TIMEOUT_SECONDS = 120

async function node() {
  const [fs, path, child] = await Promise.all([
    import('node:fs/promises'),
    import('node:path'),
    import('node:child_process'),
  ])
  return { fs, path, child }
}

/**
 * Resolve a path inside the root, or refuse.
 *
 * `..` traversal and absolute paths are the two ways out of a directory, and
 * both are rejected rather than normalised — silently clamping a path that
 * pointed outside would mean writing somewhere the caller did not name.
 */
export function confine(root: string, target: string, sep = '/'): string {
  const cleaned = target.replace(/\\/g, '/').trim()
  if (!cleaned || cleaned === '.') return root
  if (/^([a-zA-Z]:)?\//.test(cleaned)) {
    throw new RuntimeUnavailableError('filesystem', `absolute paths are outside the workspace: ${target}`)
  }
  const parts: string[] = []
  for (const segment of cleaned.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (!parts.length) {
        throw new RuntimeUnavailableError('filesystem', `path escapes the workspace: ${target}`)
      }
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  return parts.length ? `${root}${sep}${parts.join(sep)}` : root
}

export interface LocalRuntimeOptions {
  /** Every path resolves inside this directory. */
  root: string
  /** Aborted when the run is cancelled, so a long build stops with it. */
  signal?: AbortSignal
  env?: Record<string, string>
}

export function localRuntime(options: LocalRuntimeOptions): Runtime {
  const { root } = options

  async function run(command: string, cwd: string, timeoutSeconds: number): Promise<ExecResult> {
    const { child } = await node()
    return new Promise<ExecResult>((resolve) => {
      const proc = child.spawn(command, {
        cwd,
        shell: true,
        signal: options.signal,
        env: { ...process.env, ...options.env },
      })
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutSeconds * 1000)
      proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
      proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
      proc.on('error', (error: Error) => {
        clearTimeout(timer)
        // `ran: false` — the command never executed. Reporting exit 0 here is
        // how a failure to launch becomes a passing build.
        resolve({ exitCode: -1, stdout: '', stderr: error.message, ran: false })
      })
      proc.on('close', (code: number | null) => {
        clearTimeout(timer)
        resolve({ exitCode: code ?? -1, stdout, stderr, ran: true })
      })
    })
  }

  return {
    id: 'local',

    async readFile(target: string): Promise<string> {
      const { fs } = await node()
      try {
        return await fs.readFile(confine(root, target), 'utf8')
      } catch (error) {
        if (error instanceof RuntimeUnavailableError) throw error
        throw new Error(`read ${target} failed: ${(error as Error).message}`)
      }
    },

    async writeFile(target: string, content: string): Promise<void> {
      const { fs, path } = await node()
      const full = confine(root, target)
      await fs.mkdir(path.dirname(full), { recursive: true })
      await fs.writeFile(full, content, 'utf8')
    },

    async list(target = '.'): Promise<string[]> {
      const { fs } = await node()
      try {
        return await fs.readdir(confine(root, target))
      } catch (error) {
        if (error instanceof RuntimeUnavailableError) throw error
        throw new RuntimeUnavailableError('filesystem', `cannot list ${target}`)
      }
    },

    async exec(command: string, execOptions: ExecOptions = {}): Promise<ExecResult> {
      const cwd = execOptions.cwd ? confine(root, execOptions.cwd) : root
      return run(command, cwd, execOptions.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS)
    },

    async git(args: string[]): Promise<GitResult> {
      const out = await run(`git ${args.map(quote).join(' ')}`, root, DEFAULT_TIMEOUT_SECONDS)
      return { ...out, summary: out.stdout.split('\n').filter(Boolean).pop() }
    },

    async createWorkspace(projectId: string): Promise<Workspace> {
      const { fs } = await node()
      await fs.mkdir(root, { recursive: true })
      return { id: `ws-local-${projectId}`, projectId, path: root, worktree: false }
    },
  }
}

function quote(value: string): string {
  return /^[\w.\-/=]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}
