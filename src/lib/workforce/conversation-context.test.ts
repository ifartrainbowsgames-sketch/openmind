import { afterEach, describe, expect, it, vi } from 'vitest'
import { _resetConversations, conversationContext } from './conversation-context'
import { _resetRepositories } from './session-repository'

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
  _resetRepositories()
})

describe('a conversation has its own machine', () => {
  it('starts with no machine rather than inheriting one', () => {
    // The original bug was inheriting whatever a task run left in a module
    // global. That global no longer exists, so the property to hold now is
    // simply that a fresh conversation owns nothing until it asks.
    const ctx = conversationContext({
      conversationId: 'user-1',
      permissions: { platformKeys: false },
    })
    expect(ctx.workspace.sandboxId).toBeUndefined()
    expect(ctx.workspace.projectId).toBe('conversation:user-1')
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

  it("does not leak a conversation's machine into another conversation", () => {
    const one = conversationContext({ conversationId: 'user-1', permissions: { platformKeys: false } })
    one.adoptSandbox('sbx-chat')
    const two = conversationContext({ conversationId: 'user-2', permissions: { platformKeys: false } })
    expect(two.workspace.sandboxId).toBeUndefined()
  })

  it('carries the run permissions rather than reading module state', () => {
    const ctx = conversationContext({ conversationId: 'user-1', permissions: { platformKeys: true } })
    expect(ctx.permissions.platformKeys).toBe(true)
  })
})
