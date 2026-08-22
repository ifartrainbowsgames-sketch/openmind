import { describe, expect, it } from 'vitest'

describe('supabase module under Node', () => {
  it('can be imported without localStorage and does not reject', async () => {
    expect(typeof localStorage).toBe('undefined')
    const mod = await import('./supabase')
    expect(mod.supabase).toBeDefined()
    expect(mod.getRemember()).toBe(true)
  })
})
