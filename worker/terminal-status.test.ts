import { describe, expect, it } from 'vitest'
import { terminalStatus } from './terminal-status'

/**
 * A run that achieved nothing must never be called completed.
 *
 * This is the one that shipped: the rule was `needs_user ? 'needs_user' :
 * 'completed'` and never looked at failures. A run whose single task failed on
 * a model that does not exist was written to the ledger as completed, with a
 * null error, and the UI printed its answer — a list of ✗ markers rendered as
 * though it were the result.
 */

const done = { status: 'completed' }
const fail = { status: 'failed' }
const wait = { status: 'needs_user' }

describe('a run where nothing succeeded', () => {
  it('is failed, not completed', () => {
    expect(terminalStatus([fail]).status).toBe('failed')
    expect(terminalStatus([fail, fail, fail]).status).toBe('failed')
  })

  it('says how many failed, so the row explains itself', () => {
    const { error } = terminalStatus([fail, fail])
    expect(error).toContain('2 of 2')
    expect(error).toContain('failed')
  })

  it('names the first failing task when it can', () => {
    const { error } = terminalStatus([{ status: 'failed', goal: 'Research pricing pages' }])
    expect(error).toContain('Research pricing pages')
  })

  it('counts a blocked task as a failure too', () => {
    // Blocked means a capability was unavailable and no work happened. From
    // the customer's side that is indistinguishable from failure, and calling
    // it success is the same lie.
    expect(terminalStatus([{ status: 'blocked' }]).status).toBe('failed')
  })

  it('reports singular and plural correctly', () => {
    expect(terminalStatus([fail]).error).toContain('1 of 1 task failed')
    expect(terminalStatus([fail, fail]).error).toContain('2 of 2 tasks failed')
  })
})

describe('a run still waiting on a person', () => {
  it('outranks failure, because it is recoverable', () => {
    // Reporting needs_user as failed would throw away work someone can still
    // unblock by approving a tool call.
    expect(terminalStatus([wait]).status).toBe('needs_user')
    expect(terminalStatus([fail, wait]).status).toBe('needs_user')
    expect(terminalStatus([done, fail, wait]).status).toBe('needs_user')
  })

  it('carries no error, because nothing has gone wrong yet', () => {
    expect(terminalStatus([wait]).error).toBeNull()
  })
})

describe('a run that did the work', () => {
  it('is completed', () => {
    expect(terminalStatus([done]).status).toBe('completed')
    expect(terminalStatus([done, done]).status).toBe('completed')
  })

  it('stays completed when some tasks failed but others produced output', () => {
    // Deliberate: there IS output, the snapshot carries every task's real
    // status, and the answer marks failures with ✗. Calling a mostly-working
    // run "failed" would be its own dishonesty. The line being defended is
    // narrower — a run that achieved nothing is never completed.
    expect(terminalStatus([done, fail]).status).toBe('completed')
    expect(terminalStatus([done, fail]).error).toBeNull()
  })

  it('treats an empty task list as completed rather than failed', () => {
    // A goal that needed no tasks is not a failure, and `failed.length > 0`
    // is what keeps this from being one.
    expect(terminalStatus([]).status).toBe('completed')
  })

  it('ignores tasks still pending or running', () => {
    expect(terminalStatus([done, { status: 'pending' }]).status).toBe('completed')
    expect(terminalStatus([{ status: 'running' }]).status).toBe('completed')
  })
})

describe('the exact run that exposed this', () => {
  it('one task, failed on a nonexistent model — is failed', () => {
    const decision = terminalStatus([{ status: 'failed', goal: 'Research three canary strategies' }])
    expect(decision.status).toBe('failed')
    expect(decision.status).not.toBe('completed')
    expect(decision.error).toBeTruthy()
  })
})
