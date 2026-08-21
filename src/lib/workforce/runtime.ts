/**
 * The execution surface, behind one interface.
 *
 * Workers already reach a real machine — the six workspace tools run against
 * an E2B sandbox, and I verified all of them live. But they reach it as *tool
 * calls*: string in, string out, parsed from prose. That is fine for a model
 * and useless for code, so orchestration cannot read a file, check a path
 * exists, or branch on an exit code without going through a language model.
 *
 * `Runtime` is the same capability with a typed edge. The orchestrator can
 * call it directly; the tool layer keeps working unchanged on top. Adding
 * Docker, Fly or a local runtime later means implementing this interface, not
 * touching anything above it.
 */

export interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
  /** False when the command never ran — no sandbox, no key, upstream refused. */
  ran: boolean
}

export interface ExecOptions {
  cwd?: string
  timeoutSeconds?: number
}

export interface GitResult extends ExecResult {
  /** Populated for commands whose output is a single useful line. */
  summary?: string
}

export interface Workspace {
  id: string
  projectId: string
  path: string
  branch?: string
  /** True when this is a git worktree rather than the primary checkout. */
  worktree?: boolean
  /**
   * The machine this workspace lives on.
   *
   * This is the identity that makes "one session, one workspace" true. The
   * agent's own tools resolve their sandbox from the same value, so a coder
   * cannot be editing one machine while inspectWorkspace() reads another —
   * which would look entirely live and be entirely wrong.
   */
  sandboxId?: string
}

export interface Runtime {
  readonly id: string
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  list(path?: string): Promise<string[]>
  exec(command: string, options?: ExecOptions): Promise<ExecResult>
  git(args: string[]): Promise<GitResult>
  createWorkspace(projectId: string): Promise<Workspace>
}

/** Raised when a runtime operation could not run at all. */
export class RuntimeUnavailableError extends Error {
  // Declared rather than a constructor parameter property: the app builds with
  // `erasableSyntaxOnly`, which rejects the shorthand.
  readonly capability: string

  constructor(capability: string, message: string) {
    super(message)
    this.name = 'RuntimeUnavailableError'
    this.capability = capability
  }
}

/**
 * Did the tool layer hand back a real result or a simulated one?
 *
 * The tool protocol marks mock output with a `[MOCK` prefix and failed-live
 * with `[LIVE FAILED`. A Runtime must never quietly pass those upward as
 * success — a caller branching on `exitCode` would treat fabricated output as
 * a passing command.
 */
export function isSimulated(output: string): boolean {
  return output.startsWith('[MOCK') || output.includes('[LIVE FAILED')
}

/** Pull `exit=N` out of the `[LIVE · tool] exit=N` envelope the tools emit. */
export function parseExitCode(output: string): number | undefined {
  const m = /^\[LIVE[^\]]*\]\s*exit=(-?\d+)/m.exec(output)
  return m ? Number(m[1]) : undefined
}

/** Strip the `[LIVE · tool] exit=N` first line, leaving the command's own output. */
export function stripEnvelope(output: string): string {
  return output.replace(/^\[LIVE[^\]]*\]\s*exit=-?\d+\n?/m, '')
}

/**
 * Turn a tool response into a typed result.
 *
 * `ran: false` is the important case. A simulated response has an exit code of
 * nothing — reporting 0 would say "the command succeeded", which is exactly
 * the fake-success this codebase keeps eliminating.
 */
export function toExecResult(output: string): ExecResult {
  if (isSimulated(output)) {
    return { exitCode: -1, stdout: '', stderr: output, ran: false }
  }
  const exitCode = parseExitCode(output)
  const body = stripEnvelope(output)
  if (exitCode === undefined) {
    // No envelope at all — treat the whole thing as stdout of an unknown run.
    return { exitCode: 0, stdout: body, stderr: '', ran: true }
  }
  return {
    exitCode,
    stdout: exitCode === 0 ? body : '',
    stderr: exitCode === 0 ? '' : body,
    ran: true,
  }
}

/** Where every workspace tool roots itself. Mirrors WORKDIR in agent-tools. */
export const WORKSPACE_ROOT = '/home/user/project'

export function makeWorkspace(projectId: string, branch?: string): Workspace {
  return {
    id: `ws-${projectId}`,
    projectId,
    path: WORKSPACE_ROOT,
    branch,
    worktree: false,
  }
}
