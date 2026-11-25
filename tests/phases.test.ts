import { describe, it, expect } from 'vitest'
import { signed, site, plan, build, operate, newGame, run } from './helpers/play.ts'
import { commitCorridor } from '../src/engine/turn/corridor.ts'
import { advanceProjects, acceptContract } from '../src/engine/turn/resolve.ts'
import { phaseQuarter, phasesOn, phasesPowered, phasing, turnOnPhases } from '../src/engine/phases.ts'
import { powerForecast } from '../src/engine/forecast.ts'
import { stepRealtime } from '../src/engine/realtime/operate.ts'
import { BOUNDS } from './helpers/play.ts'
import { Rng } from '../src/engine/rng.ts'
import { DUBLIN, SCENARIOS } from '../src/data/scenarios.ts'
import type { GameState } from '../src/engine/types.ts'

/** Turbines online, joined to the campus by a line in service. */
const running = (turbines: number): GameState => {
  let g = site(signed(), 'gas-ct', turbines)
  g = commitCorridor(g, plan(g))
  for (const p of g.plants) { p.status = 'online'; p.quartersRemaining = 0; p.capexSpent = p.capexTotal }
  for (const c of g.corridors) { c.status = 'energized'; c.capexSpent = c.capexTotal }
  return g
}

describe('phases', () => {
  it('belong to each data center', () => {
    expect(phasing(signed())).toMatchObject({ count: 4, mwEach: 100 })
    expect(phasing(newGame(DUBLIN))).toMatchObject({ count: 3, mwEach: 200 })
    for (const s of SCENARIOS) expect(s.phasing.count * s.phasing.mwEach).toBe(s.contract.contractedMw)
  })

  it('turn on in whole steps', () => {
    const g = signed()
    expect([0, 99, 100, 199, 200, 399, 400, 900].map((mw) => phasesPowered(g, mw))).toEqual([0, 0, 1, 1, 2, 3, 4, 4])
    expect(phasesPowered(newGame(DUBLIN), 199)).toBe(0)
    expect(phasesPowered(newGame(DUBLIN), 400)).toBe(2)
  })

  it('turn on as power arrives, and stay on', () => {
    const g = running(1)
    turnOnPhases(g)
    expect(phasesOn(g)).toBe(1)
    g.plants[0].status = 'outage'
    turnOnPhases(g)
    expect(phasesOn(g)).toBe(1)
  })

  it('stay off without a line', () => {
    const g = running(2)
    g.corridors[0].status = 'building'
    g.corridors[0].buildQuartersRemaining = 9
    turnOnPhases(g)
    expect(phasesOn(g)).toBe(0)
  })

  it('start the operating year only when all are on', () => {
    const two = running(2)
    advanceProjects(two, new Rng(1))
    expect(two.phase).toBe('build')
    expect(phasesOn(two)).toBe(3)
    const three = running(3)
    advanceProjects(three, new Rng(1))
    expect(three.phase).toBe('operate')
    expect(phasesOn(three)).toBe(4)
  })
})

describe('what a phase pays', () => {
  it('nothing until one is on', () => {
    const g = running(2)
    expect(phaseQuarter(g)).toBeNull()
    const before = g.revenue
    advanceProjects(g, new Rng(1))
    expect(g.revenue).toBe(before)
    advanceProjects(g, new Rng(1))
    expect(g.revenue).toBeGreaterThan(before)
  })

  it('the contract rate for what it draws', () => {
    const g = running(2)
    g.contract.phasesOn = 2
    const q = phaseQuarter(g)!
    expect(q.mw).toBe(200)
    const full = 200 * 2190 * g.contract.energyRatePerMwh
    expect(q.revenue).toBeGreaterThan(full * 0.88)
    expect(q.revenue).toBeLessThan(full)
    expect(q.energyCost).toBeGreaterThan(0)
    expect(q.revenue).toBeGreaterThan(q.energyCost)
  })

  it('more for more phases', () => {
    const g = running(2)
    const at = (n: number): number => { g.contract.phasesOn = n; return phaseQuarter(g)!.revenue }
    expect(at(2)).toBeCloseTo(at(1) * 2, -5)
    expect(at(3)).toBeGreaterThan(at(2))
  })

  it('is worked out without changing anything', () => {
    const g = running(2)
    g.contract.phasesOn = 2
    const before = JSON.stringify(g)
    phaseQuarter(g)
    expect(JSON.stringify(g)).toBe(before)
  })

  it('reaches cash, and the record', () => {
    const g = running(2)
    g.contract.phasesOn = 2
    const q = phaseQuarter(g)!
    const cash = g.cash
    const s = structuredClone(g)
    for (const m of s.contract.milestones) m.released = true
    advanceProjects(s, new Rng(1))
    expect(s.cash - cash).toBeCloseTo(q.revenue - q.energyCost - q.upkeep, 0)
    expect(s.log.some((l) => /paid \$.*for 200 MW/.test(l.text))).toBe(true)
  })

  it('a solar farm alone does not bankrupt anyone at night', () => {
    let g = site(signed(), 'solar', 1)
    g = commitCorridor(g, plan(g))
    g.plants[0].status = 'online'
    g.corridors[0].status = 'energized'
    g.contract.phasesOn = 1
    const q = phaseQuarter(g)!
    expect(q.revenue - q.energyCost - q.upkeep).toBeGreaterThan(0)
  })
})

describe('the forecast', () => {
  it('dates each phase', () => {
    const g = running(2)
    g.plants[1].status = 'construction'
    g.plants[1].quartersRemaining = 3
    g.contract.phasesOn = 1
    const f = powerForecast(g)
    expect(f.phases).toEqual([
      { on: true, quarter: null },
      { on: false, quarter: g.quarter + 2 },
      { on: false, quarter: g.quarter + 2 },
      { on: false, quarter: null },
    ])
  })
})

describe('the operating year', () => {
  it('starts at full load', () => {
    const g = build()
    expect(phasesOn(g)).toBe(4)
    operate(g, { ticks: 4 })
    expect(g.realtime!.history[0].contractMw).toBeGreaterThan(350)
  })

  it('keeps filling up in a save from before phases', () => {
    const g = build()
    delete g.contract.phasesOn
    stepRealtime(g, BOUNDS)
    expect(g.realtime!.history[0].contractMw).toBeLessThan(110)
  })

  it('a build-phase save from before phases picks them up', () => {
    const g = running(2)
    delete g.contract.phasesOn
    const s = run(g, 1)
    expect(phasesOn(s)).toBe(3)
    expect(acceptContract(newGame()).contract.phasesOn).toBe(0)
  })
})
