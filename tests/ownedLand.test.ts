import { describe, it, expect } from 'vitest'
import { signed, site, node, sumterSurface, run } from './helpers/play.ts'
import { fixtures, cellAtLonLat } from './helpers/loadFixtures.ts'
import { planCorridor, commitCorridor, offerAll } from '../src/engine/turn/corridor.ts'
import { dropOwnedDeals, ownedCells, refreshSiteLinks } from '../src/engine/turn/ownedLand.ts'
import { cancelPlant, footprintCells, assessSite, cellPoint } from '../src/engine/turn/siting.ts'
import { CAMPUS, firmDeliverableMw, nodesRoutedToCampus, plantNode, sitesTouch, siteNode } from '../src/engine/realtime/network.ts'
import { multiPolyArea, corridorBuffer, centerlineLength } from '../src/engine/geo/polygon.ts'
import type { GameState } from '../src/engine/types.ts'

const grid = () => fixtures().grid
const COLS = () => grid().spec.cols
// West of Sumter, where parcels are generated on the fly.
const A = () => cellAtLonLat(-84.52, 32.20)

/** Two solar farms side by side. */
function pair(): GameState {
  let g = site(signed(), 'solar', 1, A())
  for (let d = 2; d < 6 && g.plants.length < 2; d++) g = site(g, 'solar', 1, A() + d)
  expect(g.plants).toHaveLength(2)
  return g
}

const surface = (g: GameState) => ({ ...sumterSurface(), owned: ownedCells(g, grid()) })

describe('land already bought', () => {
  it('is the ground a solar farm covers, and not the rest of a turbine cell', () => {
    const solar = site(signed(), 'solar', 1, A())
    expect(ownedCells(solar, grid()).size).toBe(6)
    expect(ownedCells(site(signed(), 'gas-ct', 1, A()), grid()).size).toBe(0)
  })

  it('needs no easement', () => {
    const g = pair()
    const [a, b] = g.plants.map((p) => node(g, siteNode(p.cell)))
    const before = planCorridor(sumterSurface(), a, b, '230')!
    const after = planCorridor(surface(g), a, b, '230')!
    expect(before.takings.parcelsAffected).toBeGreaterThan(0)
    expect(after.takings.totalAcres).toBeLessThan(before.takings.totalAcres * 0.5)
    const kept = multiPolyArea(after.takings.buffer)
    expect(kept).toBeLessThan(multiPolyArea(corridorBuffer(after.centerline, 0.023)))
  })

  it('still needs easements past the fence', () => {
    const g = pair()
    const p = planCorridor(surface(g), node(g, siteNode(g.plants[0].cell)), node(g, CAMPUS), '230')!
    expect(p.takings.parcelsAffected).toBeGreaterThan(20)
    expect(centerlineLength(p.centerline)).toBeGreaterThan(20)
  })

  it('clears open offers on an older line, and lets it proceed', () => {
    let g = pair()
    const [a, b] = g.plants.map((p) => node(g, siteNode(p.cell)))
    g = commitCorridor(g, planCorridor(sumterSurface(), a, b, '230')!)
    const before = Object.keys(g.corridors[0].deals).length
    g = offerAll(g, 'corridor-1', 1.5)
    dropOwnedDeals(g, grid())
    const left = Object.keys(g.corridors[0].deals).length
    expect(left).toBeLessThan(before)
    if (left === 0) expect(run(g, 1).corridors[0].status).toBe('building')
  })
})

describe('sites that touch', () => {
  it('are wired together', () => {
    const g = pair()
    expect(g.siteLinks).toHaveLength(1)
    expect(sitesTouch(g, plantNode(g.plants[0]), plantNode(g.plants[1]))).toBe(true)
  })

  it('share one line to the campus', () => {
    let g = pair()
    const p = planCorridor(surface(g), node(g, siteNode(g.plants[0].cell)), node(g, CAMPUS), '230')!
    g = commitCorridor(g, p)
    expect(nodesRoutedToCampus(g).has(plantNode(g.plants[1]))).toBe(true)
    for (const c of g.corridors) c.status = 'energized'
    for (const x of g.plants) x.status = 'online'
    expect(firmDeliverableMw(g)).toBeCloseTo(32, 6)
  })

  it('do not include sites apart from each other', () => {
    let g = site(signed(), 'solar', 1, A())
    g = site(g, 'solar', 1, A() + 14)
    expect(g.plants).toHaveLength(2)
    expect(g.siteLinks).toHaveLength(0)
    expect(sitesTouch(g, plantNode(g.plants[0]), plantNode(g.plants[1]))).toBe(false)
  })

  it('come apart when one is withdrawn', () => {
    const g = pair()
    expect(cancelPlant(g, g.plants[1].id).siteLinks).toHaveLength(0)
  })

  it('are found again in an older save', () => {
    const g = pair()
    delete g.siteLinks
    expect(nodesRoutedToCampus(g).size).toBe(2)
    refreshSiteLinks(g, grid())
    expect(g.siteLinks).toHaveLength(1)
  })

  it('never share ground', () => {
    const g = pair()
    const [x, y] = g.plants.map((p) => new Set(footprintCells(grid(), p.cell, 1400)))
    expect([...x].some((c) => y.has(c))).toBe(false)
    expect(assessSite(g, 'solar', g.plants[0].cell + 1, grid()).ok).toBe(false)
    expect(cellPoint(grid(), A())).toHaveLength(2)
    expect(COLS()).toBeGreaterThan(100)
  })
})
