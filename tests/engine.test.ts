import { describe, it, expect, beforeEach } from 'vitest'
import { fixtures, cellAtLonLat } from './helpers/loadFixtures.ts'
import { AMERICUS } from '../src/data/scenarios.ts'
import { createGame, capacitySummary, resetPlantCounter, quartersToDeadline, canFinishInTime } from '../src/engine/state.ts'
import { endQuarter, acceptContract, deliverableMw } from '../src/engine/turn/resolve.ts'
import { sitePlant, assessSite } from '../src/engine/turn/siting.ts'
import { plantType } from '../src/data/plants.ts'
import type { GameState } from '../src/engine/types.ts'
import { quarterOf } from '../src/engine/time.ts'
import { Rng } from '../src/engine/rng.ts'

/** A cell just outside Americus, in Sumter County. */
const AMERICUS_SITE = () => cellAtLonLat(-84.187, 32.113)
/** A rural cell in Sumter County, well away from town. */
const RURAL_SUMTER = () => cellAtLonLat(-84.30, 32.16)

function newGame(): GameState {
  const { counties } = fixtures()
  resetPlantCounter()
  return createGame(AMERICUS, AMERICUS_SITE(), counties)
}

function run(state: GameState, n: number): GameState {
  let s = state
  for (let i = 0; i < n; i++) s = endQuarter(s).state
  return s
}

beforeEach(() => resetPlantCounter())

describe('scenario setup', () => {
  it('places the Americus campus in Sumter County', () => {
    const { grid } = fixtures()
    const game = newGame()
    const countyIdx = grid.county[game.contract.siteCell]
    expect(grid.manifest.counties[countyIdx].name).toBe('Sumter')
    expect(game.contract.countyFips).toBe('13261')
  })

  it('starts at 2026 Q1 with a 2029 Q4 deadline', () => {
    const game = newGame()
    expect(game.quarter).toBe(quarterOf(2026, 1))
    expect(game.contract.inServiceQuarter).toBe(quarterOf(2029, 4))
    // Sixteen quarters is enough for a combined-cycle plant, but not by much.
    expect(quartersToDeadline(game)).toBe(15)
  })

  it('gives every Georgia county an approval score', () => {
    const game = newGame()
    expect(Object.keys(game.counties)).toHaveLength(159)
    expect(game.counties['13261'].approval).toBe(62)
  })
})

describe('the deal', () => {
  it('releases the signing payment only once signed', () => {
    let game = newGame()
    expect(game.cash).toBe(0)

    game = acceptContract(game)
    expect(game.contract.status).toBe('accepted')
    // 20% of a $1.05B advance.
    expect(game.cash).toBeCloseTo(210_000_000, 0)
  })

  it('does not pay twice for the same milestone', () => {
    let game = acceptContract(newGame())
    const afterSigning = game.cash
    game = run(game, 4)
    const signingMilestone = game.contract.milestones.find((m) => m.id === 'signing')!
    expect(signingMilestone.released).toBe(true)
    // Cash only moved by construction/financing, not another signing payment.
    expect(game.cash).toBeLessThanOrEqual(afterSigning)
  })

  it('accrues a late penalty every quarter past the deadline, not once', () => {
    let game = acceptContract(newGame())
    // Run well past the in-service date without building anything.
    game = run(game, 18)
    expect(game.energizedQuarter).toBeNull()
    const quartersLate = game.quarter - game.contract.inServiceQuarter
    expect(quartersLate).toBeGreaterThan(1)
    expect(game.penaltiesAccrued).toBeCloseTo(
      quartersLate * game.contract.latePenaltyPerQuarter, 0,
    )
  })
})

describe('siting', () => {
  it('refuses a site outside Georgia', () => {
    const game = newGame()
    const { grid } = fixtures()
    // On the grid, but over the line in Alabama — Georgia Power cannot site here.
    const alabama = cellAtLonLat(-85.3, 31.6)
    expect(alabama).toBeGreaterThanOrEqual(0)
    const a = assessSite(game, 'gas-ct', alabama, grid)
    expect(a.ok).toBe(false)
    expect(a.blocker).toMatch(/Outside Georgia/)
  })

  it('refuses a cell that is off the map entirely', () => {
    const game = newGame()
    const { grid } = fixtures()
    const a = assessSite(game, 'gas-ct', -1, grid)
    expect(a.ok).toBe(false)
    expect(a.blocker).toMatch(/Outside the map/)
  })

  it('costs more approval near people than in open country', () => {
    const game = newGame()
    const { grid } = fixtures()
    const inTown = assessSite(game, 'gas-ct', AMERICUS_SITE(), grid)
    const outOfTown = assessSite(game, 'gas-ct', RURAL_SUMTER(), grid)
    expect(inTown.ok && outOfTown.ok).toBe(true)
    expect(inTown.approvalCost).toBeGreaterThan(outOfTown.approvalCost)
  })

  it('charges land cost and drops county approval when sited', () => {
    const { grid } = fixtures()
    let game = acceptContract(newGame())
    const cashBefore = game.cash
    const approvalBefore = game.counties['13261'].approval

    game = sitePlant(game, 'gas-ct', RURAL_SUMTER(), grid)
    expect(game.plants).toHaveLength(1)
    expect(game.plants[0].countyFips).toBe('13261')
    expect(game.cash).toBeLessThan(cashBefore)
    expect(game.counties['13261'].approval).toBeLessThan(approvalBefore)
  })
})

describe('construction', () => {
  it('permits, then builds, then comes online', () => {
    const { grid } = fixtures()
    const t = plantType('gas-ct')
    let game = sitePlant(acceptContract(newGame()), 'gas-ct', RURAL_SUMTER(), grid)

    expect(game.plants[0].status).toBe('permitting')

    // Sumter starts supportive, so permitting should not stall.
    game = run(game, t.permitQuarters)
    expect(game.plants[0].status).toBe('construction')

    game = run(game, t.buildQuarters)
    expect(game.plants[0].status).toBe('online')
    expect(game.plants[0].commissionedQuarter).not.toBeNull()
  })

  it('spends exactly the plant capex, no more and no less', () => {
    const { grid } = fixtures()
    const t = plantType('gas-ct')
    let game = sitePlant(acceptContract(newGame()), 'gas-ct', RURAL_SUMTER(), grid)
    game = run(game, t.permitQuarters + t.buildQuarters)

    const plant = game.plants[0]
    expect(plant.status).toBe('online')
    expect(plant.capexSpent).toBeCloseTo(plant.capexTotal, 2)
  })

  it('never produces NaN in the books', () => {
    const { grid } = fixtures()
    let game = sitePlant(acceptContract(newGame()), 'gas-ccgt', RURAL_SUMTER(), grid)
    game = run(game, 24)
    expect(Number.isFinite(game.cash)).toBe(true)
    expect(Number.isFinite(game.financingCost)).toBe(true)
    expect(Number.isFinite(game.penaltiesAccrued)).toBe(true)
    for (const p of game.plants) {
      expect(Number.isFinite(p.capexSpent)).toBe(true)
    }
  })
})

describe('firm capacity is the thing that matters', () => {
  it('counts only a fraction of solar toward serving the contract', () => {
    const { grid } = fixtures()
    const solar = plantType('solar')
    let game = acceptContract(newGame())
    // Build enough solar nameplate to cover 400 MW on paper.
    for (let i = 0; i < 2; i++) {
      game = sitePlant(game, 'solar', RURAL_SUMTER(), grid)
    }
    game = run(game, solar.permitQuarters + solar.buildQuarters)

    const cap = capacitySummary(game)
    expect(cap.onlineNameplateMw).toBe(400)
    // ...but only ~8% of it is firm, so the contract is nowhere near served.
    expect(cap.onlineFirmMw).toBeLessThan(50)
    expect(game.energizedQuarter).toBeNull()
    expect(cap.shortfallMw).toBeGreaterThan(350)
  })

  it('does not energize on generation alone — the power needs a wire', () => {
    const { grid } = fixtures()
    const t = plantType('gas-ct')
    let game = acceptContract(newGame())
    // Three 200 MW turbines at 95% firm = 570 MW firm, comfortably over 400.
    for (let i = 0; i < 3; i++) game = sitePlant(game, 'gas-ct', RURAL_SUMTER(), grid)
    game = run(game, t.permitQuarters + t.buildQuarters)

    expect(capacitySummary(game).onlineFirmMw).toBeGreaterThan(400)
    // …and yet nothing is served, because there is no corridor to the campus.
    expect(deliverableMw(game)).toBe(0)
    expect(game.energizedQuarter).toBeNull()
  })

  it('warns when a technology cannot be finished in time', () => {
    let game = newGame()
    // Burn most of the schedule.
    game = run(acceptContract(game), 12)
    expect(canFinishInTime(game, plantType('gas-ccgt'))).toBe(false)
    expect(canFinishInTime(game, plantType('solar'))).toBe(false)
  })
})

describe('determinism', () => {
  it('produces identical state from the same seed and the same moves', () => {
    const { grid } = fixtures()
    const play = (): GameState => {
      resetPlantCounter()
      const { counties } = fixtures()
      let g = createGame(AMERICUS, AMERICUS_SITE(), counties)
      g = acceptContract(g)
      g = sitePlant(g, 'gas-ct', RURAL_SUMTER(), grid)
      g = run(g, 14)
      g = sitePlant(g, 'solar', RURAL_SUMTER(), grid)
      return run(g, 8)
    }
    expect(JSON.stringify(play())).toEqual(JSON.stringify(play()))
  })

  it('diverges when the seed differs', () => {
    const { counties, grid } = fixtures()
    const play = (seed: number): GameState => {
      resetPlantCounter()
      let g = createGame({ ...AMERICUS, seed }, AMERICUS_SITE(), counties)
      g.rngState = seed
      g = acceptContract(g)
      // Site in a hostile county so permit stalls (which are random) can differ.
      g = sitePlant(g, 'gas-ct', RURAL_SUMTER(), grid)
      g.counties['13261'].approval = 18
      return run(g, 10)
    }
    // Not a guarantee for every pair of seeds, but these two do diverge.
    expect(JSON.stringify(play(1))).not.toEqual(JSON.stringify(play(999)))
  })

  it('does not mutate the state it is given', () => {
    const before = acceptContract(newGame())
    const snapshot = JSON.stringify(before)
    endQuarter(before)
    expect(JSON.stringify(before)).toEqual(snapshot)
  })

  it('advances the RNG cursor when a random decision is made', () => {
    const { grid } = fixtures()
    let game = sitePlant(acceptContract(newGame()), 'gas-ct', RURAL_SUMTER(), grid)
    // A county this unhappy rolls against a permit stall every quarter.
    game.counties['13261'].approval = 18
    const next = endQuarter(game).state
    expect(next.rngState).not.toBe(game.rngState)
  })
})

describe('rng', () => {
  it('is reproducible and stays in range', () => {
    const a = new Rng(42)
    const b = new Rng(42)
    for (let i = 0; i < 200; i++) {
      const v = a.next()
      expect(v).toBe(b.next())
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('keeps int() within bounds inclusive', () => {
    const r = new Rng(7)
    for (let i = 0; i < 500; i++) {
      const v = r.int(3, 6)
      expect(v).toBeGreaterThanOrEqual(3)
      expect(v).toBeLessThanOrEqual(6)
    }
  })
})
