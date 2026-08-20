import { beforeEach, describe, expect, it } from 'vitest'
import { loadEmployeeConnectionOverrides, saveEmployeeConnectionOverrides } from './employees'

class MemStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
  removeItem(key: string) { this.values.delete(key) }
  clear() { this.values.clear() }
}

const store = new MemStorage()
Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true })

describe('employee connection overrides', () => {
  beforeEach(() => store.clear())

  it('persists preset plugin attachments including an empty set', () => {
    saveEmployeeConnectionOverrides({
      mara: ['zendesk', 'n8n', 'n8n'],
      rex: [],
    })
    expect(loadEmployeeConnectionOverrides()).toEqual({
      mara: ['zendesk', 'n8n'],
      rex: [],
    })
  })

  it('ignores malformed stored values', () => {
    localStorage.setItem('openmind-employee-connections-v1', JSON.stringify({
      mara: 'n8n',
      rex: ['github', 42, null],
    }))
    expect(loadEmployeeConnectionOverrides()).toEqual({ rex: ['github'] })
  })
})
