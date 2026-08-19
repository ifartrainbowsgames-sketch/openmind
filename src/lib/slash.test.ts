import { describe, expect, it } from 'vitest'
import { consumeSlash, matchSlashCommands, slashQuery } from './slash'

describe('slash commands', () => {
  it('lists / commands while the line is a prefix', () => {
    expect(slashQuery('/pl')).toBe('/pl')
    expect(matchSlashCommands('/pl').map((c) => c.cmd)).toContain('/plan')
    expect(matchSlashCommands('/plan now')).toEqual([])
  })

  it('consumes a full command', () => {
    const taken = consumeSlash('/ask what is unread')
    expect(taken?.command.cmd).toBe('/ask')
    expect(taken?.command.skill).toBe('ask')
    expect(taken?.rest).toBe('what is unread')
  })
})
