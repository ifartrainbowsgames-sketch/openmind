import { describe, expect, it } from 'vitest'

/**
 * The architectural invariant: production task execution goes through AgentRuntime.
 *
 * Enforced here rather than by convention because the failure it prevents is
 * silent. `runEmployee` works perfectly well when called directly — that is
 * exactly why the runtime layer sat orphaned while eight modules were written,
 * tested, and verified against live infrastructure without ever being reachable
 * from a user action. A second execution path does not announce itself; it just
 * means half the architecture is decoration.
 *
 * Sources are read through Vite's glob rather than `node:fs`, so the test needs
 * no Node types in the app tsconfig and sees exactly what the bundler sees.
 */

const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** The only module permitted to import runEmployee. */
const RUNTIME_IMPL = '/src/lib/workforce/builtin-runtime.ts'

/**
 * Paths that still call the employee runtime directly.
 *
 * These are separate product surfaces, not the task graph: the chat turn, the
 * multi-agent crew, the Studio's single-employee run, and the offline
 * benchmark. Consolidating the task-graph path came first because that is where
 * sessions, workspaces and external agents attach.
 *
 * This list may shrink. It must never grow silently — adding to it is a visible
 * edit in review, which is the enforcement.
 */
const KNOWN_DIRECT_CALLERS = [
  '/src/lib/crew.ts',
  '/src/lib/openmind-os.ts',
  '/src/components/workforce/WorkforceStudio.tsx',
  '/src/lib/agent/evaluation.ts',
]

function importsRunEmployee(text: string): boolean {
  // Match it inside an import list, not in prose or a comment.
  const imports = text.match(/import\s*(?:type\s*)?\{[^}]*\}\s*from\s*['"][^'"]+['"]/gs) ?? []
  return imports.some((block) => /\brunEmployee\b/.test(block))
}

const productionFiles = Object.entries(sources).filter(([path]) => !/\.test\.tsx?$/.test(path))

describe('production execution goes through AgentRuntime', () => {
  it('finds source files to check', () => {
    // A glob that silently matched nothing would make every assertion below
    // pass while checking nothing at all.
    expect(productionFiles.length).toBeGreaterThan(20)
  })

  it('no new module imports runEmployee outside the builtin runtime', () => {
    const offenders = productionFiles
      .filter(([, text]) => importsRunEmployee(text))
      .map(([path]) => path)
      .filter((path) => path !== RUNTIME_IMPL)
      .filter((path) => !KNOWN_DIRECT_CALLERS.includes(path))

    expect(
      offenders,
      'runEmployee must be reached through AgentRuntime. A direct import recreates ' +
      'the second execution path this invariant exists to prevent. If a surface ' +
      'genuinely cannot use the runtime yet, add it to KNOWN_DIRECT_CALLERS with a reason.',
    ).toEqual([])
  })

  it('the builtin runtime does import it, so the check is not vacuous', () => {
    // If runEmployee were renamed or the file moved, the assertion above would
    // pass trivially. This makes that failure visible.
    const impl = sources[RUNTIME_IMPL]
    expect(impl, `${RUNTIME_IMPL} not found`).toBeDefined()
    expect(importsRunEmployee(impl)).toBe(true)
  })

  it('every allowlisted caller still exists and still calls it', () => {
    // Keeps the allowlist honest: an entry that no longer applies must be
    // deleted, not left as permanent permission.
    for (const path of KNOWN_DIRECT_CALLERS) {
      const text = sources[path]
      expect(text, `${path} is allowlisted but does not exist — remove it`).toBeDefined()
      expect(importsRunEmployee(text), `${path} no longer imports runEmployee — remove it`).toBe(true)
    }
  })

  it('the task graph does not call it at all', () => {
    // The consolidation's actual claim.
    expect(importsRunEmployee(sources['/src/lib/task-runner.ts'])).toBe(false)
  })

  it('the task graph reaches execution through the runtime contract', () => {
    const text = sources['/src/lib/task-runner.ts']
    expect(text).toMatch(/runtime\.runTask\(/)
    expect(text).toMatch(/runtime\.createSession\(/)
  })
})
