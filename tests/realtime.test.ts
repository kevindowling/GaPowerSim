import { describe, it, expect } from 'vitest'
import { fixtures, cellAtLonLat } from './helpers/loadFixtures.ts'
import { AMERICUS } from '../src/data/scenarios.ts'
import { createGame, resetPlantCounter } from '../src/engine/state.ts'
import { acceptContract } from '../src/engine/turn/resolve.ts'
import { sitePlant } from '../src/engine/turn/siting.ts'
import { createRealtimeState, TICKS_PER_DAY, type RealtimeState } from '../src/engine/realtime/types.ts'
import {
  customerShape, solarFraction, ambientC, loadAt, hourOfDay, dayOfYear,
  customerLoadForPopulation,
} from '../src/engine/realtime/load.ts'
import {
  dispatch, availableMw, deliverableMw, marketPrice,
} from '../src/engine/realtime/dispatch.ts'
import {
  tripProbability, distanceToCenterline, stormDamageChance, capacityDerates, outAssets,
} from '../src/engine/realtime/reliability.ts'
import { stepRealtime, reliabilityIndices } from '../src/engine/realtime/operate.ts'
import { lineClass, type LineClassId } from '../src/data/transmission.ts'
import type { GameState, Corridor } from '../src/engine/types.ts'
import { Rng } from '../src/engine/rng.ts'

const PLANT_SITE = () => cellAtLonLat(-84.36, 32.02)
const CAMPUS = () => cellAtLonLat(-84.187, 32.113)
const BOUNDS = { minX: -100, minY: -80, maxX: -30, maxY: -20 }

/** A game with generation online and a corridor energized, ready to operate. */
function operatingGame(classId: LineClassId = '230', turbines = 3): GameState {
  const { counties, grid } = fixtures()
  resetPlantCounter()
  let g = acceptContract(createGame(AMERICUS, CAMPUS(), counties))
  for (let i = 0; i < turbines; i++) g = sitePlant(g, 'gas-ct', PLANT_SITE(), grid)
  for (const p of g.plants) {
    p.status = 'online'
    p.quartersRemaining = 0
    p.commissionedQuarter = 0
    p.capexSpent = p.capexTotal
  }

  const corridor: Corridor = {
    id: 'corridor-1',
    name: 'test corridor',
    classId,
    cells: [],
    centerline: [[-70, -50], [-50, -45]],
    lengthKm: 21,
    status: 'energized',
    deals: {},
    takings: {},
    condemnations: 0,
    legalCosts: 0,
    rowPaid: 0,
    capexTotal: 0,
    capexSpent: 0,
    buildQuartersRemaining: 0,
    delayQuarters: 0,
  }
  g.corridors.push(corridor)
  g.energizedQuarter = 0
  g.phase = 'operate'
  g.realtime = createRealtimeState()
  return g
}

describe('load shape', () => {
  it('runs the clock and calendar correctly', () => {
    expect(hourOfDay(0)).toBe(0)
    expect(hourOfDay(4)).toBe(1)
    expect(hourOfDay(TICKS_PER_DAY)).toBe(0)
    expect(dayOfYear(TICKS_PER_DAY * 3)).toBe(3)
  })

  it('peaks in the evening and troughs overnight', () => {
    const at = (h: number) => customerShape(Math.round(h * 4))
    expect(at(18.5)).toBeGreaterThan(at(3))
    expect(at(18.5)).toBeGreaterThan(at(12))
    expect(at(3)).toBeLessThan(1)
  })

  it('peaks in summer, because south Georgia is air conditioning', () => {
    const summerEvening = customerShape(200 * TICKS_PER_DAY + 74)
    const springEvening = customerShape(100 * TICKS_PER_DAY + 74)
    expect(summerEvening).toBeGreaterThan(springEvening)
  })

  it('produces no solar at night and a midday peak', () => {
    expect(solarFraction(0)).toBe(0)          // midnight
    expect(solarFraction(4 * 3)).toBe(0)      // 3am
    expect(solarFraction(4 * 12)).toBeGreaterThan(0.5)
    expect(solarFraction(4 * 23)).toBe(0)
  })

  it('is hotter in August than January, and warmer at 3pm than 5am', () => {
    expect(ambientC(200 * TICKS_PER_DAY + 60)).toBeGreaterThan(ambientC(10 * TICKS_PER_DAY + 60))
    expect(ambientC(4 * 15)).toBeGreaterThan(ambientC(4 * 5))
  })

  it('keeps the data centre flat while customers swing', () => {
    const customerAvg = customerLoadForPopulation(42_000)
    const night = loadAt(4 * 3, 400, customerAvg)
    const evening = loadAt(4 * 19, 400, customerAvg)

    // The campus barely moves...
    expect(Math.abs(evening.contractMw - night.contractMw) / night.contractMw).toBeLessThan(0.15)
    // ...while the neighbourhood nearly doubles.
    expect(evening.customerMw).toBeGreaterThan(night.customerMw * 1.3)
  })
})

describe('dispatch', () => {
  it('derates thermal plants as the air warms', () => {
    const g = operatingGame()
    const plant = g.plants[0]
    const cool = availableMw(plant, 0, 15, false)
    const hot = availableMw(plant, 0, 38, false)
    expect(cool).toBe(plant.nameplateMw)
    expect(hot).toBeLessThan(cool)
  })

  it('gives nothing from a unit that is out', () => {
    const g = operatingGame()
    expect(availableMw(g.plants[0], 0, 20, true)).toBe(0)
  })

  it('runs the cheapest generation first', () => {
    const g = operatingGame()
    const customerAvg = customerLoadForPopulation(42_000)
    const load = loadAt(4 * 12, 400, customerAvg)
    const result = dispatch(g, load, 4 * 12, new Set(), 'proportional')
    // Three turbines at 200 MW cover 400 MW of campus plus the town.
    expect(result.generationMw).toBeGreaterThan(400)
    expect(result.marketMw).toBeLessThan(1)
    expect(result.fuelCost).toBeGreaterThan(0)
  })

  it('buys from the market when generation is short, and pays for it', () => {
    const g = operatingGame('230', 1) // only 200 MW of plant against 400 MW of load
    const customerAvg = customerLoadForPopulation(42_000)
    const load = loadAt(4 * 19, 400, customerAvg)
    const result = dispatch(g, load, 4 * 19, new Set(), 'proportional')
    expect(result.marketMw).toBeGreaterThan(100)
    expect(result.marketCost).toBeGreaterThan(0)
    // Scarcity shows up in the price.
    expect(result.priceMwh).toBeGreaterThan(marketPrice(4 * 19, load.ambientC, 0))
  })

  it('cannot deliver more than the wire carries', () => {
    const g = operatingGame('230') // 400 MW rating
    const customerAvg = customerLoadForPopulation(42_000)
    const load = loadAt(0, 600, customerAvg) // ask for 600 MW
    const result = dispatch(g, load, 0, new Set(), 'proportional')
    expect(result.corridorLimited).toBe(true)
    expect(result.unservedContractMw).toBeGreaterThan(100)
  })

  it('honours the shedding policy when there is not enough to go round', () => {
    const g = operatingGame('115', 3) // 150 MW wire against a 400 MW campus
    const customerAvg = customerLoadForPopulation(42_000)
    const load = loadAt(4 * 19, 400, customerAvg)

    const homes = dispatch(g, load, 4 * 19, new Set(), 'protect-homes')
    const contract = dispatch(g, load, 4 * 19, new Set(), 'protect-contract')

    // Protecting homes costs the contract more; protecting the contract costs
    // the neighbourhood more. The choice is real in both directions.
    expect(homes.unservedCustomerMw).toBeLessThanOrEqual(contract.unservedCustomerMw)
    expect(homes.unservedContractMw).toBeGreaterThanOrEqual(contract.unservedContractMw)
  })
})

describe('reliability', () => {
  it('turns a forced-outage rate into a sane per-tick hazard', () => {
    const p = tripProbability(0.05, 18, false)
    expect(p).toBeGreaterThan(0)
    expect(p).toBeLessThan(0.01)
    // Deferring maintenance makes failure meaningfully more likely.
    expect(tripProbability(0.05, 18, true)).toBeGreaterThan(p)
  })

  it('measures distance from a storm to a line', () => {
    const line: Array<[number, number]> = [[0, 0], [10, 0]]
    expect(distanceToCenterline(5, 3, line)).toBeCloseTo(3, 6)
    expect(distanceToCenterline(5, 0, line)).toBeCloseTo(0, 6)
    // Past the end, distance is to the endpoint, not the infinite line.
    expect(distanceToCenterline(14, 0, line)).toBeCloseTo(4, 6)
  })

  it('rewards vegetation management', () => {
    const storm = {
      id: 's', x: 0, y: 0, vx: 1, vy: 0, radiusKm: 20,
      severity: 0.8, ticksRemaining: 10, name: 'test',
    }
    expect(stormDamageChance(storm, 1, false)).toBeLessThan(stormDamageChance(storm, 0, false))
    expect(stormDamageChance(storm, 0.5, true)).toBeGreaterThan(stormDamageChance(storm, 0.5, false))
  })

  it('treats a half-lost double circuit as derated, not dead', () => {
    const rt: RealtimeState = createRealtimeState()
    rt.outages.push({
      assetId: 'corridor-1', kind: 'corridor', cause: 'structure down',
      ticksRemaining: 20, capacityFraction: 0.5, crews: 0, startedTick: 0,
    })
    // Half capacity is not an outage — the line is still carrying.
    expect(outAssets(rt).has('corridor-1')).toBe(false)
    expect(capacityDerates(rt).get('corridor-1')).toBe(0.5)
  })

  it('takes the worst of two concurrent faults on one asset', () => {
    const rt = createRealtimeState()
    rt.outages.push(
      { assetId: 'c', kind: 'corridor', cause: 'a', ticksRemaining: 5, capacityFraction: 0.5, crews: 0, startedTick: 0 },
      { assetId: 'c', kind: 'corridor', cause: 'b', ticksRemaining: 5, capacityFraction: 0, crews: 0, startedTick: 0 },
    )
    expect(capacityDerates(rt).get('c')).toBe(0)
  })
})

describe('redundancy is what the extra money bought', () => {
  it('keeps the campus up on a double circuit that a single circuit would lose', () => {
    const single = operatingGame('230')
    const double = operatingGame('230d')
    const customerAvg = customerLoadForPopulation(42_000)
    const load = loadAt(0, 400, customerAvg)

    // Same storm, same damage: one circuit down.
    const singleDown = new Map([['corridor-1', 0]])       // 1 of 1 circuits
    const doubleHalf = new Map([['corridor-1', 0.5]])     // 1 of 2 circuits

    const singleResult = dispatch(single, load, 0, new Set(['corridor-1']), 'proportional', singleDown)
    const doubleResult = dispatch(double, load, 0, new Set(), 'proportional', doubleHalf)

    // The single-circuit campus goes dark.
    expect(singleResult.unservedContractMw).toBeGreaterThan(300)
    // The double-circuit campus rides it out: 800 MW rating, half of it is 400.
    expect(doubleResult.unservedContractMw).toBeLessThan(1)
  })

  it('rates a double circuit at twice a single one', () => {
    const single = deliverableMw(operatingGame('230').corridors, new Map())
    const double = deliverableMw(operatingGame('230d').corridors, new Map())
    expect(double).toBe(single * 2)
    expect(single).toBe(lineClass('230').ratingMw)
  })
})

describe('the operate loop', () => {
  it('serves the load, bills the fuel, and logs the intervals', () => {
    const g = operatingGame()
    const cashBefore = g.cash
    for (let i = 0; i < 96; i++) stepRealtime(g, BOUNDS)

    const rt = g.realtime!
    expect(rt.tick).toBe(96)
    expect(rt.servedMwh).toBeGreaterThan(0)
    expect(rt.fuelCost).toBeGreaterThan(0)
    expect(g.cash).toBeLessThan(cashBefore)
    expect(rt.history.length).toBe(96)
    expect(rt.history[0].loadMw).toBeGreaterThan(0)
  })

  it('caps the history window rather than growing without bound', () => {
    const g = operatingGame()
    for (let i = 0; i < 400; i++) stepRealtime(g, BOUNDS)
    expect(g.realtime!.history.length).toBe(192)
  })

  it('never produces NaN over a long run', () => {
    const g = operatingGame('230', 2)
    for (let i = 0; i < 2_000; i++) stepRealtime(g, BOUNDS)
    const rt = g.realtime!
    for (const v of [rt.servedMwh, rt.fuelCost, rt.marketCost, rt.unservedContractMwh, g.cash]) {
      expect(Number.isFinite(v)).toBe(true)
    }
    for (const r of rt.history) {
      expect(Number.isFinite(r.loadMw)).toBe(true)
      expect(Number.isFinite(r.priceMwh)).toBe(true)
    }
  })

  it('breaks things, and fixes them again', () => {
    const g = operatingGame()
    g.realtime!.maintenanceDeferred = true
    g.realtime!.vegetationSpend = 0

    let sawOutage = false
    let sawRestore = false
    for (let i = 0; i < 4_000; i++) {
      const { events } = stepRealtime(g, BOUNDS)
      if (events.some((e) => /tripped offline|line down|circuit lost/.test(e))) sawOutage = true
      if (events.some((e) => /restored to service/.test(e))) sawRestore = true
      if (sawOutage && sawRestore) break
    }
    expect(sawOutage).toBe(true)
    expect(sawRestore).toBe(true)
  })

  it('fails more often with maintenance deferred than without', () => {
    const count = (deferred: boolean): number => {
      const g = operatingGame()
      g.rngState = 4242
      g.realtime!.maintenanceDeferred = deferred
      g.realtime!.vegetationSpend = 0.5
      let outages = 0
      for (let i = 0; i < 3_000; i++) {
        outages += stepRealtime(g, BOUNDS).events.filter((e) => /tripped offline/.test(e)).length
      }
      return outages
    }
    expect(count(true)).toBeGreaterThan(count(false))
  })

  it('reports reliability the way a utility would', () => {
    const g = operatingGame()
    for (let i = 0; i < TICKS_PER_DAY * 30; i++) stepRealtime(g, BOUNDS)
    const idx = reliabilityIndices(g.realtime!)
    expect(idx.daysOperated).toBeCloseTo(30, 0)
    expect(idx.contractAvailability).toBeGreaterThan(0)
    expect(idx.contractAvailability).toBeLessThanOrEqual(1)
    expect(idx.saidiMinutes).toBeGreaterThanOrEqual(0)
  })

  it('stays deterministic across identical runs', () => {
    const play = (): string => {
      const g = operatingGame()
      g.rngState = 99
      for (let i = 0; i < 500; i++) stepRealtime(g, BOUNDS)
      return JSON.stringify(g.realtime)
    }
    expect(play()).toEqual(play())
  })
})

describe('rng plumbing', () => {
  it('advances the cursor as the operate loop runs', () => {
    const g = operatingGame()
    const before = g.rngState
    for (let i = 0; i < 20; i++) stepRealtime(g, BOUNDS)
    expect(g.rngState).not.toBe(before)
  })

  it('spawns storms only inside the bounds it is given', () => {
    const rng = new Rng(7)
    // Exercised indirectly; the guard is that a storm never starts east of the map.
    const g = operatingGame()
    for (let i = 0; i < 1_500; i++) stepRealtime(g, BOUNDS)
    for (const s of g.realtime!.storms) {
      expect(s.y).toBeGreaterThanOrEqual(BOUNDS.minY - 1)
      expect(s.y).toBeLessThanOrEqual(BOUNDS.maxY + 1)
    }
    expect(rng.next()).toBeGreaterThanOrEqual(0)
  })
})
