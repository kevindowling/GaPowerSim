import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixtures, cellAtLonLat } from './helpers/loadFixtures.ts'
import { AMERICUS } from '../src/data/scenarios.ts'
import { createGame, resetPlantCounter } from '../src/engine/state.ts'
import { endQuarter, acceptContract, resolveHearing } from '../src/engine/turn/resolve.ts'
import { sitePlant } from '../src/engine/turn/siting.ts'
import {
  planCorridor, commitCorridor, offerAll, condemn,
  resetCorridorCounter, acquisitionComplete, outstandingHoldouts,
} from '../src/engine/turn/corridor.ts'
import {
  BEATS, currentBeat, advanceTutorial, tutorialFinished, HEARING_OPTIONS,
} from '../src/engine/tutorial.ts'
import { scoreScenario, scoreParts } from '../src/engine/scoring.ts'
import { stepRealtime } from '../src/engine/realtime/operate.ts'
import { inflateParcel, type Parcel, type ParcelFile } from '../src/engine/parcels/types.ts'
import { ownerNameFor } from '../src/engine/parcels/owners.ts'
import { plantType } from '../src/data/plants.ts'
import type { GameState } from '../src/engine/types.ts'
import type { LineClassId } from '../src/data/transmission.ts'

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data')
const CAMPUS = () => cellAtLonLat(-84.187, 32.113)
const PLANT_SITE = () => cellAtLonLat(-84.36, 32.02)
const BOUNDS = { minX: -100, minY: -80, maxX: -30, maxY: -20 }

let parcelsCache: Parcel[] | null = null
function sumterParcels(): Parcel[] {
  if (parcelsCache) return parcelsCache
  const file = JSON.parse(readFileSync(resolve(DATA, 'parcels/13261.json'), 'utf8')) as ParcelFile
  parcelsCache = file.parcels.map((w) => inflateParcel(w, file.countyFips, ownerNameFor))
  return parcelsCache
}

function newGame(): GameState {
  const { counties } = fixtures()
  resetPlantCounter()
  resetCorridorCounter()
  return createGame(AMERICUS, CAMPUS(), counties)
}

function run(state: GameState, n: number): GameState {
  let s = state
  const ctx = { parcels: new Map(sumterParcels().map((p) => [p.id, p])) }
  for (let i = 0; i < n; i++) s = endQuarter(s, ctx).state
  return s
}

function beatId(state: GameState): string | null {
  return currentBeat(state)?.id ?? null
}

/** Play the tutorial to the point the power is on. */
function playToEnergized(classId: LineClassId = '230'): GameState {
  const { grid } = fixtures()
  let g = acceptContract(newGame())
  for (let i = 0; i < 3; i++) g = sitePlant(g, 'gas-ct', PLANT_SITE(), grid)

  const plan = planCorridor(grid, PLANT_SITE(), CAMPUS(), classId, sumterParcels())!
  g = commitCorridor(g, plan, sumterParcels())

  for (let round = 0; round < 12 && !acquisitionComplete(g.corridors[0]); round++) {
    g = offerAll(g, g.corridors[0].id, 2.5 + round * 0.3)
    g = run(g, 1)
  }
  for (const id of outstandingHoldouts(g.corridors[0])) {
    g = condemn(g, g.corridors[0].id, id, sumterParcels().find((p) => p.id === id)!)
  }

  g = resolveHearing(g, HEARING_OPTIONS[0])
  const ct = plantType('gas-ct')
  return run(g, ct.permitQuarters + ct.buildQuarters + plan.buildQuarters + 10)
}

beforeEach(() => { resetPlantCounter(); resetCorridorCounter() })

describe('tutorial beats', () => {
  it('starts on the deal', () => {
    expect(beatId(newGame())).toBe('deal')
  })

  it('advances only when the player has actually done the thing', () => {
    let g = newGame()
    expect(beatId(g)).toBe('deal')

    // Ending a quarter without signing does not move it on.
    g = run(g, 1)
    expect(beatId(g)).toBe('deal')

    g = acceptContract(g)
    advanceTutorial(g)
    expect(beatId(g)).toBe('generation')
  })

  it('accepts committed capacity, not just capacity already online', () => {
    const { grid } = fixtures()
    let g = acceptContract(newGame())
    advanceTutorial(g)
    expect(beatId(g)).toBe('generation')

    // 570 MW firm under construction against a 400 MW contract.
    for (let i = 0; i < 3; i++) g = sitePlant(g, 'gas-ct', PLANT_SITE(), grid)
    advanceTutorial(g)
    expect(beatId(g)).toBe('route')
  })

  it('will not let solar alone satisfy the generation beat', () => {
    const { grid } = fixtures()
    let g = acceptContract(newGame())
    // 400 MW of solar nameplate is only ~32 MW firm.
    for (let i = 0; i < 2; i++) g = sitePlant(g, 'solar', PLANT_SITE(), grid)
    advanceTutorial(g)
    expect(beatId(g)).toBe('generation')
  })

  it('moves through routing, acquisition and holdouts in order', () => {
    const { grid } = fixtures()
    let g = acceptContract(newGame())
    for (let i = 0; i < 3; i++) g = sitePlant(g, 'gas-ct', PLANT_SITE(), grid)
    advanceTutorial(g)
    expect(beatId(g)).toBe('route')

    const plan = planCorridor(grid, PLANT_SITE(), CAMPUS(), '230', sumterParcels())!
    g = commitCorridor(g, plan, sumterParcels())
    advanceTutorial(g)
    expect(beatId(g)).toBe('acquire')

    g = offerAll(g, g.corridors[0].id, 2.2)
    g = run(g, 1)
    expect(beatId(g)).toBe('holdouts')

    for (let round = 0; round < 12 && !acquisitionComplete(g.corridors[0]); round++) {
      g = offerAll(g, g.corridors[0].id, 3 + round * 0.3)
      g = run(g, 1)
    }
    for (const id of outstandingHoldouts(g.corridors[0])) {
      g = condemn(g, g.corridors[0].id, id, sumterParcels().find((p) => p.id === id)!)
    }
    g = run(g, 5)
    expect(beatId(g)).toBe('hearing')
  })

  it('can be dismissed and stays dismissed', () => {
    const g = newGame()
    g.tutorial!.dismissed = true
    expect(currentBeat(g)).toBeNull()
  })
})

describe('the hearing', () => {
  it('blocks progress until it is answered', () => {
    const { grid } = fixtures()
    let g = acceptContract(newGame())
    for (let i = 0; i < 3; i++) g = sitePlant(g, 'gas-ct', PLANT_SITE(), grid)
    const plan = planCorridor(grid, PLANT_SITE(), CAMPUS(), '230', sumterParcels())!
    g = commitCorridor(g, plan, sumterParcels())
    for (let round = 0; round < 12 && !acquisitionComplete(g.corridors[0]); round++) {
      g = offerAll(g, g.corridors[0].id, 3)
      g = run(g, 1)
    }
    for (const id of outstandingHoldouts(g.corridors[0])) {
      g = condemn(g, g.corridors[0].id, id, sumterParcels().find((p) => p.id === id)!)
    }
    g = run(g, 5)
    expect(beatId(g)).toBe('hearing')

    // Ending quarters does not get past it — the hearing is not skippable, and
    // it does not matter how much of the rest of the project finishes meanwhile.
    g = run(g, 3)
    expect(beatId(g)).toBe('hearing')
    g = run(g, 3)
    expect(beatId(g)).toBe('hearing')

    g = resolveHearing(g, HEARING_OPTIONS[1])
    expect(beatId(g)).not.toBe('hearing')
    expect(g.tutorial!.hearingResolved).toBe(true)
  })

  it('prices each answer differently, in money and in goodwill', () => {
    let g = acceptContract(newGame())
    g.tutorial!.beat = 5

    const before = { cash: g.cash, approval: g.counties['13261'].approval }

    const payer = resolveHearing(g, HEARING_OPTIONS[0])
    expect(payer.cash).toBeLessThan(before.cash)
    expect(payer.counties['13261'].approval).toBeGreaterThan(before.approval)
    expect(payer.counties['13261'].grievances).toHaveLength(0)

    const ratepayers = resolveHearing(g, HEARING_OPTIONS[2])
    // Free on the budget, expensive everywhere else.
    expect(ratepayers.cash).toBe(before.cash)
    expect(ratepayers.counties['13261'].approval).toBeLessThan(before.approval)
    // And the county writes it down.
    expect(ratepayers.counties['13261'].grievances.length).toBeGreaterThan(0)
  })

  it('cannot be answered twice', () => {
    let g = acceptContract(newGame())
    g.tutorial!.beat = 5
    g = resolveHearing(g, HEARING_OPTIONS[0])
    const cash = g.cash
    g = resolveHearing(g, HEARING_OPTIONS[0])
    expect(g.cash).toBe(cash)
  })
})

describe('the scripted storm', () => {
  it('arrives on schedule and takes a single-circuit line down', () => {
    const g = playToEnergized('230')
    expect(g.energizedQuarter).not.toBeNull()
    g.tutorial!.stormAtTick = 10

    let campusWentDark = false
    for (let i = 0; i < 60; i++) {
      stepRealtime(g, BOUNDS)
      const last = g.realtime!.history[g.realtime!.history.length - 1]
      if (last && last.unservedMw > 100) campusWentDark = true
    }
    expect(g.tutorial!.stormFired).toBe(true)
    expect(campusWentDark).toBe(true)
  })

  it('is ridden out by a double circuit — the same storm, the other outcome', () => {
    const g = playToEnergized('230d')
    g.tutorial!.stormAtTick = 10

    let worstShortfall = 0
    for (let i = 0; i < 60; i++) {
      stepRealtime(g, BOUNDS)
      const last = g.realtime!.history[g.realtime!.history.length - 1]
      if (last) worstShortfall = Math.max(worstShortfall, last.unservedMw)
    }
    expect(g.tutorial!.stormFired).toBe(true)
    // 800 MW rating, half of it lost, still 400 MW — the whole campus.
    expect(worstShortfall).toBeLessThan(5)
  })

  it('only fires once', () => {
    const g = playToEnergized('230')
    g.tutorial!.stormAtTick = 5
    for (let i = 0; i < 400; i++) stepRealtime(g, BOUNDS)
    const scripted = g.realtime!.storms.filter((s) => s.id.startsWith('storm-tutorial'))
    expect(scripted.length).toBeLessThanOrEqual(1)
  })

  it('reaches the last beat and finishes', () => {
    const g = playToEnergized('230d')
    g.tutorial!.stormAtTick = 10
    for (let i = 0; i < 700; i++) {
      stepRealtime(g, BOUNDS)
      if (tutorialFinished(g)) break
    }
    expect(tutorialFinished(g)).toBe(true)
    expect(currentBeat(g)).toBeNull()
    expect(g.tutorial!.beat).toBe(BEATS.length)
  })
})

describe('scoring', () => {
  it('scores a clean run well and reports every currency', () => {
    const g = playToEnergized('230d')
    const outcome = scoreScenario(g)

    expect(outcome.score).toBeGreaterThan(0)
    expect(outcome.score).toBeLessThanOrEqual(100)
    expect(outcome.grade).toMatch(/^[ABCDF]$/)
    expect(outcome.headline.length).toBeGreaterThan(10)
    expect(outcome.lines.some((l) => l.label === 'Properties condemned')).toBe(true)
    expect(outcome.lines.some((l) => l.label === 'County approval')).toBe(true)
  })

  it('penalises condemnation separately from approval', () => {
    const clean = playToEnergized('230')
    const parts = scoreParts(clean)

    const forced = structuredClone(clean)
    forced.corridors[0].condemnations = 3
    // The county has forgiven you; the record still exists.
    expect(scoreParts(forced).restraint).toBeLessThan(parts.restraint)
    expect(scoreParts(forced).community).toBe(parts.community)
  })

  it('says the uncomfortable thing when the run earned it', () => {
    const g = playToEnergized('230')
    g.corridors[0].condemnations = 4
    expect(scoreScenario(g).headline).toMatch(/by force/)
  })

  it('calls out shedding homes to keep the contract whole', () => {
    const g = playToEnergized('230')
    g.realtime!.unservedCustomerMwh = 500
    const outcome = scoreScenario(g)
    expect(outcome.headline).toMatch(/dark/)
    expect(outcome.lines.some((l) => l.label === 'Homes left unserved')).toBe(true)
  })

  it('does not pretend a project that never energized went well', () => {
    let g = acceptContract(newGame())
    g = run(g, 24)
    const outcome = scoreScenario(g)
    expect(outcome.headline).toMatch(/never energized/)
    expect(scoreParts(g).onTime).toBe(0)
  })
})
