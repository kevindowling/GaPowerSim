import { describe, it, expect } from 'vitest'
import { signed, site, plan, run, build, operate } from './helpers/play.ts'
import { fixtures, cellAtLonLat } from './helpers/loadFixtures.ts'
import { commitCorridor } from '../src/engine/turn/corridor.ts'
import { assessSite, sitePlant } from '../src/engine/turn/siting.ts'
import { endQuarter } from '../src/engine/turn/resolve.ts'
import { programmesFor, runProgramme } from '../src/engine/turn/community.ts'
import { adjacentCounties } from '../src/engine/geo/adjacency.ts'
import {
  approvalOf, CANCEL_BELOW, changeRating, migrateApproval, neighbours, ratingOf, SPREAD_ABOVE, SPREAD_BELOW,
} from '../src/engine/approval.ts'
import { drawOutsideEvents, OUTSIDE_EVENTS, spreadDelta } from '../src/engine/events/outside.ts'
import { STATE_VERSION } from '../src/engine/state.ts'
import { owedAdvance, unpaidAdvance } from '../src/engine/payments.ts'
import type { GameState } from '../src/engine/types.ts'

const HOME = '13261'
const LEE = '13177'
const FULTON = '13121'
const grid = () => fixtures().grid
const at = (a: number): GameState => {
  const g = site(signed(), 'gas-ct', 3)
  g.contract.approval = a
  return g
}

describe('who has a rating', () => {
  it('the data center and the counties bordering its own', () => {
    const g = signed()
    expect(ratingOf(g, HOME)).toBe(62)
    expect(ratingOf(g, LEE)).toBe(57)
    expect(ratingOf(g, FULTON)).toBeNull()
    expect(neighbours(g)).toHaveLength(8)
  })

  it('matches on borders', () => {
    const { counties } = fixtures()
    expect(adjacentCounties(counties, '13175')).toContain('13289')
    expect(adjacentCounties(counties, HOME)).not.toContain(HOME)
    expect(adjacentCounties(counties, 'none')).toEqual([])
  })

  it('building far away costs no approval', () => {
    const g = signed()
    const cell = cellAtLonLat(-82.4, 31.7)
    expect(assessSite(g, 'gas-ct', cell, grid()).approvalCost).toBe(0)
    expect(approvalOf(sitePlant(g, 'gas-ct', cell, grid()))).toBe(62)
  })

  it('building in a bordering county costs that county', () => {
    const g = signed()
    const cell = cellAtLonLat(-84.17, 31.85)
    const a = assessSite(g, 'gas-ct', cell, grid())
    expect(a.ok && a.countyFips).toBe(LEE)
    const after = sitePlant(g, 'gas-ct', cell, grid())
    expect(ratingOf(after, LEE)).toBeLessThan(57)
    expect(approvalOf(after)).toBe(62)
  })
})

describe('cancelling', () => {
  it('ends the game, and the rest of the funding is never paid', () => {
    const g = at(CANCEL_BELOW - 1)
    const owed = unpaidAdvance(g)
    const s = endQuarter(g).state
    expect(s.ending).toBe('cancelled')
    expect(s.contract.status).toBe('failed')
    expect(unpaidAdvance(s)).toBe(0)
    expect(owedAdvance(s)).toBe(owed)
    expect(s.cash).toBeLessThanOrEqual(g.cash)
    expect(s.outcome!.headline).toMatch(/cancelled/)
    expect(s.outcome!.lines.find((l) => l.label === 'Never paid')!.value).toBe('$672M')
    expect(s.outcome!.score).toBe(Math.round(s.cash))
  })

  it('does not happen at the line or above it', () => {
    expect(endQuarter(at(CANCEL_BELOW)).state.ending).toBeNull()
  })

  it('leaves one quarter to recover', () => {
    const g = at(CANCEL_BELOW - 4)
    const saved = runProgramme(g, HOME, 'fund')
    expect(approvalOf(saved)).toBeGreaterThanOrEqual(CANCEL_BELOW)
    expect(endQuarter(saved).state.ending).toBeNull()
  })

  it('is checked before the next quarter brings its own news', () => {
    for (let seed = 1; seed < 40; seed++) {
      const g = site(signed(seed), 'gas-ct', 3)
      g.contract.approval = CANCEL_BELOW + 1
      expect(endQuarter(g).state.ending).toBeNull()
    }
  })

  it('warns first', () => {
    const { headlines } = endQuarter(at(31))
    expect(headlines.join(' ')).toMatch(/Below 25 the data center is cancelled|Raise it to 25/)
  })

  it('does not apply once the campus has power', () => {
    const g = build()
    expect(g.phase).toBe('operate')
    g.contract.approval = 5
    operate(g, { ticks: 96 })
    expect(g.ending).toBeNull()
  })
})

describe('events outside the player\'s control', () => {
  it('go both ways, at home and next door', () => {
    for (const where of ['home', 'neighbour'] as const) {
      const here = OUTSIDE_EVENTS.filter((e) => e.where === where)
      expect(here.some((e) => e.delta > 0)).toBe(true)
      expect(here.some((e) => e.delta < 0)).toBe(true)
    }
    expect(new Set(OUTSIDE_EVENTS.map((e) => e.id)).size).toBe(OUTSIDE_EVENTS.length)
  })

  it('happen, offer no choice, never repeat, and are on the record', () => {
    let seen = 0
    for (let seed = 1; seed <= 12; seed++) {
      const g = signed(seed)
      for (let q = 0; q < 12; q++) {
        seen += drawOutsideEvents(g).length
        g.quarter += 1
      }
      const ids = g.firedEvents.filter((i) => i.startsWith('outside:'))
      expect(new Set(ids).size).toBe(ids.length)
      expect(g.pendingEvent).toBeNull()
      const total = g.contract.history!.reduce((n, h) => n + h.delta, 0)
      expect(62 + total).toBeCloseTo(approvalOf(g), 6)
      expect(g.contract.history!.every((h) => h.outside)).toBe(true)
    }
    expect(seen).toBeGreaterThan(40)
  })

  it('replay the same from the same seed, and leave the game stream alone', () => {
    const go = () => { const g = signed(9); const r = g.rngState; drawOutsideEvents(g); expect(g.rngState).toBe(r); return JSON.stringify(g) }
    expect(go()).toBe(go())
  })

  it('wait until the contract is signed', () => {
    const g = signed()
    g.contract.status = 'offered'
    for (let q = 0; q < 20; q++) { expect(drawOutsideEvents(g)).toEqual([]); g.quarter += 1 }
  })
})

describe('bordering counties', () => {
  const spread = (rating: number): number => {
    let moved = 0
    for (let seed = 1; seed <= 20; seed++) {
      const g = signed(seed)
      for (const f of neighbours(g)) g.counties[f].approval = rating
      g.firedEvents = OUTSIDE_EVENTS.map((e) => `outside:${e.id}`)
      drawOutsideEvents(g)
      moved += approvalOf(g) - 62
    }
    return moved
  }

  it('pull the data center down when opposed, up when supportive, and neither between', () => {
    expect(spread(20)).toBeLessThan(0)
    expect(spread(80)).toBeGreaterThan(0)
    expect(spread(55)).toBe(0)
  })

  it('matter more the further from neutral they are', () => {
    expect(spreadDelta(SPREAD_BELOW)).toBe(0)
    expect(spreadDelta(10)).toBeLessThan(spreadDelta(40))
    expect(spreadDelta(90)).toBeGreaterThan(spreadDelta(SPREAD_ABOVE))
  })

  it('can be courted, and others cannot', () => {
    const g = signed()
    const after = runProgramme(g, LEE, 'fund')
    expect(ratingOf(after, LEE)).toBe(66)
    expect(approvalOf(after)).toBe(62)
    expect(runProgramme(g, FULTON, 'fund')).toBe(g)
    expect(programmesFor(g, FULTON).every((p) => p.blocked)).toBe(true)
    expect(changeRating(g, FULTON, 5, 'x')).toBe(0)
  })

  it('are told apart from the data center on a line that crosses both', () => {
    const g = commitCorridor(site(signed(), 'gas-ct', 1), plan(site(signed(), 'gas-ct', 1)))
    expect(g.contract.history!.map((h) => h.text).join()).toMatch(/sited/)
  })
})

describe('a save from before this', () => {
  const old = (approval: number): GameState => {
    const g = JSON.parse(JSON.stringify(run(site(signed(), 'gas-ct', 1), 1))) as GameState
    delete g.contract.approval
    delete g.contract.history
    delete g.contract.programmes
    for (const c of Object.values(g.counties)) { delete c.adjacent; c.approval = c.fips === HOME ? approval : 55 }
    g.counties[HOME].history = [{ quarter: 3, text: 'Gas turbine 1 sited', delta: -4 }]
    return g
  }

  it('keeps its rating and record', () => {
    const g = old(51)
    expect(g.version).toBe(STATE_VERSION)
    migrateApproval(g, fixtures().counties)
    expect(approvalOf(g)).toBe(51)
    expect(g.contract.history).toHaveLength(1)
    expect(neighbours(g)).toHaveLength(8)
    expect(ratingOf(g, FULTON)).toBeNull()
  })

  it('is not cancelled on arrival', () => {
    const g = old(10)
    migrateApproval(g, fixtures().counties)
    expect(approvalOf(g)).toBeGreaterThanOrEqual(CANCEL_BELOW)
  })
})
