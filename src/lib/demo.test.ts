import { describe, expect, it } from 'vitest'
import {
  analyzeSentiment,
  hashSeed,
  mulberry,
  retrievePassages,
  splitSentences,
  summarize,
} from './demo'

describe('hashSeed', () => {
  it('is deterministic for the same input', () => {
    expect(hashSeed('openmind')).toBe(hashSeed('openmind'))
  })

  it('differs for different inputs', () => {
    expect(hashSeed('a cat')).not.toBe(hashSeed('a dog'))
  })

  it('returns an unsigned 32-bit integer', () => {
    const h = hashSeed('check the range please')
    expect(Number.isInteger(h)).toBe(true)
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThanOrEqual(0xffffffff)
  })
})

describe('mulberry', () => {
  it('produces values in [0, 1)', () => {
    const rnd = mulberry(42)
    for (let i = 0; i < 200; i++) {
      const v = rnd()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('repeats the same sequence for the same seed', () => {
    const a = mulberry(7)
    const b = mulberry(7)
    for (let i = 0; i < 10; i++) expect(a()).toBe(b())
  })
})

describe('analyzeSentiment', () => {
  it('labels clearly positive text as Positive', () => {
    const r = analyzeSentiment('I love this product, it is excellent and works great')
    expect(r.label).toBe('Positive')
    expect(r.score).toBeGreaterThan(0)
    expect(r.hits.every((h) => h.polarity === 1)).toBe(true)
  })

  it('labels clearly negative text as Negative', () => {
    const r = analyzeSentiment('Terrible experience, the app crashed and support was useless')
    expect(r.label).toBe('Negative')
    expect(r.score).toBeLessThan(0)
  })

  it('labels text with both polarities as Mixed', () => {
    expect(analyzeSentiment('I love the design but hate the slow loading').label).toBe('Mixed')
  })

  it('labels lexicon-free text as Neutral', () => {
    expect(analyzeSentiment('The package arrived on Tuesday afternoon.').label).toBe('Neutral')
  })

  it('scores urgency from trigger words, capped at 1', () => {
    expect(analyzeSentiment('site is down, urgent, outage — fix it asap, now!').urgency).toBe(1)
    expect(analyzeSentiment('everything is fine').urgency).toBe(0)
  })

  it('caps confidence at 0.98', () => {
    const many = Array(20).fill('great awesome excellent').join(' ')
    expect(analyzeSentiment(many).confidence).toBeLessThanOrEqual(0.98)
  })
})

describe('splitSentences', () => {
  it('splits on terminal punctuation', () => {
    expect(splitSentences('One here. Two there! Three more?')).toEqual([
      'One here.',
      'Two there!',
      'Three more?',
    ])
  })

  it('returns the trimmed text when no punctuation exists', () => {
    expect(splitSentences('  no punctuation here  ')).toEqual(['no punctuation here'])
  })

  it('returns an empty array for empty input', () => {
    expect(splitSentences('   ')).toEqual([])
  })
})

describe('summarize', () => {
  const doc =
    'OpenMind routes AI requests through your own provider keys. ' +
    'The widget embeds on any site with two lines of code. ' +
    'Billing is handled by your provider with zero token markup. ' +
    'Your provider keys stay encrypted in the vault.'

  it('keeps roughly the requested ratio of sentences, at least one', () => {
    expect(summarize(doc, 0.5)).toHaveLength(2)
    expect(summarize(doc, 0.01)).toHaveLength(1)
    expect(summarize(doc, 1)).toHaveLength(4)
  })

  it('preserves original document order in the output', () => {
    const out = summarize(doc, 0.5)
    const idx = out.map((o) => doc.indexOf(o.sentence))
    expect(idx[0]).toBeLessThan(idx[1])
  })

  it('prefers high-information sentences over stopword-heavy ones', () => {
    const text =
      'Kubernetes orchestrates containers across clusters efficiently. ' +
      'It is the thing that does the stuff for you. ' +
      'Kubernetes scaling keeps clusters resilient under heavy load.'
    const out = summarize(text, 0.34)
    expect(out[0].sentence).toMatch(/Kubernetes/)
  })

  it('handles single-sentence input', () => {
    expect(summarize('Just one thought.', 0.5)).toEqual([{ sentence: 'Just one thought.', score: 1 }])
  })
})

describe('retrievePassages', () => {
  const doc =
    'Refunds are processed within five business days. ' +
    'The widget supports voice and video calls. ' +
    'To request a refund, email billing@acme.com.'

  it('ranks the most relevant passage first', () => {
    const out = retrievePassages(doc, 'How do I get a refund?')
    expect(out.length).toBeGreaterThan(0)
    expect(out[0].sentence).toMatch(/[Rr]efund/)
  })

  it('respects the k limit', () => {
    expect(retrievePassages(doc, 'refund', 1)).toHaveLength(1)
  })

  it('returns nothing for stopword-only questions', () => {
    expect(retrievePassages(doc, 'what is the it of and')).toEqual([])
  })
})
