/**
 * Git worktrees for parallel coding workers.
 *
 * Two coders in one working directory is not a race that sometimes goes wrong;
 * it is guaranteed corruption. One writes a file, the other reads it half
 * written, a third runs the test suite against a mix of both. The failure looks
 * like flaky tests rather than what it is.
 *
 * A worktree gives each worker its own directory and branch off the same
 * repository — cheap, because git shares the object store. The rule this module
 * exists to enforce: work is produced in isolation, reviewed as a diff, and
 * merged only on an explicit decision. Nothing here merges anything.
 */

import type { Runtime, Workspace } from './runtime'

export interface WorktreePlan {
  /** Directory the worker gets, under the repository root. */
  path: string
  branch: string
  workerId: string
}

/** Where worktrees live. Sibling of the checkout so `git clean` cannot eat them. */
export const WORKTREE_ROOT = '/home/user/worktrees'

/**
 * Branch and directory names for a worker.
 *
 * Sanitised because these become shell arguments and refs. A worker id with a
 * slash in it would silently create a nested ref namespace, and one with a
 * space would break the command in a way that looks like git failing.
 */
export function planWorktree(projectId: string, workerId: string): WorktreePlan {
  const safeWorker = slug(workerId)
  const safeProject = slug(projectId)
  return {
    path: `${WORKTREE_ROOT}/${safeProject}-${safeWorker}`,
    branch: `openmind/${safeProject}/${safeWorker}`,
    workerId,
  }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'worker'
}

export interface WorktreeResult {
  workspace: Workspace
  created: boolean
}

/**
 * Create (or reuse) a worktree for one worker.
 *
 * Reuse matters: a worker resuming a session must land back in the directory
 * holding its half-finished work, not a fresh one. `git worktree add` fails if
 * the path exists, which is exactly the signal to reuse.
 */
export async function ensureWorktree(
  runtime: Runtime,
  projectId: string,
  workerId: string,
): Promise<WorktreeResult> {
  const plan = planWorktree(projectId, workerId)

  const existing = await runtime.exec(`test -d ${quote(plan.path)} && echo present || true`)
  if (existing.ran && existing.stdout.includes('present')) {
    return {
      workspace: { id: `wt-${plan.workerId}`, projectId, path: plan.path, branch: plan.branch, worktree: true },
      created: false,
    }
  }

  // -B so a rerun after a wiped directory reuses the branch rather than failing
  // on "already exists", which would strand the worker with no workspace.
  const add = await runtime.git(['worktree', 'add', '-B', plan.branch, plan.path])
  if (!add.ran) {
    throw new Error(`cannot create worktree for ${workerId}: no runtime`)
  }
  if (add.exitCode !== 0) {
    throw new Error(`git worktree add failed: ${add.stderr.slice(0, 200)}`)
  }

  return {
    workspace: { id: `wt-${plan.workerId}`, projectId, path: plan.path, branch: plan.branch, worktree: true },
    created: true,
  }
}

export interface WorktreeDiff {
  branch: string
  /** Unified diff against the base. Empty when the worker changed nothing. */
  patch: string
  filesChanged: string[]
  /** True when the worker produced no change at all — usually a failed task. */
  empty: boolean
}

/**
 * The diff a worker produced, for review. Deliberately read-only: this module
 * never merges, never pushes, never deletes a branch. Applying a change is a
 * decision someone else makes with this in front of them.
 */
export async function worktreeDiff(
  runtime: Runtime,
  workspace: Workspace,
  base = 'HEAD',
): Promise<WorktreeDiff> {
  const branch = workspace.branch ?? 'HEAD'
  const names = await runtime.exec(`cd ${quote(workspace.path)} && git diff --name-only ${quote(base)}`)
  const patch = await runtime.exec(`cd ${quote(workspace.path)} && git diff ${quote(base)}`)

  const filesChanged = names.ran
    ? names.stdout.split('\n').map((l) => l.trim()).filter(Boolean)
    : []

  return {
    branch,
    patch: patch.ran ? patch.stdout : '',
    filesChanged,
    empty: filesChanged.length === 0,
  }
}

/**
 * Remove a worktree once its work is captured. Not called automatically — a
 * worktree removed before its diff was reviewed destroys the only copy.
 */
export async function removeWorktree(runtime: Runtime, workspace: Workspace): Promise<boolean> {
  if (!workspace.worktree) return false
  const result = await runtime.git(['worktree', 'remove', '--force', workspace.path])
  return result.ran && result.exitCode === 0
}

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
