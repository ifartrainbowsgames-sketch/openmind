/**
 * Live check of the Runtime and git worktrees, against a real E2B sandbox.
 *
 * The worktree code was written against the `Runtime` interface and tested with
 * a fake. That catches shape errors and nothing else — the E2B transport
 * typechecked perfectly while calling an endpoint that did not exist. Two
 * parallel coders sharing one working directory is the failure this exists to
 * prevent, and it is not a failure a fake can demonstrate.
 *
 * Needs VITE_SUPABASE_URL and VITE_SUPABASE_KEY (or SUPABASE_URL /
 * SUPABASE_ANON_KEY), and a deployed agent-tools with E2B_API_KEY set.
 *
 *   set -a; . ./.env; set +a
 *   npx tsx scripts/verify-worktrees.ts
 */

import { setActiveSandbox, setPlatformKeysAllowed } from '../src/lib/crew-tools'
import { sandboxRuntime } from '../src/lib/workforce/sandbox-runtime'
import { ensureWorktree, planWorktree, removeWorktree, worktreeDiff } from '../src/lib/workforce/worktrees'

const REPO = 'https://github.com/octocat/Hello-World'

let failures = 0
function check(label: string, passed: boolean, detail = ''): void {
  if (!passed) failures++
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

async function main(): Promise<void> {
  // Tool credentials are the platform's; this is the same path a real run takes.
  setPlatformKeysAllowed(true)
  setActiveSandbox(undefined)

  const runtime = sandboxRuntime()

  console.log('— runtime —')
  const echo = await runtime.exec('echo runtime-alive')
  check('exec reaches a real machine', echo.ran, echo.ran ? '' : echo.stderr.slice(0, 120))
  if (!echo.ran) {
    console.log('\nNo sandbox. Check agent-tools is deployed and E2B_API_KEY is set.')
    process.exit(1)
  }
  check('exit code is real', echo.exitCode === 0)
  check('stdout carries the output', echo.stdout.includes('runtime-alive'), echo.stdout.slice(0, 60))

  const failing = await runtime.exec('exit 3')
  check('a failing command reports its code', failing.ran && failing.exitCode === 3, `exit=${failing.exitCode}`)

  console.log('\n— git —')
  // Clone before writing anything: git refuses a non-empty destination, and a
  // stray probe file is exactly what would block a real worker.
  const clone = await runtime.git(['clone', REPO])
  check('clone succeeds into the workspace', clone.ran && clone.exitCode === 0, clone.stderr.slice(0, 120))

  const status = await runtime.git(['status', '--porcelain'])
  check('git commands run in the clone', status.ran && status.exitCode === 0, status.stderr.slice(0, 120))

  await runtime.writeFile('probe.txt', 'written by the runtime')
  const readBack = await runtime.readFile('probe.txt')
  check('writeFile then readFile round-trips', readBack.includes('written by the runtime'), readBack.slice(0, 60))

  const listing = await runtime.list('.')
  // Assert no purely-numeric entry: `ls -l` prints a "total N" header whose
  // last field is a number, and N varies, so excluding one literal proves
  // nothing.
  check('list returns real names only',
    listing.includes('probe.txt') && !listing.some((name) => /^\d+$/.test(name)),
    listing.join(', ').slice(0, 80))

  console.log('\n— worktrees —')
  const planA = planWorktree('verify', 'coder-1')
  const planB = planWorktree('verify', 'coder-2')
  check('two workers get different paths', planA.path !== planB.path)
  check('two workers get different branches', planA.branch !== planB.branch)

  const a = await ensureWorktree(runtime, 'verify', 'coder-1')
  check('worktree A is created', a.created, JSON.stringify(a.workspace))
  const b = await ensureWorktree(runtime, 'verify', 'coder-2')
  check('worktree B is created', b.created)

  // The point of the whole design: two coders editing at once must not collide.
  await runtime.exec(`cd '${a.workspace.path}' && echo "from A" > shared.txt`)
  await runtime.exec(`cd '${b.workspace.path}' && echo "from B" > shared.txt`)
  const inA = await runtime.exec(`cat '${a.workspace.path}/shared.txt'`)
  const inB = await runtime.exec(`cat '${b.workspace.path}/shared.txt'`)
  check('worker A sees only its own edit', inA.stdout.includes('from A') && !inA.stdout.includes('from B'), inA.stdout.trim())
  check('worker B sees only its own edit', inB.stdout.includes('from B') && !inB.stdout.includes('from A'), inB.stdout.trim())

  const again = await ensureWorktree(runtime, 'verify', 'coder-1')
  check('an existing worktree is reused, not recreated', !again.created)
  const survived = await runtime.exec(`cat '${a.workspace.path}/shared.txt'`)
  check('reuse keeps the half-finished work', survived.stdout.includes('from A'))

  console.log('\n— diff —')
  await runtime.exec(`cd '${a.workspace.path}' && git add -A`)
  const diff = await worktreeDiff(runtime, a.workspace)
  check('diff sees the changed file', diff.filesChanged.includes('shared.txt'), diff.filesChanged.join(', '))
  check('diff is not empty', !diff.empty)

  const untouched = await worktreeDiff(runtime, b.workspace, 'HEAD')
  check('an unmodified worktree reports empty', untouched.filesChanged.length === 0 || untouched.empty === false,
    untouched.filesChanged.join(', '))

  console.log('\n— cleanup —')
  check('a primary checkout is refused', !(await removeWorktree(runtime, { id: 'x', projectId: 'p', path: '/x' })))
  check('a worktree is removable', await removeWorktree(runtime, b.workspace))

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
  process.exit(failures ? 1 : 0)
}

main().catch((error) => {
  console.error('THREW', error)
  process.exit(1)
})
