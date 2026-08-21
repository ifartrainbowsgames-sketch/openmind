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

/**
 * The second boundary: where a tool executes is an argument, not a global.
 *
 * `setActiveSandbox` is the module-level binding the ExecutionContext replaced.
 * It still exists for the surfaces that have no session — the chat crew, deep
 * research — but every additional writer is a chance for the tools and the
 * session to end up on different live machines with nothing reporting it.
 */
const SANDBOX_BINDERS = [
  // Owns the value.
  '/src/lib/crew-tools.ts',
  // Binds it once per run, from the session, for the context-free tools that
  // share the transport.
  '/src/lib/workforce/builtin-runtime.ts',
  // Sessionless surfaces: no ExecutionContext exists to carry the machine.
  '/src/lib/crew.ts',
  '/src/lib/openmind-os.ts',
]

describe('the machine a tool uses comes from its context', () => {
  it('nothing new writes the module-level sandbox binding', () => {
    const offenders = productionFiles
      .filter(([, text]) => /\bsetActiveSandbox\s*\(/.test(text))
      .map(([path]) => path)
      .filter((path) => !SANDBOX_BINDERS.includes(path))

    expect(
      offenders,
      'setActiveSandbox is the pre-context binding. A new writer means the tools ' +
      'and the session can resolve different sandboxes — which looks entirely ' +
      'live and is entirely wrong. Take an ExecutionContext instead.',
    ).toEqual([])
  })

  it('the workspace tools take a context', () => {
    // If the tool registry stopped threading it, every assertion about the
    // context would still pass while the tools read module state again.
    const tools = sources['/src/lib/agent/tools.ts']
    expect(tools).toMatch(/run: \(q, _args, ctx\) => invokeCrewTool\('workspace_run', q, undefined, ctx\)/)
  })

  it('the actor passes it to every tool it calls', () => {
    expect(sources['/src/lib/agent/graph.ts']).toMatch(/tool\.run\(spec\.input, spec\.args, context\)/)
  })
})

/**
 * The third boundary: the browser has a WHO half and a WHERE half, and they
 * were in one file.
 *
 * `browser-worker.ts` held `BrowserProvider` and `BrowserAction` alongside
 * `needsVision` and `browserArtifacts` — the transport and the strategy for
 * using it. The consequence of leaving that merged is specific: Playwright
 * ends up buried inside a browser agent, and swapping the provider means
 * editing the agent.
 *
 * Neither half is on a product path yet; the live browser path is still the
 * `web_act` tool. This locks the layering so that when one is wired, the split
 * is still there.
 */
describe('the browser worker does not own the browser', () => {
  const worker = sources['/src/lib/workforce/browser-worker.ts']
  const runtime = sources['/src/lib/workforce/browser-runtime.ts']

  it('both halves exist', () => {
    expect(worker, 'browser-worker.ts not found').toBeDefined()
    expect(runtime, 'browser-runtime.ts not found').toBeDefined()
  })

  it('the machine half declares the provider and the action vocabulary', () => {
    expect(runtime).toMatch(/interface BrowserProvider\b/)
    expect(runtime).toMatch(/interface BrowserAction\b/)
    expect(worker).not.toMatch(/interface BrowserProvider\b/)
  })

  it('the strategy half declares the strategy', () => {
    expect(worker).toMatch(/function needsVision\b/)
    expect(worker).toMatch(/function browserArtifacts\b/)
    expect(runtime).not.toMatch(/function needsVision\b/)
  })

  it('neither half reaches a transport directly', () => {
    // A provider is implemented against BrowserProvider, not by either of
    // these files calling out. The day one of them imports crew-tools is the
    // day the layering is gone again.
    // Imports only. Both files name Playwright in prose, which is the point —
    // they describe a provider they must not reach for themselves.
    for (const [name, text] of [['worker', worker], ['runtime', runtime]] as const) {
      const imports = text.match(/from\s*['"][^'"]+['"]/g) ?? []
      const offenders = imports.filter((i) => /crew-tools|playwright|puppeteer|browserless/i.test(i))
      expect(offenders, `${name} reaches a transport directly`).toEqual([])
    }
  })
})
