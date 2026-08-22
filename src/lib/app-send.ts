/**
 * Pure routing for /app send — testable, no silent simulator fallback.
 */

import type { AppExecutionMode, AppRuntimeId } from './app-execution'
import { CLOUD_PROVIDER_SETTINGS_PATH } from './app-execution'
import type { RunOptions } from './run-queue'
import type { SkillId } from './skills'
import type { WorkspaceSpace } from './workspace'

export interface SendRouteInput {
  executionMode: AppExecutionMode
  signedIn: boolean
  demoSession: boolean
  cloudReady: boolean
  cloudBlockReason?: string
  browserKeyReady: boolean
}

export type SendRoute =
  | { kind: 'cloud_enqueue'; options: Pick<RunOptions, 'strictMode' | 'runtimeId'> }
  | { kind: 'browser_runTurn'; strictMode: boolean }
  | { kind: 'demo_runTurn' }
  | { kind: 'blocked'; message: string; settingsPath: string }

export function resolveSendRoute(input: SendRouteInput): SendRoute {
  const { executionMode } = input

  if (executionMode === 'demo') {
    return { kind: 'demo_runTurn' }
  }

  if (executionMode === 'browser_direct') {
    if (!input.browserKeyReady) {
      return {
        kind: 'blocked',
        message: 'Browser Direct needs a model key in Settings. Cloud mode uses your server-stored key instead.',
        settingsPath: '/settings/keys',
      }
    }
    return { kind: 'browser_runTurn', strictMode: true }
  }

  // Cloud — default for signed-in customers
  if (!input.signedIn || input.demoSession) {
    return {
      kind: 'blocked',
      message: input.cloudBlockReason ?? 'Sign in to use OpenMind Cloud.',
      settingsPath: '/login?next=/app',
    }
  }
  if (!input.cloudReady) {
    return {
      kind: 'blocked',
      message: input.cloudBlockReason ?? 'No AI provider is connected for Cloud mode.',
      settingsPath: CLOUD_PROVIDER_SETTINGS_PATH,
    }
  }
  return {
    kind: 'cloud_enqueue',
    options: { strictMode: true },
  }
}

export function buildCloudRunOptions(input: {
  workspace: WorkspaceSpace
  skill: SkillId
  runtimeId: AppRuntimeId
  route: Extract<SendRoute, { kind: 'cloud_enqueue' }>
}): RunOptions {
  return {
    workspace: input.workspace,
    skill: input.skill,
    strictMode: true,
    runtimeId: input.runtimeId === 'builtin' ? undefined : input.runtimeId,
  }
}

/** Run bubble copy — preserve distinct terminal states. */
export function describeRunStatus(run: {
  status: string
  answer?: string
  error?: string
  snapshot?: { tasks: { status: string }[] }
}): string {
  switch (run.status) {
    case 'queued':
      return 'Queued — a worker will pick this up. You can close the tab.'
    case 'running':
      return run.snapshot
        ? `Running — ${run.snapshot.tasks.filter((t) => t.status === 'completed').length}/${run.snapshot.tasks.length} tasks done.`
        : 'Running on the worker…'
    case 'needs_user':
      return run.error ?? 'Approval required — something needs your input before this can continue.'
    case 'failed':
      return run.error ? `Failed — ${run.error}` : 'Failed — no reason reported.'
    case 'blocked':
      return run.error ?? 'Blocked — a required capability is unavailable.'
    case 'cancelled':
      return 'Cancelled.'
    case 'completed':
      return run.answer ?? 'Done.'
    default:
      return run.answer ?? 'Working…'
  }
}
