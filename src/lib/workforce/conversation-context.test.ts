import { afterEach, describe, expect, it, vi } from 'vitest'
import { _resetConversations, conversationContext } from './conversation-context'
import { getActiveSandbox, setActiveSandbox } from '../crew-tools'

vi.mock('../supabase')

/**
 * The leak this closes.
 *
 * The chat turn, the crew and the Studio run real employees with real tools —
 * `run_code` reaches E2B — but they had no session, so they read the machine
 * from the module-level binding. They never set it. They inherited whatever
 * the last task run left there, and would happily execute inside a coding
 * task's sandbox: reading its files, writing into a machine the task still
 * believed it owned.
 *
 * Nothing errors when this happens. The only symptom is a chat answer that
 * knows things it should not, which is why it needs a test rather than care.
 */

afterEach(() => {
  _resetConversations()
  setActiveSandbox(undefined)
})

describe('a conversation has its own machine', () => {
  it("does not inherit the task graph's sandbox", () => {
    // Exactly the situation: a task run just finished and left this bound.
    setActiveSandbox('sbx-task-machine')
    const ctx = conversationContext({
      conversationId: 'user-1',
      permissions: { platformKeys: false },
    })
    expect(ctx.workspace.sandboxId).toBeUndefined()
    // And building one does not disturb the binding for whoever set it.
    expect(getActiveSandbox()).toBe('sbx-task-machine')
  })

  it('keeps one workspace per conversation across turns', () => {
    const first = conversationContext({ conversationId: 'user-1', permissions: { platformKeys: false } })
    const second = conversationContext({ conversationId: 'user-1', permissions: { platformKeys: false } })
    expect(second.session.id).toBe(first.session.id)
  })

  it('separates two conversations', () => {
    const a = conversationContext({ conversationId: 'user-1', permissions: { platformKeys: false } })
    const b = conversationContext({ conversationId: 'user-2', permissions: { platformKeys: false } })
    expect(a.session.id).not.toBe(b.session.id)
  })

  it('carries an adopted machine into the next turn', () => {
    // A tool created a sandbox during turn one. Without the write-back the
    // adoption would live in a closure and die with the turn, so every message
    // would start a new machine.
    const first = conversationContext({ conversationId: 'user-1', permissions: { platformKeys: false } })
    first.adoptSandbox('sbx-chat')
    const second = conversationContext({ conversationId: 'user-1', permissions: { platformKeys: false } })
    expect(second.workspace.sandboxId).toBe('sbx-chat')
  })

  it("does not leak a conversation's machine back into the task binding", () => {
    const ctx = conversationContext({ conversationId: 'user-1', permissions: { platformKeys: false } })
    ctx.adoptSandbox('sbx-chat')
    expect(getActiveSandbox()).toBeUndefined()
  })

  it('carries the run permissions rather than reading module state', () => {
    const ctx = conversationContext({ conversationId: 'user-1', permissions: { platformKeys: true } })
    expect(ctx.permissions.platformKeys).toBe(true)
  })
})
