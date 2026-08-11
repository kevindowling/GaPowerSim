import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixtures, cellAtLonLat } from './helpers/loadFixtures.ts'
import { AMERICUS } from '../src/data/scenarios.ts'
import { createGame, resetPlantCounter, capacitySummary } from '../src/engine/state.ts'
import { endQuarter, acceptContract, deliverableMw } from '../src/engine/turn/resolve.ts'
import { sitePlant } from '../src/engine/turn/siting.ts'
import {
  planCorridor, commitCorridor, offerAll, condemn, abandonCorridor,
  resetCorridorCounter, acquisitionComplete, outstandingHoldouts,
} from '../src/engine/turn/corridor.ts'
import { findRoute, cellCost, DEFAULT_WEIGHTS } from '../src/engine/geo/routing.ts'
import { inflateParcel, type Parcel, type ParcelFile } from '../src/engine/parcels/types.ts'
import { ownerNameFor } from '../src/engine/parcels/owners.ts'
import { plantType } from '../src/data/plants.ts'
import type { GameState } from '../src/engine/types.ts'

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data')

let parcelsCache: Parcel[] | null = null
function sumterParcels(): Parcel[] {
  if (parcelsCache) return parcelsCache
  const file = JSON.parse(readFileSync(resolve(DATA, 'parcels/13261.json'), 'utf8')) as ParcelFile
  parcelsCache = file.parcels.map((w) => inflateParcel(w, file.countyFips, ownerNameFor))
  return parcelsCache
}

const CAMPUS = () => cellAtLonLat(-84.187, 32.113)   // the data centre site
const PLANT_SITE = () => cellAtLonLat(-84.36, 32.02) // open country west of Americus

function newGame(): GameState {
  const { counties } = fixtures()
  resetPlantCounter()
  resetCorridorCounter()
  return acceptContract(createGame(AMERICUS, CAMPUS(), counties))
}

function parcelMap(): Map<string, Parcel> {
  return new Map(sumterParcels().map((p) => [p.id, p]))
}

function run(state: GameState, n: number): GameState {
  let s = state
  const ctx = { parcels: parcelMap() }
  for (let i = 0; i < n; i++) s = endQuarter(s, ctx).state
  return s
}

beforeEach(() => { resetPlantCounter(); resetCorridorCounter() })

describe('routing', () => {
  it('finds a route across Sumter County', () => {
    const { grid } = fixtures()
    const route = findRoute(grid, PLANT_SITE(), CAMPUS())
    expect(route).not.toBeNull()
    expect(route!.cells[0]).toBe(PLANT_SITE())
    expect(route!.cells[route!.cells.length - 1]).toBe(CAMPUS())
    expect(route!.lengthKm).toBeGreaterThan(10)
  })

  it('will not route outside Georgia', () => {
    const { grid } = fixtures()
    const alabama = cellAtLonLat(-85.3, 31.6)
    expect(cellCost(grid, alabama, DEFAULT_WEIGHTS)).toBe(Infinity)
    expect(findRoute(grid, PLANT_SITE(), alabama)).toBeNull()
  })

  it('costs more to cross populated ground than open country', () => {
    const { grid } = fixtures()
    const town = cellAtLonLat(-84.233, 32.072)   // central Americus
    const country = cellAtLonLat(-84.36, 32.02)  // farmland
    expect(cellCost(grid, town, DEFAULT_WEIGHTS))
      .toBeGreaterThan(cellCost(grid, country, DEFAULT_WEIGHTS))
  })

  it('routes around people when told to care about them', () => {
    const { grid } = fixtures()
    const avoidPeople = findRoute(grid, PLANT_SITE(), CAMPUS(), {
      ...DEFAULT_WEIGHTS, population: 60,
    })!
    const ignorePeople = findRoute(grid, PLANT_SITE(), CAMPUS(), {
      ...DEFAULT_WEIGHTS, population: 0,
    })!
    // Caring about people buys a longer line. That is the whole trade.
    expect(avoidPeople.lengthKm).toBeGreaterThanOrEqual(ignorePeople.lengthKm)

    const density = (r: typeof avoidPeople) =>
      r.cells.reduce((s, c) => s + grid.population[c], 0) / r.cells.length
    expect(density(avoidPeople)).toBeLessThan(density(ignorePeople))
  })
})

describe('planning a corridor over real geometry', () => {
  it('prices the route, the land and the schedule together', () => {
    const { grid } = fixtures()
    const plan = planCorridor(grid, PLANT_SITE(), CAMPUS(), '230', sumterParcels())
    expect(plan).not.toBeNull()

    expect(plan!.lengthKm).toBeGreaterThan(10)
    expect(plan!.takings.parcelsAffected).toBeGreaterThan(5)
    expect(plan!.takings.totalAcres).toBeGreaterThan(0)
    expect(plan!.rowAppraised).toBeGreaterThan(0)
    expect(plan!.lineCapex).toBeGreaterThan(0)
    expect(plan!.buildQuarters).toBeGreaterThanOrEqual(2)

    // A 46 m right-of-way over this many km lands in a sane acreage band.
    const expectedAcres = plan!.lengthKm * 0.046 * 247.105
    expect(plan!.takings.totalAcres).toBeGreaterThan(expectedAcres * 0.5)
    expect(plan!.takings.totalAcres).toBeLessThan(expectedAcres * 1.5)
  })

  it('takes a wider swathe at 500 kV than at 115 kV', () => {
    const { grid } = fixtures()
    const small = planCorridor(grid, PLANT_SITE(), CAMPUS(), '115', sumterParcels())!
    const big = planCorridor(grid, PLANT_SITE(), CAMPUS(), '500', sumterParcels())!
    expect(big.takings.totalAcres).toBeGreaterThan(small.takings.totalAcres)
    expect(big.lineCapex).toBeGreaterThan(small.lineCapex)
  })

  it('costs nothing until it is committed', () => {
    const { grid } = fixtures()
    const game = newGame()
    const cashBefore = game.cash
    planCorridor(grid, PLANT_SITE(), CAMPUS(), '230', sumterParcels())
    expect(game.cash).toBe(cashBefore)
    expect(game.corridors).toHaveLength(0)
  })
})

describe('acquiring the right-of-way', () => {
  it('opens a deal for every affected parcel', () => {
    const { grid } = fixtures()
    const plan = planCorridor(grid, PLANT_SITE(), CAMPUS(), '230', sumterParcels())!
    const game = commitCorridor(newGame(), plan, sumterParcels())

    const corridor = game.corridors[0]
    expect(corridor.status).toBe('acquiring')
    expect(Object.keys(corridor.deals)).toHaveLength(plan.takings.parcelsAffected)
    expect(Object.keys(corridor.takings)).toHaveLength(plan.takings.parcelsAffected)
  })

  it('settles most owners at a fair offer, and leaves some holding out', () => {
    const { grid } = fixtures()
    const plan = planCorridor(grid, PLANT_SITE(), CAMPUS(), '230', sumterParcels())!
    let game = commitCorridor(newGame(), plan, sumterParcels())
    const cashBefore = game.cash

    // Four rounds of offers at a healthy premium.
    for (let round = 0; round < 4; round++) {
      game = offerAll(game, game.corridors[0].id, 1.6)
      game = run(game, 1)
    }

    const corridor = game.corridors[0]
    const accepted = Object.values(corridor.deals).filter((d) => d.status === 'accepted').length
    expect(accepted).toBeGreaterThan(0)
    expect(corridor.rowPaid).toBeGreaterThan(0)
    expect(game.cash).toBeLessThan(cashBefore)
  })

  it('condemnation costs money, time, approval — and hardens everyone else', () => {
    const { grid } = fixtures()
    const plan = planCorridor(grid, PLANT_SITE(), CAMPUS(), '230', sumterParcels())!
    let game = commitCorridor(newGame(), plan, sumterParcels())
    game = offerAll(game, game.corridors[0].id, 1.1)
    game = run(game, 1)

    const holdouts = outstandingHoldouts(game.corridors[0])
    expect(holdouts.length).toBeGreaterThan(0)

    const target = sumterParcels().find((p) => p.id === holdouts[0])!
    const approvalBefore = game.counties['13261'].approval
    const cashBefore = game.cash

    game = condemn(game, game.corridors[0].id, target.id, target)
    const corridor = game.corridors[0]

    expect(corridor.deals[target.id].status).toBe('condemning')
    expect(corridor.deals[target.id].condemnationQuarters).toBeGreaterThan(0)
    expect(corridor.condemnations).toBe(1)
    expect(corridor.legalCosts).toBeGreaterThan(0)
    expect(game.cash).toBeLessThan(cashBefore)
    expect(game.counties['13261'].approval).toBeLessThan(approvalBefore)
    expect(game.counties['13261'].grievances.length).toBeGreaterThan(0)
  })

  it('eventually takes the land, and the court is not a discount', () => {
    const { grid } = fixtures()
    const plan = planCorridor(grid, PLANT_SITE(), CAMPUS(), '230', sumterParcels())!
    let game = commitCorridor(newGame(), plan, sumterParcels())
    game = offerAll(game, game.corridors[0].id, 1.1)
    game = run(game, 1)

    const holdouts = outstandingHoldouts(game.corridors[0])
    const target = sumterParcels().find((p) => p.id === holdouts[0])!
    const appraised = game.corridors[0].takings[target.id].appraisedTotal

    game = condemn(game, game.corridors[0].id, target.id, target)
    game = run(game, 5)

    const deal = game.corridors[0].deals[target.id]
    expect(deal.status).toBe('condemned')
    // Juries award fair market value plus damages; taking by force costs more.
    expect(deal.paid).toBeGreaterThan(appraised)
  })

  it('lets the player walk away, and the sunk cost stays sunk', () => {
    const { grid } = fixtures()
    const plan = planCorridor(grid, PLANT_SITE(), CAMPUS(), '230', sumterParcels())!
    let game = commitCorridor(newGame(), plan, sumterParcels())
    game = offerAll(game, game.corridors[0].id, 2)
    game = run(game, 1)

    const spent = game.corridors[0].rowPaid
    expect(spent).toBeGreaterThan(0)
    const cashBefore = game.cash

    game = abandonCorridor(game, game.corridors[0].id)
    expect(game.corridors).toHaveLength(0)
    // Walking away refunds nothing.
    expect(game.cash).toBe(cashBefore)
  })
})

describe('the whole chain: generation, wire, load', () => {
  it('serves the contract only when both the plants and the line are done', () => {
    const { grid } = fixtures()
    const ct = plantType('gas-ct')
    let game = newGame()
    for (let i = 0; i < 3; i++) {
      game = sitePlant(game, 'gas-ct', PLANT_SITE(), grid)
    }

    const plan = planCorridor(grid, PLANT_SITE(), CAMPUS(), '230', sumterParcels())!
    game = commitCorridor(game, plan, sumterParcels())

    // Pay generously so acquisition converges rather than stalling on holdouts.
    for (let round = 0; round < 12 && !acquisitionComplete(game.corridors[0]); round++) {
      game = offerAll(game, game.corridors[0].id, 2.5 + round * 0.3)
      game = run(game, 1)
    }

    // Condemn anything still refusing, so the route can finish.
    for (const id of outstandingHoldouts(game.corridors[0])) {
      const parcel = sumterParcels().find((p) => p.id === id)!
      game = condemn(game, game.corridors[0].id, id, parcel)
    }
    game = run(game, ct.permitQuarters + ct.buildQuarters + plan.buildQuarters + 8)

    expect(capacitySummary(game).onlineFirmMw).toBeGreaterThanOrEqual(400)
    expect(deliverableMw(game)).toBeGreaterThanOrEqual(400)
    expect(game.corridors[0].status).toBe('energized')
    expect(game.energizedQuarter).not.toBeNull()
    expect(game.contract.status).toBe('served')
    expect(game.contract.milestones.every((m) => m.released)).toBe(true)
  })

  it('stays deterministic through a corridor playthrough', () => {
    const { grid } = fixtures()
    const play = (): GameState => {
      resetPlantCounter()
      resetCorridorCounter()
      const { counties } = fixtures()
      let g = acceptContract(createGame(AMERICUS, CAMPUS(), counties))
      g = sitePlant(g, 'gas-ct', PLANT_SITE(), grid)
      const plan = planCorridor(grid, PLANT_SITE(), CAMPUS(), '230', sumterParcels())!
      g = commitCorridor(g, plan, sumterParcels())
      g = offerAll(g, g.corridors[0].id, 1.4)
      return run(g, 6)
    }
    expect(JSON.stringify(play())).toEqual(JSON.stringify(play()))
  })
})
