/**
 * Execution state for the workforce map.
 *
 * `WorkforceMap` draws company → employees → tools. It is accurate and it is
 * static: it shows what a worker *could* do, never what any of them is doing.
 * Watching it during a run tells you nothing, which is the same complaint that
 * killed the ambient packet animation in the network view.
 *
 * This computes the overlay from the project ledger. Every value here is
 * derived from real task status and real artifacts — there is no decorative
 * state, and an employee with nothing to show gets nothing rather than a
 * plausible-looking idle animation.
 */

import type { ProjectSnapshot, WorkerKind } from '../task-ledger'

export type MapStatus = 'idle' | 'running' | 'completed' | 'blocked' | 'failed'

export interface EmployeeOverlay {
  status: MapStatus
  /** The task this worker is on, or last finished. */
  taskId?: string
  taskGoal?: string
  /** Artifacts this worker has produced in the project. */
  artifactCount: number
  /** Paths handed to another worker because of a dependency. */
  handedOff: string[]
  blocker?: string
}

/**
 * Which employee serves a worker kind.
 *
 * Built-in workers use the id `worker-${kind}`. Custom employees are matched on
 * role text as a fallback — loose, but the alternative is showing no state at
 * all for a custom team, and a wrong-but-visible match is correctable by the
 * user while an empty map is just uninformative.
 */
export function employeeForWorker(
  employees: readonly { id: string; role: string }[],
  worker: WorkerKind,
): string | undefined {
  const exact = employees.find((e) => e.id === `worker-${worker}`)
  if (exact) return exact.id
  const byRole = employees.find((e) => e.role.toLowerCase().includes(worker))
  return byRole?.id
}

const STATUS_MAP: Readonly<Record<string, MapStatus>> = {
  pending: 'idle',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  blocked: 'blocked',
  needs_user: 'blocked',
}

/**
 * Overlay per employee id.
 *
 * When a worker has several tasks the most urgent state wins, ordered by what
 * a person scanning the map needs to see first: something is stuck, before
 * something is moving, before something is done.
 */
const PRECEDENCE: MapStatus[] = ['blocked', 'failed', 'running', 'completed', 'idle']

export function buildOverlay(
  project: ProjectSnapshot | undefined,
  employees: readonly { id: string; role: string }[],
): Record<string, EmployeeOverlay> {
  if (!project) return {}

  const out: Record<string, EmployeeOverlay> = {}

  for (const task of project.tasks) {
    const employeeId = employeeForWorker(employees, task.worker)
    if (!employeeId) continue

    const status = STATUS_MAP[task.status] ?? 'idle'
    const existing = out[employeeId]
    const artifactCount = project.artifacts.filter((a) => a.taskId === task.id).length

    if (!existing) {
      out[employeeId] = {
        status,
        taskId: task.id,
        taskGoal: task.goal,
        artifactCount,
        handedOff: [],
        blocker: task.blocker,
      }
      continue
    }

    out[employeeId] = {
      ...existing,
      artifactCount: existing.artifactCount + artifactCount,
      blocker: existing.blocker ?? task.blocker,
      ...(PRECEDENCE.indexOf(status) < PRECEDENCE.indexOf(existing.status)
        ? { status, taskId: task.id, taskGoal: task.goal }
        : {}),
    }
  }

  // Handoffs are real: task B depends on task A and A produced a file, so
  // something genuinely moved between those workers.
  for (const handoff of project.handoffs ?? []) {
    const fromId = employeeForWorker(employees, handoff.from)
    if (!fromId || !out[fromId]) continue
    out[fromId] = {
      ...out[fromId],
      handedOff: [...out[fromId].handedOff, handoff.label],
    }
  }

  return out
}

/** Edges to draw between employees, derived only from real handoffs. */
export interface OverlayEdge {
  fromEmployeeId: string
  toEmployeeId: string
  label: string
}

export function overlayEdges(
  project: ProjectSnapshot | undefined,
  employees: readonly { id: string; role: string }[],
): OverlayEdge[] {
  if (!project?.handoffs?.length) return []
  const edges: OverlayEdge[] = []
  for (const handoff of project.handoffs) {
    const fromEmployeeId = employeeForWorker(employees, handoff.from)
    const toEmployeeId = employeeForWorker(employees, handoff.to)
    // A handoff to yourself is a dependency inside one worker's own chain —
    // real, but drawing it as an arrow says something that did not happen.
    if (!fromEmployeeId || !toEmployeeId || fromEmployeeId === toEmployeeId) continue
    edges.push({
      fromEmployeeId,
      toEmployeeId,
      label: handoff.label.split('/').pop() ?? handoff.label,
    })
  }
  return edges
}

export const STATUS_COLOR: Readonly<Record<MapStatus, string>> = {
  idle: '#a8a49c',
  running: '#ff4d00',
  completed: '#2f7d3a',
  blocked: '#b3261e',
  failed: '#b3261e',
}
