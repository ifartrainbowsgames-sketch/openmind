/**
 * The eligibility matrix, against the seven real demo customers.
 *
 *   set -a; . ./.env; set +a
 *   npx tsx scripts/verify-eligibility.ts
 *
 * A unit test with a fake directory proves the engine's logic. This proves the
 * thing a fake cannot: that the directory reads the real table correctly, that
 * `configured` and `verified` are genuinely distinguishable in Postgres, and
 * that the answer differs per customer for the right reason.
 */

import { createClient } from '@supabase/supabase-js'
import { createCredentialDirectory } from '../worker/credential-directory'
import { CLAUDE_CODE_CAPABILITIES, CLAUDE_CODE_CREDENTIALS } from '../runtimes/claude-code-runtime'
import {
  describeReasons, evaluateEligibility, type EligibilityCandidate,
} from '../src/lib/workforce/eligibility'
import { DEMO_CUSTOMERS, type DemoStateId } from './fixtures/demo-customers'

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

let failures = 0
function check(label: string, passed: boolean, detail = ''): void {
  if (!passed) failures++
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

/** Claude Code as the eligibility engine sees it: skills plus what it needs. */
const CLAUDE_CODE: EligibilityCandidate = {
  id: 'claude-code',
  skills: CLAUDE_CODE_CAPABILITIES.skills,
  credentials: CLAUDE_CODE_CREDENTIALS,
}

/** The expected answer for each fixture, and why. */
const MATRIX: Array<{
  id: DemoStateId
  eligible: boolean
  because: string
}> = [
  { id: 'empty', eligible: false, because: 'no credential at all' },
  { id: 'openai', eligible: false, because: 'has OpenAI, needs Anthropic' },
  { id: 'anthropic', eligible: true, because: 'Anthropic connected and verified' },
  { id: 'multi', eligible: true, because: 'Anthropic among several' },
  { id: 'invalid-credential', eligible: false, because: 'stored key failed verification' },
  { id: 'legacy-browser', eligible: false, because: 'keys are in a browser, not the vault' },
  { id: 'history', eligible: true, because: 'Anthropic connected' },
]

async function main(): Promise<void> {
  if (!URL || !SERVICE_ROLE) {
    console.error('FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
    process.exit(1)
  }

  const admin = createClient(URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const directory = createCredentialDirectory(admin)

  // Resolve fixture emails to ids.
  const ids = new Map<string, string>()
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    for (const user of data?.users ?? []) {
      const demo = DEMO_CUSTOMERS.find((c) => c.email.toLowerCase() === user.email?.toLowerCase())
      if (demo) ids.set(demo.id, user.id)
    }
    if ((data?.users.length ?? 0) < 200) break
  }
  check('every demo customer resolved', ids.size === DEMO_CUSTOMERS.length, `${ids.size}/${DEMO_CUSTOMERS.length}`)

  console.log('\n— claude-code eligibility, per customer —\n')

  for (const row of MATRIX) {
    const userId = ids.get(row.id)
    if (!userId) {
      check(`${row.id}`, false, 'fixture missing — run fixtures-demo-customers.ts')
      continue
    }

    const result = await evaluateEligibility({
      candidate: CLAUDE_CODE,
      taskType: 'code',
      userId,
      credentials: directory,
    })

    const detail = result.eligible ? row.because : describeReasons(result.reasons)
    check(
      `${row.id.padEnd(19)} ${row.eligible ? 'ELIGIBLE' : 'ineligible'}`,
      result.eligible === row.eligible,
      detail.slice(0, 96),
    )
  }

  console.log('\n— configured is not the same as works —\n')

  const invalid = ids.get('invalid-credential')
  const valid = ids.get('anthropic')
  if (invalid && valid) {
    const bad = await directory.status(invalid, 'anthropic')
    const good = await directory.status(valid, 'anthropic')

    check('the invalid fixture IS configured', bad.configured, `configured=${bad.configured}`)
    check('and is nonetheless reported as failed', bad.verification === 'failed', bad.verification)
    check('the valid fixture is verified', good.verification === 'verified', good.verification)
    check('so a row existing is not what makes a runtime eligible',
      bad.configured && bad.verification === 'failed')
  }

  console.log('\n— a candidate is refused for the RIGHT reason —\n')

  const openai = ids.get('openai')
  if (openai) {
    const result = await evaluateEligibility({
      candidate: CLAUDE_CODE, taskType: 'code', userId: openai, credentials: directory,
    })
    check('a customer with the wrong provider is refused on the credential, not the capability',
      !result.eligible
      && result.reasons.length === 1
      && result.reasons[0].kind === 'missing_provider_credential',
      result.eligible ? 'eligible' : describeReasons(result.reasons))
  }

  // The whole point of the stage, against real data.
  const empty = ids.get('empty')
  if (empty) {
    const result = await evaluateEligibility({
      candidate: CLAUDE_CODE, taskType: 'code', userId: empty, credentials: directory,
    })
    check('RULE 1 — no credential means ineligible, whatever the history',
      !result.eligible,
      'a perfect posterior cannot make an unfunded runtime runnable')
  }

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
  process.exit(failures ? 1 : 0)
}

main().catch((error) => {
  console.error('THREW', error)
  process.exit(1)
})
