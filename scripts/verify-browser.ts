/**
 * Live proof of the browser claim:
 *
 *   "A browsing plan reaches real Chrome through BrowserProvider, and what
 *    comes back is structured evidence rather than prose."
 *
 * The unit tests prove the shape against a fake provider. This proves the part
 * a fake cannot: that a real page was loaded, that the URL recorded is the URL
 * visited, and — the one that matters most — that a mock or a refusal is NOT
 * reported as a visit.
 *
 *   set -a; . ./.env; set +a
 *   npx tsx scripts/verify-browser.ts
 */

import { setActiveCrewToolKeys, setPlatformKeysAllowed } from '../src/lib/crew-tools'
import { runBrowserPlan } from '../src/lib/workforce/browser-worker'
import {
  actionsFromWebAct, parseWebActOutput, webActProvider,
} from '../src/lib/workforce/browser-provider'

const TARGET = 'https://example.com'

let failures = 0
function check(label: string, passed: boolean, detail = ''): void {
  if (!passed) failures++
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

async function main(): Promise<void> {
  setPlatformKeysAllowed(true)
  setActiveCrewToolKeys({})

  console.log('— refusals are never visits —')
  const request = { url: TARGET, goal: 'read the page', steps: [] }
  for (const [name, output] of [
    ['mock', '[MOCK · web_act] Hosted Chrome not configured.'],
    ['strict refusal', 'TASK_BLOCKED [capability_unavailable] required capability "web_act" unavailable'],
    ['declined', '[BLOCKED · web_act] You declined this action.'],
    ['live failure', '[LIVE FAILED · web_act] browserless 402'],
  ] as const) {
    const parsed = parseWebActOutput(output, request, [])
    check(`${name} produces no visit`, parsed.visits.length === 0 && Boolean(parsed.blocked))
  }

  console.log('\n— the provider —')
  const provider = webActProvider()
  const available = await provider.available()
  check('a backend is reachable', available)

  const plan = actionsFromWebAct({ url: TARGET, goal: 'extract: Example Domain', steps: [] })
  check('the plan navigates before it extracts', plan[0].kind === 'navigate')

  console.log('\n— a real page —')
  const { result, artifacts } = await runBrowserPlan(provider, plan)

  if (result.blocked) {
    console.log(`\nBrowser is not live: ${result.blocked}`)
    console.log('Set BROWSERLESS_API_KEY on the agent-tools function to run this end to end.')
    console.log('The refusal checks above still passed, which is the property that must hold either way.')
    process.exit(failures ? 1 : 0)
  }

  check('a visit was recorded', result.visits.length > 0, result.visits[0]?.url ?? '(none)')
  check('the recorded URL is the one asked for', result.visits[0]?.url.includes('example.com') === true)
  check('the page text came back', String((result.data[0] as { text?: string })?.text ?? '').length > 20)
  check('artifacts were produced', artifacts.length > 0, artifacts.map((a) => a.path).join(', '))

  const sources = artifacts.find((a) => a.path === 'browser/sources.json')
  check('sources.json names the host actually visited',
    Boolean(sources && JSON.parse(sources.body).hosts.includes('example.com')))

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
  process.exit(failures ? 1 : 0)
}

main().catch((error) => {
  console.error('THREW', error)
  process.exit(1)
})
