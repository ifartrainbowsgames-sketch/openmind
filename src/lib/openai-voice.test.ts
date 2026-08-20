import { describe, expect, it } from 'vitest'
import { textForSpeech } from './openai-voice'

describe('textForSpeech', () => {
  it('strips markdown for natural TTS', () => {
    expect(textForSpeech('**Hello** `world`')).toBe('Hello world')
  })

  it('truncates very long replies', () => {
    const long = 'a'.repeat(5000)
    expect(textForSpeech(long, 100).length).toBeLessThanOrEqual(100)
    expect(textForSpeech(long, 100).endsWith('…')).toBe(true)
  })
})
