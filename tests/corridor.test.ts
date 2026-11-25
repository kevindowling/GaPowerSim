import { describe, it, expect } from 'vitest'
import { fixtures, cellAtLonLat } from './helpers/loadFixtures.ts'
import {
  signed, site, plan, node, plantNodeOf, sumterSurface, sumterParcels, run, acquire, build, newGame,
} from './helpers/play.ts'
import { acceptContract } from '../src/engine/turn/resolve.ts'
import {
  planCorridor, commitCorridor, offerAll, condemn, abandonCorridor, acquisitionComplete,
  networkNodes, nodeNear, repricePlan, outstandingHoldouts,
} from '../src/engine/turn/corridor.ts'
import { routeLeg } from '../src/engine/geo/fineRoute.ts'
import { centerlineLength, type Point } from '../src/engine/geo/polygon.ts'
import { project } from '../src/engine/geo/projection.ts'
import { firmDeliverableMw, SUBSTATION, CAMPUS } from '../src/engine/realtime/network.ts'
import { DUBLIN } from '../src/data/scenarios.ts'
import { lineClass } from '../src/data/transmission.ts'
import type { GameState } from '../src/engine/types.ts'

const withPlants = (n = 3): GameState => site(signed(), 'gas-ct', n)

describe('where lines can go', () => {
  it('offers the campus, the substation and each plant site as ends', () => {
    const ids = networkNodes(withPlants(), fixtures().grid).map((n) => n.id)
    expect(ids).toContain(CAMPUS)
    expect(ids).toContain(SUBSTATION)
    expect(ids.filter((i) => i.startsWith('site:'))).toHaveLength(1)
  })

  it('ignores clicks that are not near an end', () => {
    const nodes = networkNodes(withPlants(), fixtures().grid)
    expect(nodeNear(nodes, nodes[0].x + 0.1, nodes[0].y, 0.5)?.id).toBe(nodes[0].id)
    expect(nodeNear(nodes, nodes[0].x + 30, nodes[0].y + 30, 0.5)).toBeNull()
  })

  it('refuses a line from a place to itself', () => {
    const g = withPlants()
    expect(planCorridor(sumterSurface(), node(g, CAMPUS), node(g, CAMPUS), '500')).toBeNull()
  })
})

describe('routing', () => {
  it('cuts fewer parcels in two when following property lines', () => {
    const g = withPlants()
    const direct = plan(g, '230', 'direct')
    const property = plan(g, '230', 'property')
    expect(property.takings.parcelsSevered).toBeLessThan(direct.takings.parcelsSevered)
  })

  it('passes fewer buildings when told to avoid homes', () => {
    const g = withPlants()
    const homes = (style: 'balanced' | 'homes') =>
      plan(g, '230', style).buildingsNear
    expect(homes('homes')).toBeLessThanOrEqual(homes('balanced'))
  })

  it('passes through a waypoint, and is longer for it', () => {
    const g = withPlants()
    const a = plantNodeOf(g)
    const b = node(g, CAMPUS)
    const via: Point = [(a.x + b.x) / 2, (a.y + b.y) / 2 + 4]
    const bent = planCorridor(sumterSurface(), a, b, '230', 'balanced', [via])!
    expect(bent.centerline.some(([x, y]) => Math.hypot(x - via[0], y - via[1]) < 0.01)).toBe(true)
    expect(bent.lengthKm).toBeGreaterThan(plan(g).lengthKm)
  })

  it('goes around protected land', () => {
    const surface = { grid: fixtures().grid, parcels: [] }
    const from = project(-82.75, 30.9) as Point
    const to = project(-82.0, 30.9) as Point
    const leg = routeLeg(surface, from, to, 'direct')!
    expect(centerlineLength(leg)).toBeGreaterThan(Math.hypot(to[0] - from[0], to[1] - from[1]) * 1.05)
  })

  it('prices land outside the loaded county too', () => {
    const g = site(signed(), 'gas-ct', 1, cellAtLonLat(-83.9, 32.45))
    const p = plan(g)
    const km2 = p.lengthKm * lineClass('230').rowHalfWidthKm * 2
    expect(p.takings.totalAcres).toBeGreaterThan(km2 * 247 * 0.85)
    expect(new Set(p.parcels.map((x) => x.countyFips)).size).toBeGreaterThan(1)
  })

  it('works in a county with no cadastre at all', () => {
    let g = acceptContract(newGame(DUBLIN))
    g = site(g, 'gas-ct', 1, cellAtLonLat(-83.08, 32.45))
    const surface = { grid: fixtures().grid, parcels: [] }
    const p = planCorridor(surface, plantNodeOf(g), node(g, CAMPUS), '230d')!
    expect(p.takings.parcelsAffected).toBeGreaterThan(5)
  })
})

describe('planning', () => {
  it('prices length, land and schedule together', () => {
    const p = plan(withPlants())
    expect(p.lengthKm).toBeGreaterThan(8)
    expect(p.rowAppraised).toBeGreaterThan(1_000_000)
    expect(p.lineCapex).toBeGreaterThan(p.lengthKm * 1_000_000)
    expect(p.buildQuarters).toBeGreaterThanOrEqual(2)
  })

  it('keeps the route when only the voltage changes', () => {
    const p = plan(withPlants())
    const big = repricePlan(sumterSurface(), p, '500')
    expect(big.centerline).toEqual(p.centerline)
    expect(big.takings.totalAcres).toBeGreaterThan(p.takings.totalAcres)
    expect(big.lineCapex).toBeGreaterThan(p.lineCapex)
  })

  it('does not change the game until filed', () => {
    const g = withPlants()
    const before = JSON.stringify(g)
    plan(g)
    expect(JSON.stringify(g)).toBe(before)
  })
})

describe('acquisition', () => {
  const filed = (): GameState => {
    const g = withPlants()
    return commitCorridor(g, plan(g))
  }

  it('opens a deal for every parcel', () => {
    const c = filed().corridors[0]
    expect(Object.keys(c.deals)).toHaveLength(Object.keys(c.takings).length)
    expect(Object.keys(c.deals).length).toBeGreaterThan(20)
  })

  it('splits owners at a fair offer', () => {
    let g = filed()
    g = run(offerAll(g, g.corridors[0].id, 1.6), 1)
    const deals = Object.values(g.corridors[0].deals)
    expect(deals.filter((d) => d.status === 'accepted').length).toBeGreaterThan(3)
    expect(deals.filter((d) => d.status === 'holdout').length).toBeGreaterThan(3)
    expect(g.record.rowPaid).toBeGreaterThan(0)
  })

  it('can offer to one owner type only', () => {
    let g = filed()
    g = offerAll(g, g.corridors[0].id, 1.5, 'timber')
    const c = g.corridors[0]
    for (const [id, d] of Object.entries(c.deals)) {
      expect(d.status === 'offered').toBe(c.parcels[id].archetype === 'timber')
    }
  })

  it('lets one refusal at the cap leave the rest of the group open', () => {
    let g = filed()
    const c = g.corridors[0]
    const farms = Object.keys(c.deals).filter((id) => c.parcels[id].archetype === 'row-crop')
    c.deals[farms[0]] = { ...c.deals[farms[0]], status: 'holdout', refusedAt: 6, refusals: 1 }
    g = offerAll(g, c.id, 1.8, 'row-crop')
    const after = g.corridors[0].deals
    expect(after[farms[0]].status).toBe('holdout')
    expect(farms.slice(1).every((id) => after[id].status === 'offered')).toBe(true)
  })

  it('can change an offer before the quarter ends', () => {
    let g = filed()
    g = offerAll(g, g.corridors[0].id, 1.4, 'timber')
    g = offerAll(g, g.corridors[0].id, 1.9, 'timber')
    const sent = Object.values(g.corridors[0].deals).filter((d) => d.status === 'offered')
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.every((d) => d.offerMultiple === 1.9)).toBe(true)
  })

  it('does not reward sending the same offer again', () => {
    let g = filed()
    g = run(offerAll(g, g.corridors[0].id, 1.5), 1)
    const signedNow = () => Object.values(g.corridors[0].deals).filter((d) => d.status === 'accepted').length
    const first = signedNow()
    for (let i = 0; i < 4; i++) g = run(offerAll(g, g.corridors[0].id, 1.5), 1)
    expect(signedNow() - first).toBeLessThanOrEqual(2)
  })

  it('costs more in total to open with a high blanket offer', () => {
    const ladder = acquire(filed(), [1.3, 1.7, 2.2, 3, 4])
    const blanket = acquire(filed(), [4, 6])
    expect(blanket.record.rowPaid).toBeGreaterThan(ladder.record.rowPaid * 1.4)
  })

  it('leaves somebody who will not sell at the top offer', () => {
    let refused = 0
    for (const seed of [1, 2, 3, 4]) {
      let g = site(signed(seed), 'gas-ct', 3)
      g = commitCorridor(g, plan(g))
      g = run(offerAll(g, g.corridors[0].id, 6), 1)
      refused += outstandingHoldouts(g.corridors[0]).length
    }
    expect(refused).toBeGreaterThan(0)
  })

  it('keeps condemnations on the record after the route is abandoned', () => {
    let g = filed()
    for (const id of Object.keys(g.corridors[0].deals).slice(0, 3)) g = condemn(g, g.corridors[0].id, id)
    g = abandonCorridor(g, g.corridors[0].id)
    expect(g.corridors).toHaveLength(0)
    expect(g.record.condemnations).toBe(3)
  })

  it('charges for condemnation in money, approval and time', () => {
    let g = filed()
    const id = Object.keys(g.corridors[0].deals)[0]
    const before = g
    g = condemn(g, g.corridors[0].id, id)
    expect(g.cash).toBeLessThan(before.cash)
    expect(g.contract.approval!).toBeLessThan(before.contract.approval!)
    expect(g.corridors[0].deals[id].condemnationQuarters).toBeGreaterThanOrEqual(2)
    const appraised = g.corridors[0].takings[id].appraisedTotal
    g = run(g, 5)
    expect(g.corridors[0].deals[id].status).toBe('condemned')
    expect(g.corridors[0].deals[id].paid).toBeGreaterThan(appraised)
  })

})

describe('connection', () => {
  it('needs the line to reach the plant that has the capacity', () => {
    let g = withPlants()
    const p = planCorridor(sumterSurface(), node(g, SUBSTATION), node(g, CAMPUS), '500')!
    g = commitCorridor(g, p)
    for (const c of g.corridors) c.status = 'energized'
    for (const x of g.plants) x.status = 'online'
    expect(firmDeliverableMw(g)).toBe(0)
    g.energizedQuarter = null
    expect(run(g, 1).energizedQuarter).toBeNull()
  })

  it('is limited by the smallest line on the way', () => {
    let g = withPlants()
    g = commitCorridor(g, plan(g, '115'))
    g.corridors[0].status = 'energized'
    for (const x of g.plants) x.status = 'online'
    expect(firmDeliverableMw(g)).toBe(150)
  })

  it('energizes a complete project', () => {
    const g = build({ classId: '230d' })
    expect(g.phase).toBe('operate')
    expect(g.contract.status).toBe('served')
    expect(g.contract.milestones.every((m) => m.released)).toBe(true)
    expect(acquisitionComplete(g.corridors[0])).toBe(true)
  })

  it('replays the same from the same seed', () => {
    expect(JSON.stringify(build({ seed: 11 }))).toBe(JSON.stringify(build({ seed: 11 })))
    expect(JSON.stringify(build({ seed: 11 }).corridors)).not.toBe(JSON.stringify(build({ seed: 12 }).corridors))
  })
})

describe('generated owners', () => {
  it('includes land that cannot be taken', () => {
    const kinds = new Set(sumterParcels().map((p) => p.archetype))
    expect(kinds.has('historic')).toBe(true)
    expect(kinds.has('public')).toBe(true)
    expect(kinds.has('industrial')).toBe(true)
  })
})
