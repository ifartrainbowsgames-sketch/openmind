import { describe, expect, it } from 'vitest'
import { DELEGATION_PROMPT, parseSpawnRequests } from './delegation'

describe('parseSpawnRequests', () => {
  const block = (json: string) => '```delegate\n' + json + '\n```'

  it('parses a well-formed request', () => {
    const answer = `Working on it.\n${block(JSON.stringify({
      capability: 'data_analysis',
      goal: 'Cluster pricing tiers',
      inputArtifacts: ['research/pricing.json'],
      expectedOutputs: [{ path: 'analysis/clusters.json', kind: 'json' }],
    }))}`
    const [req] = parseSpawnRequests(answer, 't1')
    expect(req.parentTaskId).toBe('t1')
    expect(req.capability).toBe('data_analysis')
    expect(req.inputArtifacts).toEqual(['research/pricing.json'])
    expect(req.expectedOutputs).toEqual([{ path: 'analysis/clusters.json', kind: 'json' }])
  })

  it('ignores prose that merely talks about needing help', () => {
    // The line between "a model thinking out loud" and "a spawn request" has
    // to be syntactic. Inferring intent from sentences creates agents by
    // accident.
    const answer = 'I need someone to analyse this. Perhaps delegate to an analyst?'
    expect(parseSpawnRequests(answer, 't1')).toEqual([])
  })

  it('drops a block that is not valid JSON', () => {
    expect(parseSpawnRequests(block('{not json'), 't1')).toEqual([])
  })

  it('drops a block missing capability or goal', () => {
    expect(parseSpawnRequests(block('{"goal":"x"}'), 't1')).toEqual([])
    expect(parseSpawnRequests(block('{"capability":"coding"}'), 't1')).toEqual([])
  })

  it('infers artifact kind from the path when omitted', () => {
    const [req] = parseSpawnRequests(block(JSON.stringify({
      capability: 'writing',
      goal: 'Write it up',
      expectedOutputs: [{ path: 'report/summary.md' }],
    })), 't1')
    expect(req.expectedOutputs[0].kind).toBe('markdown')
  })

  it('discards outputs with an unusable kind rather than guessing', () => {
    const [req] = parseSpawnRequests(block(JSON.stringify({
      capability: 'writing',
      goal: 'Write it up',
      expectedOutputs: [{ path: 'a.md', kind: 'binary' }, { path: 'b.json' }],
    })), 't1')
    expect(req.expectedOutputs).toEqual([{ path: 'b.json', kind: 'json' }])
  })

  it('keeps expectedOutputs empty when none survive, so evaluateSpawn refuses it', () => {
    const [req] = parseSpawnRequests(block(JSON.stringify({
      capability: 'writing', goal: 'chat with me', expectedOutputs: [],
    })), 't1')
    expect(req.expectedOutputs).toEqual([])
  })

  it('parses several blocks in one answer', () => {
    const answer = block('{"capability":"coding","goal":"a","expectedOutputs":[{"path":"a.json"}]}')
      + '\n\n'
      + block('{"capability":"testing","goal":"b","expectedOutputs":[{"path":"b.json"}]}')
    expect(parseSpawnRequests(answer, 't1').map((r) => r.capability)).toEqual(['coding', 'testing'])
  })

  it('tolerates a non-array inputArtifacts', () => {
    const [req] = parseSpawnRequests(block(JSON.stringify({
      capability: 'coding', goal: 'x', inputArtifacts: 'oops',
      expectedOutputs: [{ path: 'a.json' }],
    })), 't1')
    expect(req.inputArtifacts).toEqual([])
  })
})

describe('DELEGATION_PROMPT', () => {
  it('documents a format the parser actually accepts', () => {
    // The prompt and the parser drifting apart would make delegation look
    // available while silently never working.
    const requests = parseSpawnRequests(DELEGATION_PROMPT, 't1')
    expect(requests).toHaveLength(1)
    expect(requests[0].expectedOutputs.length).toBeGreaterThan(0)
  })

  it('tells the worker it cannot talk to other workers', () => {
    expect(DELEGATION_PROMPT).toMatch(/cannot talk to other workers/i)
  })
})
