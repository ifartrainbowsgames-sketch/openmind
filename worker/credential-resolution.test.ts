import { describe, expect, it } from 'vitest'
import { credentialFor, type Credential } from './credential-resolution'

/**
 * Which of a customer's several keys gets used.
 *
 * The question only exists because a customer can now connect many providers
 * at once. While there were three fixed model slots the answer was trivially
 * "the one in the worker slot"; with Anthropic and Grok and OpenAI all
 * connected, choosing wrong means spending the customer's money at a rate they
 * did not agree to, on a provider they did not pick.
 */

const anthropic: Credential = { providerId: 'anthropic', apiKey: 'k-anthropic' }
const xai: Credential = { providerId: 'xai', apiKey: 'k-xai' }
const openai: Credential = { providerId: 'openai', apiKey: 'k-openai' }

/** How loadKeys indexes rows: a connection once, a legacy row under both. */
function connections(...entries: Credential[]): Map<string, Credential> {
  return new Map(entries.map((e) => [e.providerId, e]))
}

describe('the customer’s explicit choice wins', () => {
  it('uses the provider named in the run, not the first one connected', () => {
    const keys = connections(anthropic, xai, openai)
    expect(credentialFor(keys, 'xai', 'worker')).toBe(xai)
  })

  it('picks a different one when the choice changes, with the same keys', () => {
    // The pair matters: it shows the result tracks the CHOICE rather than
    // happening to match whatever the map yields first.
    const keys = connections(anthropic, xai, openai)
    expect(credentialFor(keys, 'anthropic', 'worker')?.apiKey).toBe('k-anthropic')
    expect(credentialFor(keys, 'openai', 'worker')?.apiKey).toBe('k-openai')
  })

  it('never returns a credential belonging to a different provider', () => {
    const keys = connections(anthropic, xai, openai)
    for (const id of ['anthropic', 'xai', 'openai']) {
      expect(credentialFor(keys, id, 'worker')?.providerId).toBe(id)
    }
  })
})

describe('a provider that is chosen but not connected', () => {
  it('does not fall through to another provider’s key', () => {
    // The failure being prevented: the customer picks Grok, has no Grok key,
    // and their ANTHROPIC key is presented to xAI's endpoint.
    const keys = connections(anthropic)
    // 'worker' is absent, and there is exactly one connection, so rule 3
    // applies — but it must resolve to Anthropic's own credential, never to
    // Anthropic's key labelled as something else.
    const got = credentialFor(keys, 'xai', 'worker')
    expect(got?.providerId).not.toBe('xai')
    expect(got).toBe(anthropic)
  })

  it('blocks rather than guessing when several are connected', () => {
    const keys = connections(anthropic, xai, openai)
    expect(credentialFor(keys, 'mistral', 'worker')).toBeUndefined()
  })
})

describe('accounts that predate provider connections still work', () => {
  it('falls back to the legacy slot', () => {
    // A legacy row is indexed twice by loadKeys: under its role and under its
    // provider. Reproduced here rather than described.
    const legacy: Credential = { providerId: 'openai', apiKey: 'k-legacy' }
    const keys = new Map<string, Credential>([['worker', legacy], ['openai', legacy]])
    expect(credentialFor(keys, undefined, 'worker')).toBe(legacy)
  })

  it('prefers an explicit choice over the legacy slot', () => {
    const legacy: Credential = { providerId: 'openai', apiKey: 'k-legacy' }
    const keys = new Map<string, Credential>([
      ['worker', legacy], ['openai', legacy], ['anthropic', anthropic],
    ])
    expect(credentialFor(keys, 'anthropic', 'worker')).toBe(anthropic)
  })

  it('reads the planner slot independently of the worker slot', () => {
    const keys = new Map<string, Credential>([['worker', openai], ['planner', anthropic]])
    expect(credentialFor(keys, undefined, 'planner')).toBe(anthropic)
    expect(credentialFor(keys, undefined, 'worker')).toBe(openai)
  })
})

describe('one connection and no choice', () => {
  it('uses it, because there is nothing to be ambiguous about', () => {
    expect(credentialFor(connections(anthropic), undefined, 'worker')).toBe(anthropic)
  })

  it('is not fooled by a legacy row that double-indexes one credential', () => {
    // Two map entries, ONE underlying credential. Counting entries instead of
    // distinct providers would call this ambiguous and block a customer who
    // has exactly one key.
    const legacy: Credential = { providerId: 'openai', apiKey: 'k-legacy' }
    const keys = new Map<string, Credential>([['judge', legacy], ['openai', legacy]])
    expect(credentialFor(keys, undefined, 'worker')).toBe(legacy)
  })
})

describe('nothing connected', () => {
  it('resolves to nothing', () => {
    expect(credentialFor(new Map(), undefined, 'worker')).toBeUndefined()
    expect(credentialFor(new Map(), 'anthropic', 'worker')).toBeUndefined()
  })
})

describe('a non-string choice is ignored, not trusted', () => {
  it('falls through to the normal rules', () => {
    const keys = connections(anthropic)
    for (const junk of [null, 42, {}, [], true, '']) {
      expect(credentialFor(keys, junk, 'worker')).toBe(anthropic)
    }
  })
})
