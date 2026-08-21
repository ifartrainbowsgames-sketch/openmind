/**
 * The machine, as a record that outlives the process.
 *
 * `ProjectState.sandboxId` surviving a restart solves the *pointer*. It does
 * not prove the sandbox behind that pointer still exists — E2B reclaims idle
 * machines, and a string that names a dead sandbox reads exactly like a string
 * that names a live one.
 *
 * So a workspace is a record with a status and a last-verified time, and
 * "resume" is a question that gets asked rather than assumed. The alternative
 * is the failure class this codebase keeps removing: a fresh empty sandbox
 * reported as a resumed session, where every file the previous task wrote is
 * silently gone and nothing errors.
 *
 * Separate from `WorkerSession` on purpose. A session says *who was working*;
 * a workspace says *where*. Folding E2B's semantics into every agent session
 * would make a Claude Code session on E2B, a Wayland session on a local
 * checkout and an OpenHands session on a remote workspace three different
 * shapes of the same idea.
 */

import { WORKSPACE_ROOT, type Workspace } from './runtime'
import type { ExecutionContext } from './execution-context'

export type WorkspaceKind = 'shared' | 'worktree' | 'conversation'

export type WorkspaceStatus =
  /** Verified reachable. */
  | 'active'
  /** Was reachable; not checked recently enough to promise anything. */
  | 'sleeping'
  /** Checked, and the machine is gone. */
  | 'missing'
  /** The machine answered, but not usefully. */
  | 'failed'
  /** Deliberately released. */
  | 'closed'

export interface WorkspaceRecord {
  id: string
  /** Which Runtime implementation owns the machine — 'e2b', 'local', … */
  runtime: string
  /** The provider's own id. Absent until a machine actually exists. */
  externalId?: string
  projectId: string
  kind: WorkspaceKind
  path: string
  branch?: string
  repoUrl?: string
  status: WorkspaceStatus
  createdAt: number
  /** When the machine was last proven reachable. Absent means never. */
  lastVerifiedAt?: number
}

/** A machine unverified for longer than this is `sleeping`, not `active`. */
export const VERIFY_TTL_MS = 5 * 60 * 1000

export function makeWorkspaceRecord(input: {
  projectId: string
  kind?: WorkspaceKind
  /**
   * Distinguishes several workspaces of the same kind in one project. A
   * project has ONE shared machine — a clone must survive from the coder to
   * the tester — but each isolated coder needs its own directory on it, and
   * without this they would collapse onto one record and one branch.
   */
  name?: string
  runtime?: string
  path?: string
  branch?: string
  repoUrl?: string
  externalId?: string
  now?: number
}): WorkspaceRecord {
  const now = input.now ?? Date.now()
  const kind = input.kind ?? 'shared'
  return {
    id: `ws-${kind}-${input.projectId}${input.name ? `:${input.name}` : ''}`,
    runtime: input.runtime ?? 'e2b',
    externalId: input.externalId,
    projectId: input.projectId,
    kind,
    path: input.path ?? WORKSPACE_ROOT,
    branch: input.branch,
    repoUrl: input.repoUrl,
    // Never born 'active'. A record claiming a machine nobody has spoken to is
    // the pointer problem again, one field further in.
    status: input.externalId ? 'sleeping' : 'active',
    createdAt: now,
  }
}

/** The runtime-facing view. `Workspace` is what tools resolve against. */
export function toWorkspace(record: WorkspaceRecord): Workspace {
  return {
    id: record.id,
    projectId: record.projectId,
    path: record.path,
    branch: record.branch,
    worktree: record.kind === 'worktree',
    sandboxId: record.externalId,
  }
}

/** Fold a runtime-facing workspace back into its record. */
export function withWorkspace(record: WorkspaceRecord, workspace: Workspace): WorkspaceRecord {
  return {
    ...record,
    path: workspace.path,
    branch: workspace.branch ?? record.branch,
    kind: workspace.worktree ? 'worktree' : record.kind,
    externalId: workspace.sandboxId ?? record.externalId,
  }
}

export function isFresh(record: WorkspaceRecord, now = Date.now()): boolean {
  return record.status === 'active'
    && record.lastVerifiedAt !== undefined
    && now - record.lastVerifiedAt < VERIFY_TTL_MS
}

// ── Recovery ────────────────────────────────────────────────────────────────

/** What a checkpoint restore would need. Opaque to everything but its runtime. */
export interface CheckpointRef {
  sessionId: string
  at: number
}

/**
 * The four honest answers to "can we carry on where we left off?".
 *
 * `lost` and `needs_user` exist because the tempting fifth answer — quietly
 * provision a new machine and call it the same session — is indistinguishable
 * from success right up until a task reads a file that is no longer there.
 */
export type WorkspaceRecovery =
  | { kind: 'resumed'; workspace: Workspace; record: WorkspaceRecord }
  | { kind: 'recreated'; workspace: Workspace; record: WorkspaceRecord; restoredFrom?: CheckpointRef }
  | { kind: 'lost'; reason: string; record: WorkspaceRecord }
  | { kind: 'needs_user'; reason: string; record: WorkspaceRecord }

export interface RecoverInput {
  record: WorkspaceRecord
  /**
   * Bound to the record's machine. The *context* rather than the runtime,
   * because detecting a dead sandbox needs more than the command's exit code —
   * see verifyWorkspace.
   */
  context: ExecutionContext
  /**
   * Restores a checkpoint onto a fresh machine. Absent when the runtime cannot
   * checkpoint, which is true of the builtin one today — so `recreated` is a
   * path this function will not take rather than a promise it cannot keep.
   */
  restore?: (record: WorkspaceRecord) => Promise<{ workspace: Workspace; from?: CheckpointRef } | null>
  now?: number
}

/**
 * Ask the machine whether it is still there.
 *
 * The probe is deliberately trivial and side-effect free. Anything heavier
 * risks failing for reasons that have nothing to do with the machine existing,
 * and a false 'missing' throws away a live workspace.
 */
export async function verifyWorkspace(
  record: WorkspaceRecord,
  context: ExecutionContext,
  now = Date.now(),
): Promise<WorkspaceRecord> {
  if (!record.externalId) return { ...record, status: 'active', lastVerifiedAt: now }

  const asked = context.workspace.sandboxId
  try {
    const probe = await context.runtime.exec(
      `test -d '${record.path}' && echo ok`,
      { timeoutSeconds: 20 },
    )

    // THE CHECK THAT MATTERS, and the one an exit code cannot make.
    //
    // The tool backend provisions a fresh sandbox when the id it is given no
    // longer exists, and reports success. So a probe against a reclaimed
    // machine returns exit 0 from a machine that is not the one we asked
    // about, and every file the last task wrote is gone. The substitution is
    // only visible because the context adopts whatever id actually served the
    // call — if that differs from what we asked for, the original is dead.
    const served = context.workspace.sandboxId
    if (served && asked && served !== asked) return { ...record, status: 'missing' }

    // `ran: false` means the command never executed at all.
    if (!probe.ran) return { ...record, status: 'missing' }
    // It answered, and the directory is gone: the machine lives, the work does not.
    if (probe.exitCode !== 0) return { ...record, status: 'failed', lastVerifiedAt: now }
    return { ...record, status: 'active', lastVerifiedAt: now }
  } catch {
    // The typed edge throws when it cannot reach a machine at all.
    return { ...record, status: 'missing' }
  }
}

export async function recoverWorkspace(input: RecoverInput): Promise<WorkspaceRecovery> {
  const now = input.now ?? Date.now()
  const { record } = input

  if (record.status === 'closed') {
    return { kind: 'lost', reason: 'the workspace was closed', record }
  }

  // Never provisioned. Nothing to recover — this is a first run, not a
  // resumption, and saying so is the difference between the two.
  if (!record.externalId) {
    const fresh: WorkspaceRecord = { ...record, status: 'active', lastVerifiedAt: now }
    return { kind: 'resumed', workspace: toWorkspace(fresh), record: fresh }
  }

  const verified = await verifyWorkspace(record, input.context, now)
  if (verified.status === 'active') {
    return { kind: 'resumed', workspace: toWorkspace(verified), record: verified }
  }

  const restored = input.restore ? await input.restore(verified) : null
  if (restored) {
    const record2 = withWorkspace(
      { ...verified, status: 'active', lastVerifiedAt: now },
      restored.workspace,
    )
    return { kind: 'recreated', workspace: restored.workspace, record: record2, restoredFrom: restored.from }
  }

  // The honest end of the road. A new empty sandbox would run, and would be
  // wrong: every file the last task wrote is gone, and the first thing a
  // resumed task does is assume they are there.
  const reason = verified.status === 'missing'
    ? `sandbox ${record.externalId} no longer exists and there is no checkpoint to restore`
    : `sandbox ${record.externalId} answered but ${record.path} is gone`
  return { kind: 'needs_user', reason, record: verified }
}
