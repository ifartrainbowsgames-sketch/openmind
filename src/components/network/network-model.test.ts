import { describe, expect, it } from 'vitest'
import { CONNECTIONS, TOOL_REGISTRY } from '@/lib/agent'
import {
  DEMO_TEAM,
  NODE_H,
  NODE_W,
  buildEdges,
  computeLayout,
  eventForEdge,
  packetCaption,
  satelliteOffsets,
  seeded,
  taskLinesFor,
  worksWithLine,
} from './network-model'

describe('seeded', () => {
  it('is deterministic and stays in [0, 1)', () => {
    for (let i = 0; i < 50; i++) {
      const v = seeded(i, 3)
      expect(v).toBe(seeded(i, 3))
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('DEMO_TEAM', () => {
  it('has four employees with unique ids and valid tools/connections', () => {
    expect(DEMO_TEAM).toHaveLength(4)
    expect(new Set(DEMO_TEAM.map((e) => e.id)).size).toBe(4)
    for (const e of DEMO_TEAM) {
      expect(e.name).toBeTruthy()
      expect(e.role).toBeTruthy()
      expect(e.prompt.length).toBeGreaterThan(40)
      expect(e.connections!.length).toBeGreaterThanOrEqual(2)
      for (const c of e.connections ?? []) expect(CONNECTIONS[c]).toBeDefined()
      for (const t of e.tools) expect(TOOL_REGISTRY[t]).toBeDefined()
    }
  })
})

describe('computeLayout', () => {
  it('returns one in-bounds point per node from phone to desktop widths', () => {
    const panels: [number, number][] = [
      [320, 540],
      [390, 560],
      [768, 600],
      [1200, 620],
    ]
    for (const [w, h] of panels) {
      for (const n of [1, 2, 4, 6]) {
        const pts = computeLayout(w, h, n)
        expect(pts).toHaveLength(n)
        for (const p of pts) {
          expect(p.x).toBeGreaterThanOrEqual(NODE_W / 2)
          expect(p.x).toBeLessThanOrEqual(w - NODE_W / 2)
          expect(p.y).toBeGreaterThanOrEqual(NODE_H / 2)
          expect(p.y).toBeLessThanOrEqual(h - NODE_H / 2)
        }
      }
    }
  })

  it('respects a smaller node footprint on compact panels', () => {
    const nodeW = 148
    const pts = computeLayout(320, 540, 4, nodeW, NODE_H, 60)
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(nodeW / 2)
      expect(p.x).toBeLessThanOrEqual(320 - nodeW / 2)
      expect(p.y).toBeGreaterThanOrEqual(NODE_H / 2 + 60)
    }
  })

  it('is deterministic', () => {
    expect(computeLayout(390, 560, 4)).toEqual(computeLayout(390, 560, 4))
  })

  it('handles degenerate inputs', () => {
    expect(computeLayout(0, 0, 3)).toEqual([])
    expect(computeLayout(390, 560, 0)).toEqual([])
    expect(computeLayout(390, 560, -2)).toEqual([])
  })
})

describe('satelliteOffsets', () => {
  it('spreads satellites at distinct angles on the given ellipse', () => {
    const sats = satelliteOffsets(3, 80, 72, 0)
    expect(sats).toHaveLength(3)
    expect(new Set(sats.map((s) => s.angle.toFixed(6))).size).toBe(3)
    for (const s of sats) {
      expect(Math.hypot(s.dx / 80, s.dy / 72)).toBeCloseTo(1, 5)
    }
  })

  it('returns nothing for zero satellites', () => {
    expect(satelliteOffsets(0, 80, 72, 0)).toEqual([])
  })
})

describe('buildEdges', () => {
  it('produces valid, unique, self-loop-free edges', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const edges = buildEdges(n)
      const keys = new Set<string>()
      for (const e of edges) {
        expect(e.from).not.toBe(e.to)
        expect(e.from).toBeGreaterThanOrEqual(0)
        expect(e.to).toBeLessThan(n)
        const k = `${Math.min(e.from, e.to)}-${Math.max(e.from, e.to)}`
        expect(keys.has(k)).toBe(false)
        keys.add(k)
      }
    }
  })

  it('is a single edge for two nodes, a full ring plus chords for four', () => {
    expect(buildEdges(1)).toEqual([])
    expect(buildEdges(2)).toEqual([{ from: 0, to: 1 }])
    expect(buildEdges(4).length).toBe(6) // 4 ring + 2 chords
  })
})

describe('handoff captions', () => {
  const event = { from: DEMO_TEAM[0].id, to: DEMO_TEAM[1].id, label: 'research/competitors.json', at: 10 }

  it('names both employees and the artifact that actually moved', () => {
    expect(packetCaption(DEMO_TEAM[0], DEMO_TEAM[1], event)).toBe('Mara → Rex: research/competitors.json')
  })

  it('finds no event for an edge nothing crossed', () => {
    expect(eventForEdge([], DEMO_TEAM[0], DEMO_TEAM[1])).toBeUndefined()
    expect(eventForEdge(undefined, DEMO_TEAM[0], DEMO_TEAM[1])).toBeUndefined()
    expect(eventForEdge([event], DEMO_TEAM[1], DEMO_TEAM[0])).toBeUndefined()
  })

  it('picks the most recent event on an edge', () => {
    const older = { ...event, label: 'old.json', at: 1 }
    const newer = { ...event, label: 'new.json', at: 99 }
    expect(eventForEdge([older, newer], DEMO_TEAM[0], DEMO_TEAM[1])?.label).toBe('new.json')
  })

  it('describes capability when idle, never invented activity', () => {
    const mara = taskLinesFor(DEMO_TEAM[0])
    expect(mara.every((l) => l.startsWith('can ') || l.startsWith('idle'))).toBe(true)
    expect(mara.some((l) => l.includes('ticket queue'))).toBe(true)

    const bare = taskLinesFor({ ...DEMO_TEAM[0], connections: [] })
    expect(bare).toEqual(['idle — no task assigned'])
  })

  it('shows the live status verbatim when a task really is running', () => {
    expect(taskLinesFor(DEMO_TEAM[0], 'TASK-002 running — web_search')).toEqual(['TASK-002 running — web_search'])
  })

  it('worksWithLine joins connection labels', () => {
    expect(worksWithLine(DEMO_TEAM[0])).toBe('Zendesk · Gmail')
    expect(worksWithLine({ ...DEMO_TEAM[0], connections: [] })).toBe('their desk tools')
  })
})
