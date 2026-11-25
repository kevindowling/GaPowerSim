import { describe, it, expect } from 'vitest'
import { signed, site, node, plantNodeOf, plan, sumterSurface, run, operate } from './helpers/play.ts'
import { fixtures } from './helpers/loadFixtures.ts'
import {
  planCorridor, commitCorridor, tapNear, tappableLines, abandonCorridor, offerAll, condemn, type NetNode,
} from '../src/engine/turn/corridor.ts'
import {
  CAMPUS, SUBSTATION, canJoin, firmDeliverableMw, plannedFirmMw, nodesRoutedToCampus, plantNode,
} from '../src/engine/realtime/network.ts'
import { resolveHearing } from '../src/engine/turn/resolve.ts'
import { HEARING_OPTIONS } from '../src/engine/turn/hearing.ts'
import { TAP_CLASSES, tapClassFor } from '../src/data/taps.ts'
import type { GameState } from '../src/engine/types.ts'
import type { LineClassId } from '../src/data/transmission.ts'

const grid = () => fixtures().grid
const existing = (g: GameState) => tappableLines(
  g, grid(), (sumterSurface().powerLines as Array<{ kv: number; points: [number, number][] }>))

/** The closest tap of a voltage to a place. */
function tapOf(g: GameState, kv: number, near: NetNode): NetNode {
  return tapNear(g, grid(), existing(g).filter((l) => tapClassFor(l.kv)?.kv === kv), near.x, near.y, 100)!
}

function file(g: GameState, a: NetNode, b: NetNode, cls: LineClassId = '230'): GameState {
  const p = planCorridor(sumterSurface(), a, b, cls)
  if (!p) throw new Error('no plan')
  return commitCorridor(g, p)
}

const finish = (g: GameState): GameState => {
  for (const c of g.corridors) c.status = 'energized'
  for (const p of g.plants) p.status = 'online'
  return g
}

describe('existing lines', () => {
  it('can be tapped at 115 kV and above', () => {
    expect(tapClassFor(46)).toBeNull()
    expect(tapClassFor(115)?.kv).toBe(115)
    expect(tapClassFor(161)?.kv).toBe(115)
    expect(tapClassFor(230)?.kv).toBe(230)
    expect(tapClassFor(500)?.kv).toBe(500)
    const g = signed()
    expect(existing(g).length).toBeGreaterThan(10)
    expect(existing(g).every((l) => l.kv >= 115)).toBe(true)
  })

  it('need a click on the line', () => {
    const g = site(signed(), 'gas-ct', 1)
    const t = tapOf(g, 230, plantNodeOf(g))
    expect(tapNear(g, grid(), existing(g), t.x, t.y, 0.2)).not.toBeNull()
    const far = tapNear(g, grid(), existing(g).filter((l) => l.kv >= 500), t.x + 9, t.y - 9, 0.2)
    expect(far).toBeNull()
  })

  it('add a station and a study to the line', () => {
    const g = site(signed(), 'gas-ct', 1)
    const a = plantNodeOf(g)
    const tap = planCorridor(sumterSurface(), a, tapOf(g, 230, a), '230')!
    const c = TAP_CLASSES.find((t) => t.kv === 230)!
    expect(tap.taps.cost).toBe(c.cost)
    expect(tap.lineCapex).toBeGreaterThan(c.cost)
    expect(tap.buildQuarters).toBeGreaterThanOrEqual(2 + c.quarters)
  })

  it('connect a plant, up to the tie and the room to spare', () => {
    let g = site(signed(), 'gas-ct', 3)
    const a = plantNodeOf(g)
    g = file(g, a, tapOf(g, 230, a))
    expect(nodesRoutedToCampus(g).has(plantNode(g.plants[0]))).toBe(true)
    finish(g)
    expect(firmDeliverableMw(g)).toBe(g.system.tieMw)
    g = finish(file(g, node(g, SUBSTATION), node(g, CAMPUS)))
    expect(firmDeliverableMw(g)).toBe(TAP_CLASSES.find((t) => t.kv === 230)!.spareMw)
  })

  it('share the same room between taps of one voltage, and add across voltages', () => {
    let g = site(signed(), 'gas-ct', 3)
    const a = plantNodeOf(g)
    const [high, low] = [tapOf(g, 230, a), tapOf(g, 115, a)]
    g = file(g, node(g, SUBSTATION), node(g, CAMPUS), '230d')
    g = file(g, a, high)
    const one = firmDeliverableMw(finish(structuredClone(g)))
    g = file(g, a, low, '115')
    expect(firmDeliverableMw(finish(structuredClone(g)))).toBe(one + 90)
  })

  it('cannot be joined to themselves', () => {
    const g = site(signed(), 'gas-ct', 1)
    const a = tapOf(g, 230, plantNodeOf(g))
    const b = tapOf(g, 230, node(g, CAMPUS))
    expect(canJoin(a.id, b.id)).toBe(false)
    expect(canJoin(a.id, SUBSTATION)).toBe(false)
    expect(canJoin(a.id, CAMPUS)).toBe(true)
    expect(planCorridor(sumterSurface(), a, b, '230')).toBeNull()
  })

  it('can carry a whole project', () => {
    let g = site(signed(), 'gas-ct', 3)
    g.creditLimit = 2e9
    g.contract.inServiceQuarter = 60
    const a = plantNodeOf(g)
    const [big, mid] = [tapOf(g, 500, a), tapOf(g, 230, a)]
    g = file(g, node(g, SUBSTATION), node(g, CAMPUS), '230d')
    g = file(g, a, big)
    g = file(g, a, mid)
    expect(plannedFirmMw(g)).toBe(400)
    for (let i = 0; i < 40 && g.phase === 'build'; i++) {
      for (const c of g.corridors) {
        if (c.status !== 'acquiring') continue
        g = offerAll(g, c.id, 1.5 + i * 0.6)
        if (i < 4) continue
        for (const [id, d] of Object.entries(c.deals)) if (d.status === 'holdout') g = condemn(g, c.id, id)
      }
      if (g.hearing === 'called') g = resolveHearing(g, HEARING_OPTIONS[0])
      g.contract.approval = 80
      g = run(g, 1)
    }
    expect(g.energizedQuarter).not.toBeNull()
    operate(g, { ticks: 3000 })
    const flow = g.realtime!.history[g.realtime!.history.length - 1].lineFlowMw
    for (const t of TAP_CLASSES) expect(flow[`pool:${t.kv}`] ?? 0).toBeLessThanOrEqual(t.spareMw + 1e-6)
  })
})

describe('tapping your own line', () => {
  const withLine = (): GameState => {
    let g = site(signed(), 'gas-ct', 1)
    g = commitCorridor(g, plan(g, '230d'))
    return site(g, 'gas-ct', 2, g.plants[0].cell + 3)
  }

  it('joins a second plant partway along', () => {
    let g = withLine()
    const mid = g.corridors[0].centerline[g.corridors[0].centerline.length >> 1]
    const t = tapNear(g, grid(), [], mid[0], mid[1], 0.3)!
    expect(t.id).toMatch(/^tap:corridor-1@/)
    const second = plantNode(g.plants[1])
    expect(nodesRoutedToCampus(g).has(second)).toBe(false)
    g = file(g, node(g, second), t)
    expect(nodesRoutedToCampus(g).has(second)).toBe(true)
    expect(firmDeliverableMw(finish(g))).toBe(400)
  })

  it('keeps the tapped line from being abandoned', () => {
    let g = withLine()
    const mid = g.corridors[0].centerline[g.corridors[0].centerline.length >> 1]
    g = file(g, node(g, plantNode(g.plants[1])), tapNear(g, grid(), [], mid[0], mid[1], 0.3)!)
    expect(abandonCorridor(g, 'corridor-1')).toBe(g)
    expect(abandonCorridor(g, 'corridor-2').corridors).toHaveLength(1)
  })
})
