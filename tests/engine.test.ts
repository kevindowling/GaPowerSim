import { describe, it, expect } from 'vitest'
import { fixtures, cellAtLonLat } from './helpers/loadFixtures.ts'
import { AMERICUS } from '../src/data/scenarios.ts'
import { capacitySummary, quartersToDeadline, canFinishInTime, headroom } from '../src/engine/state.ts'
import { endQuarter, acceptContract } from '../src/engine/turn/resolve.ts'
import { firmDeliverableMw } from '../src/engine/realtime/network.ts'
import { newGame, run } from './helpers/play.ts'
import {
  sitePlant, assessSite, cancelPlant, expeditePlant, footprintCells, CANCEL_LAND_RECOVERY,
} from '../src/engine/turn/siting.ts'
import { plantType } from '../src/data/plants.ts'
import type { GameState } from '../src/engine/types.ts'
import { quarterOf } from '../src/engine/time.ts'
import { Rng } from '../src/engine/rng.ts'

/** A rural cell in Sumter County, well away from town. */
const RURAL_SUMTER = () => cellAtLonLat(-84.30, 32.16)

describe('scenario setup', () => {
  it('places the Americus campus in Sumter County', () => {
    const { grid } = fixtures()
    const game = newGame()
    const countyIdx = grid.county[game.contract.siteCell]
    expect(grid.manifest.counties[countyIdx].name).toBe('Sumter')
    expect(game.contract.countyFips).toBe('13261')
  })

  it('starts after the events in its briefing', () => {
    const game = newGame()
    expect(game.quarter).toBe(quarterOf(2026, 3))
    expect(game.contract.inServiceQuarter).toBe(quarterOf(2029, 4))
    expect(quartersToDeadline(game)).toBe(13)
  })

  it('rates the data center and the counties bordering its own', () => {
    const game = newGame()
    expect(Object.keys(game.counties)).toHaveLength(159)
    expect(game.contract.approval!).toBe(62)
    const rated = Object.values(game.counties).filter((c) => c.approval !== undefined).map((c) => c.name).sort()
    expect(rated).toEqual(['Crisp', 'Dooly', 'Lee', 'Macon', 'Marion', 'Schley', 'Terrell', 'Webster'])
  })
})

describe('the deal', () => {
  it('releases the signing payment only once signed', () => {
    let game = newGame()
    expect(game.cash).toBe(0)

    game = acceptContract(game)
    expect(game.contract.status).toBe('accepted')
    expect(game.cash).toBeCloseTo(288_000_000, 0)
  })

  it('does not pay twice for the same milestone', () => {
    let game = acceptContract(newGame())
    const afterSigning = game.cash
    game = run(game, 4)
    const signingMilestone = game.contract.milestones.find((m) => m.id === 'signing')!
    expect(signingMilestone.released).toBe(true)
    // Cash only moved by construction/financing, not another signing payment.
    expect(game.contract.milestones.filter((m) => m.released)).toHaveLength(1)
    expect(game.cash).toBeLessThan(afterSigning + 36_000_000)
  })
})

describe('siting', () => {
  it('refuses a site outside Georgia', () => {
    const game = newGame()
    const { grid } = fixtures()
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
    const inTown = assessSite(game, 'gas-ct', cellAtLonLat(-84.26, 32.07), grid)
    const outOfTown = assessSite(game, 'gas-ct', RURAL_SUMTER(), grid)
    expect(inTown.ok && outOfTown.ok).toBe(true)
    expect(inTown.approvalCost).toBeGreaterThan(outOfTown.approvalCost)
  })

  it('charges land cost and drops county approval when sited', () => {
    const { grid } = fixtures()
    let game = acceptContract(newGame())
    const cashBefore = game.cash
    const approvalBefore = game.contract.approval!

    game = sitePlant(game, 'gas-ct', RURAL_SUMTER(), grid)
    expect(game.plants).toHaveLength(1)
    expect(game.plants[0].countyFips).toBe('13261')
    expect(game.cash).toBeLessThan(cashBefore)
    expect(game.contract.approval!).toBeLessThan(approvalBefore)
  })
})

describe('where plants cannot go', () => {
  const blocker = (type: Parameters<typeof assessSite>[1], lon: number, lat: number): string | null =>
    assessSite(acceptContract(newGame()), type, cellAtLonLat(lon, lat), fixtures().grid).blocker

  it('refuses towns, water, parks and the campus', () => {
    expect(blocker('gas-ccgt', -84.39, 33.75)).toMatch(/built-up/)
    expect(blocker('solar', -82.3, 30.8)).toMatch(/protected|wetland/)
    expect(blocker('gas-ct', -83.93, 31.89)).toMatch(/water/)
    expect(blocker('battery', -84.20729, 32.04854)).toMatch(/campus/)
  })

  it('only uprates existing reactors, and links them at the substation', () => {
    expect(blocker('nuclear-uprate', -84.3, 32.16)).toMatch(/Hatch or Plant Vogtle/)
    expect(blocker('nuclear-uprate', -82.344, 31.934)).toBeNull()
  })

  it('needs cooling water for combined cycle', () => {
    const { grid } = fixtures()
    const g = acceptContract(newGame())
    const near = assessSite(g, 'gas-ccgt', cellAtLonLat(-84.02, 32.06), grid)
    expect(near.ok).toBe(true)
    expect(near.extraCapex).toBe(0)
  })

  it('runs out of room on one site', () => {
    const { grid } = fixtures()
    let g = acceptContract(newGame())
    for (let i = 0; i < 12; i++) g = sitePlant(g, 'gas-ct', RURAL_SUMTER(), grid)
    expect(g.plants.length).toBe(6)
    expect(assessSite(g, 'gas-ct', RURAL_SUMTER(), grid).blocker).toMatch(/room/)
  })

  it('gives solar its real footprint', () => {
    const { grid } = fixtures()
    expect(footprintCells(grid, RURAL_SUMTER(), 1400).length).toBe(6)
    let g = sitePlant(acceptContract(newGame()), 'solar', RURAL_SUMTER(), grid)
    g = sitePlant(g, 'solar', RURAL_SUMTER(), grid)
    expect(g.plants).toHaveLength(1)
  })

  it('checks that the land can be paid for', () => {
    const g = acceptContract(newGame())
    g.cash = -g.creditLimit
    expect(assessSite(g, 'solar', RURAL_SUMTER(), fixtures().grid).blocker).toMatch(/cash or credit/)
  })
})

describe('expediting', () => {
  it('buys quarters, at a price, up to a limit', () => {
    const { grid } = fixtures()
    let g = sitePlant(acceptContract(newGame()), 'gas-ct', RURAL_SUMTER(), grid)
    expect(expeditePlant(g, g.plants[0].id)).toBe(g)
    g = run(g, 4)
    const before = g
    for (let i = 0; i < 5; i++) g = expeditePlant(g, g.plants[0].id)
    expect(before.plants[0].quartersRemaining - g.plants[0].quartersRemaining).toBe(2)
    expect(g.cash).toBeLessThan(before.cash - 20_000_000)
  })
})

describe('headroom', () => {
  it('counts money already promised', () => {
    const { grid } = fixtures()
    const g = acceptContract(newGame())
    const after = sitePlant(g, 'gas-ct', RURAL_SUMTER(), grid)
    expect(headroom(after)).toBeLessThan(headroom(g) - 225_000_000)
  })
})

describe('construction', () => {
  it('permits, then builds, then comes online', () => {
    const { grid } = fixtures()
    const t = plantType('gas-ct')
    let game = sitePlant(acceptContract(newGame()), 'gas-ct', RURAL_SUMTER(), grid)

    expect(game.plants[0].status).toBe('permitting')

    for (let i = 0; i < 6 && game.plants[0].status === 'permitting'; i++) game = run(game, 1)
    expect(game.plants[0].status).toBe('construction')

    for (let i = 0; i < t.buildQuarters + 5 && game.plants[0].status !== 'online'; i++) game = run(game, 1)
    expect(game.plants[0].status).toBe('online')
    expect(game.plants[0].commissionedQuarter).not.toBeNull()
  })

  it('spends exactly the plant capex, no more and no less', () => {
    const { grid } = fixtures()
    const t = plantType('gas-ct')
    let game = sitePlant(acceptContract(newGame()), 'gas-ct', RURAL_SUMTER(), grid)
    for (let i = 0; i < 20 && game.plants[0].status !== 'online'; i++) game = run(game, 1)
    expect(t.buildQuarters).toBeGreaterThan(0)

    const plant = game.plants[0]
    expect(plant.status).toBe('online')
    expect(plant.capexSpent).toBeCloseTo(plant.capexTotal, 2)
  })

  it('never produces NaN in the books', () => {
    const { grid } = fixtures()
    let game = sitePlant(acceptContract(newGame()), 'gas-ct', RURAL_SUMTER(), grid)
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
    game = sitePlant(game, 'solar', RURAL_SUMTER(), grid)
    game = sitePlant(game, 'solar', cellAtLonLat(-84.30, 32.22), grid)
    expect(game.plants).toHaveLength(2)
    game = run(game, solar.permitQuarters + solar.buildQuarters + 3)

    const cap = capacitySummary(game)
    expect(cap.onlineNameplateMw).toBe(400)
    // ...but only ~8% of it is firm, so the contract is nowhere near served.
    expect(cap.onlineFirmMw).toBeLessThan(50)
    expect(game.energizedQuarter).toBeNull()
    expect(cap.shortfallMw).toBeGreaterThan(350)
  })

  it('does not energize on generation alone: the power needs a wire', () => {
    const { grid } = fixtures()
    const t = plantType('gas-ct')
    let game = acceptContract(newGame())
    // Three 200 MW turbines at 95% firm = 570 MW firm, comfortably over 400.
    for (let i = 0; i < 3; i++) game = sitePlant(game, 'gas-ct', RURAL_SUMTER(), grid)
    for (const p of game.plants) p.status = 'online'
    game = run(game, 1)
    expect(t.nameplateMw).toBe(200)
    expect(capacitySummary(game).onlineFirmMw).toBeGreaterThan(400)
    // …and yet nothing is served, because there is no corridor to the campus.
    expect(firmDeliverableMw(game)).toBe(0)
    expect(game.energizedQuarter).toBeNull()
  })

  it('warns when a technology cannot be finished in time', () => {
    let game = newGame()
    // Burn most of the schedule.
    game = run(acceptContract(game), 9)
    expect(canFinishInTime(game, plantType('gas-ccgt'))).toBe(false)
    expect(canFinishInTime(game, plantType('solar'))).toBe(false)
  })
})

describe('determinism', () => {
  it('produces identical state from the same seed and the same moves', () => {
    const { grid } = fixtures()
    const play = (): GameState => {
      let g = acceptContract(newGame())
      g = sitePlant(g, 'gas-ct', RURAL_SUMTER(), grid)
      g = run(g, 14)
      g = sitePlant(g, 'solar', RURAL_SUMTER(), grid)
      return run(g, 8)
    }
    expect(JSON.stringify(play())).toEqual(JSON.stringify(play()))
  })

  it('diverges when the seed differs', () => {
    const { grid } = fixtures()
    const play = (seed: number): GameState => {
      let g = acceptContract(newGame(AMERICUS, seed))
      // Site in a hostile county so permit stalls (which are random) can differ.
      g = sitePlant(g, 'gas-ct', RURAL_SUMTER(), grid)
      g.contract.approval! = 18
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
    game.contract.approval! = 18
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

describe('changing your mind about a site', () => {
  it('withdraws a plant that has not broken ground, and gives most of the land back', () => {
    const before = acceptContract(newGame())
    const { grid } = fixtures()
    const sited = sitePlant(before, 'gas-ct', RURAL_SUMTER(), grid)
    const plant = sited.plants[0]

    expect(plant.status).toBe('permitting')
    expect(plant.landCost).toBeGreaterThan(0)
    expect(sited.cash).toBeLessThan(before.cash)

    const after = cancelPlant(sited, plant.id)
    expect(after.plants).toHaveLength(0)
    expect(after.cash - sited.cash).toBeCloseTo(plant.landCost * CANCEL_LAND_RECOVERY, 6)
    expect(after.cash).toBeLessThan(before.cash)
  })

  it('refuses once construction has started', () => {
    const { grid } = fixtures()
    let game = sitePlant(acceptContract(newGame()), 'gas-ct', RURAL_SUMTER(), grid)
    const id = game.plants[0].id

    for (let i = 0; i < 6 && game.plants[0].status === 'permitting'; i++) game = run(game, 1)
    expect(game.plants[0].status).not.toBe('permitting')

    const after = cancelPlant(game, id)
    expect(after).toBe(game)
    expect(after.plants).toHaveLength(1)
  })

  it('leaves the county its grievance: the meeting still happened', () => {
    const { grid } = fixtures()
    const before = acceptContract(newGame())
    const sited = sitePlant(before, 'gas-ct', RURAL_SUMTER(), grid)
    const approvalAfterSiting = sited.contract.approval!

    const after = cancelPlant(sited, sited.plants[0].id)
    expect(after.contract.approval!).toBe(approvalAfterSiting)
    expect(after.contract.approval!).toBeLessThan(before.contract.approval!)
  })
})
