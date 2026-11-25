import { describe, it, expect } from 'vitest'
import { signed, site, plan, node, plantNodeOf, sumterSurface } from './helpers/play.ts'
import { commitCorridor, planCorridor, setOffer } from '../src/engine/turn/corridor.ts'
import { advanceProjects } from '../src/engine/turn/resolve.ts'
import { firmDeliverableMw, firmFlow, plannedFirmMw, plannedWithLine, STORAGE_FIRM_SHARE, CAMPUS, SUBSTATION, siteNode } from '../src/engine/realtime/network.ts'
import { landQuartersLeft, lineFinish, plantArrival, plantFinish, powerForecast, LAND_QUARTERS } from '../src/engine/forecast.ts'
import { Rng } from '../src/engine/rng.ts'
import type { GameState } from '../src/engine/types.ts'

const settle = (g: GameState): GameState => {
  for (const c of g.corridors) {
    for (const d of Object.values(c.deals)) d.status = 'accepted'
    c.status = 'building'
  }
  return g
}

const turbines = (n: number): GameState => {
  const g = site(signed(), 'gas-ct', n)
  return commitCorridor(g, plan(g))
}

describe('power forecast', () => {
  it('matches what the game does when nothing slips', () => {
    for (const build of [
      () => settle(turbines(3)),
      () => { const g = site(turbines(1), 'solar', 1); return settle(g) },
      () => settle(turbines(2)),
    ]) {
      const g = build()
      const f = powerForecast(g)
      const s = structuredClone(g)
      const rng = new Rng(1)
      for (const point of f.points.slice(1)) {
        advanceProjects(s, rng)
        expect(point.flow.totalMw).toBeCloseTo(firmDeliverableMw(s), 6)
        s.quarter += 1
      }
    }
  })

  it('names the quarter the contract is met', () => {
    const g = settle(turbines(3))
    const f = powerForecast(g)
    const s = structuredClone(g)
    const rng = new Rng(1)
    while (s.energizedQuarter === null) { advanceProjects(s, rng); s.quarter += 1 }
    expect(f.readyQuarter).toBe(s.energizedQuarter)
    expect(f.plannedQuarter).toBe(s.energizedQuarter)
  })

  it('has no ready quarter when too little is filed', () => {
    const f = powerForecast(settle(turbines(1)))
    expect(f.readyQuarter).toBeNull()
    expect(f.plannedMw).toBeCloseTo(190)
  })

  it('ends where everything filed ends', () => {
    const g = turbines(2)
    expect(powerForecast(g).plannedMw).toBeCloseTo(plannedFirmMw(g))
  })

  it('assumes a time for land, and counts it down', () => {
    const g = turbines(2)
    const c = g.corridors[0]
    expect(landQuartersLeft(g, c)).toBe(LAND_QUARTERS)
    g.quarter += 3
    expect(landQuartersLeft(g, c)).toBe(LAND_QUARTERS - 3)
    g.quarter += 20
    expect(landQuartersLeft(g, c)).toBe(2)
    delete c.filedQuarter
    expect(landQuartersLeft(g, c)).toBe(LAND_QUARTERS)
  })

  it('waits for one answer when every owner has an offer', () => {
    let g = turbines(2)
    for (const id of Object.keys(g.corridors[0].deals)) g = setOffer(g, g.corridors[0].id, id, 2)
    expect(landQuartersLeft(g, g.corridors[0])).toBe(1)
  })

  it('leaves out a line across land that cannot be bought', () => {
    const g = turbines(2)
    Object.values(g.corridors[0].deals)[0].status = 'blocked'
    expect(lineFinish(g, g.corridors[0])).toBeNull()
    expect(powerForecast(g).plannedMw).toBe(0)
  })

  it('dates a plant through permitting and construction', () => {
    const g = turbines(1)
    expect(plantFinish(g, g.plants[0])).toBe(g.quarter + 10)
  })
})

describe('what stops a plant', () => {
  it('is the missing line', () => {
    const g = site(signed(), 'solar', 1)
    g.plants[0].status = 'online'
    expect(firmFlow(g).plants.get('plant-1')).toMatchObject({ arrivingMw: 0, limit: { kind: 'no-line' } })
  })

  it('is the tie, for power that lands at the substation', () => {
    let g = site(signed(), 'gas-ct', 2)
    g = commitCorridor(g, planCorridor(sumterSurface(), plantNodeOf(g), node(g, 'substation'), '230')!)
    for (const p of g.plants) p.status = 'online'
    for (const c of g.corridors) c.status = 'energized'
    const f = firmFlow(g)
    expect(f.totalMw).toBeCloseTo(120)
    expect([...f.plants.values()].some((p) => p.limit?.kind === 'lines' && p.limit.ids.includes('tie'))).toBe(true)
  })

  it('is the contract, once it is met', () => {
    const g = turbines(3)
    for (const p of g.plants) p.status = 'online'
    g.corridors[0].status = 'energized'
    const f = firmFlow(g)
    const sum = [...f.plants.values()].reduce((n, p) => n + p.arrivingMw, 0)
    expect(sum).toBeCloseTo(f.totalMw)
    expect([...f.plants.values()].filter((p) => p.limit).length).toBeGreaterThan(0)
  })

  it('is the cap on batteries', () => {
    let g = site(signed(), 'battery', 2)
    g = commitCorridor(g, plan(g))
    for (const p of g.plants) p.status = 'online'
    g.corridors[0].status = 'energized'
    const f = firmFlow(g)
    expect(f.totalMw).toBeCloseTo(g.contract.contractedMw * STORAGE_FIRM_SHARE)
    expect([...f.plants.values()].some((p) => p.limit?.kind === 'storage-cap')).toBe(true)
  })

  it('is nothing for solar with a line', () => {
    let g = site(signed(), 'solar', 1)
    g = commitCorridor(g, plan(g))
    g.plants[0].status = 'online'
    g.corridors[0].status = 'energized'
    expect(firmFlow(g).plants.get('plant-1')).toMatchObject({ arrivingMw: 16, limit: null })
  })
})

describe('a line being planned', () => {
  it('says what it would add', () => {
    const g = site(signed(), 'gas-ct', 2)
    const line = { fromNode: siteNode(g.plants[0].cell), classId: '230' as const }
    expect(plannedFirmMw(g)).toBe(0)
    expect(plannedWithLine(g, { ...line, toNode: CAMPUS }).totalMw).toBeCloseTo(380)
    expect(plannedWithLine(g, { ...line, toNode: SUBSTATION }).totalMw).toBeCloseTo(120)
    expect(g.corridors).toHaveLength(0)
  })

  it('gives a plant its arrival date', () => {
    const g = settle(turbines(1))
    expect(plantArrival(powerForecast(g), 'plant-1')).toEqual({ mw: expect.closeTo(190), quarter: g.quarter + 10 })
  })
})
