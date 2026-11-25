import { describe, it, expect } from 'vitest'
import { signed, site, plan, run, build, operate, newGame, acquire } from './helpers/play.ts'
import { commitCorridor, offerAll, condemn } from '../src/engine/turn/corridor.ts'
import { resolveHearing, endQuarter } from '../src/engine/turn/resolve.ts'
import { HEARING_OPTIONS } from '../src/engine/turn/hearing.ts'
import { BEATS, currentBeat, advanceTutorial, tutorialFinished } from '../src/engine/tutorial.ts'
import { scoreScenario } from '../src/engine/scoring.ts'
import { EVENTS, eventById, resolveEvent } from '../src/engine/events/events.ts'
import { endScenario } from '../src/engine/ending.ts'
import { DUBLIN } from '../src/data/scenarios.ts'
import type { GameState } from '../src/engine/types.ts'

const beat = (g: GameState): string | null => currentBeat(g)?.id ?? null

describe('tutorial', () => {
  it('follows the project', () => {
    expect(beat(newGame())).toBe('deal')
    let g = signed()
    advanceTutorial(g)
    expect(beat(g)).toBe('generation')
    g = site(g, 'gas-ct', 3)
    expect(beat(g)).toBe('route')
    g = commitCorridor(g, plan(g))
    expect(beat(g)).toBe('acquire')
    g = run(offerAll(g, g.corridors[0].id, 1.5), 1)
    expect(beat(g)).toBe('holdouts')
    g = acquire(g)
    for (let i = 0; i < 6; i++) g = run(g, 1)
    expect(beat(g)).toBe('hearing')
  })

  it('does not count solar as firm', () => {
    const g = site(signed(), 'solar', 2)
    expect(beat(g)).toBe('generation')
  })

  it('does not stall if every parcel is condemned', () => {
    let g = site(signed(), 'gas-ct', 3)
    g = commitCorridor(g, plan(g))
    for (const id of Object.keys(g.corridors[0].deals)) g = condemn(g, g.corridors[0].id, id)
    g.contract.approval = 90
    g = run(g, 6)
    expect(beat(g)).toBe('hearing')
  })

  it('holds the hearing even when hints are hidden', () => {
    let g = site(signed(), 'gas-ct', 3)
    g.tutorial!.dismissed = true
    g = commitCorridor(g, plan(g))
    g = acquire(g)
    for (let i = 0; i < 6; i++) g = run(g, 1)
    expect(currentBeat(g)).toBeNull()
    expect(g.hearing).toBe('called')
  })

  it('finishes with the year', () => {
    const g = operate(build({ classId: '230d' }))
    advanceTutorial(g)
    expect(tutorialFinished(g)).toBe(true)
    expect(g.tutorial!.beat).toBe(BEATS.length)
  })

  it('is absent from later scenarios', () => {
    expect(newGame(DUBLIN).tutorial).toBeNull()
  })
})

describe('hearing', () => {
  it('trades money against approval', () => {
    const g = signed()
    const pay = resolveHearing(g, HEARING_OPTIONS[0])
    const rate = resolveHearing(g, HEARING_OPTIONS[2])
    expect(pay.cash).toBeLessThan(rate.cash)
    expect(pay.contract.approval!).toBeGreaterThan(rate.contract.approval!)
    expect(rate.counties['13261'].grievances.length).toBeGreaterThan(0)
  })

  it('is answered once', () => {
    const g = resolveHearing(signed(), HEARING_OPTIONS[0])
    expect(resolveHearing(g, HEARING_OPTIONS[0])).toBe(g)
  })
})

describe('decisions', () => {
  it('come up in most games', () => {
    let seen = 0
    for (const seed of [1, 2, 3, 4, 5]) seen += build({ seed, classId: '230d' }).firedEvents.length
    expect(seen / 5).toBeGreaterThan(3)
  })

  it('never repeat', () => {
    const g = operate(build({ classId: '230d' }))
    expect(new Set(g.firedEvents).size).toBe(g.firedEvents.length)
  })

  it('every option of every event applies cleanly', () => {
    const base = operate(build({ classId: '230d' }), { ticks: 100 })
    for (const e of EVENTS) {
      e.options.forEach((_, i) => {
        const g = structuredClone(base)
        g.pendingEvent = { id: e.id }
        const next = resolveEvent(g, i)
        expect(next.pendingEvent).toBeNull()
        expect(Number.isFinite(next.cash)).toBe(true)
        expect(next.log.length).toBeGreaterThan(g.log.length - 1)
      })
      expect(e.body(base).length).toBeGreaterThan(20)
    }
  })

  it('do what they say', () => {
    let g = site(signed(), 'gas-ct', 1)
    g.pendingEvent = { id: 'moratorium' }
    const before = g.plants[0].quartersRemaining
    const waited = resolveEvent(g, 2)
    expect(waited.plants[0].quartersRemaining).toBe(before + 1)
    const paid = resolveEvent(g, 0)
    expect(g.cash - paid.cash).toBe(3_000_000)
    expect(eventById('moratorium')!.options[0].effect).toContain('$3M')
  })

  it('take the last option if the quarter ends first', () => {
    const g = site(signed(), 'gas-ct', 1)
    g.pendingEvent = { id: 'moratorium' }
    g.firedEvents.push('moratorium')
    const next = endQuarter(g).state
    expect(next.pendingEvent?.id).not.toBe('moratorium')
    expect(next.plants[0].quartersRemaining).toBe(g.plants[0].quartersRemaining)
  })
})

describe('the summer storm', () => {
  it('hits a single line harder than a double', () => {
    const dark = (classId: '230' | '230d'): number => {
      const g = build({ classId })
      g.tutorial!.stormAtTick = 3 * 96
      // Full load from the start.
      g.scenarioId = 'none'
      operate(g, { ticks: 6 * 96 })
      expect(g.tutorial!.stormFired).toBe(true)
      return g.realtime!.unservedContractMwh
    }
    expect(dark('230')).toBeGreaterThan(dark('230d') + 500)
  })
})

describe('endings', () => {
  it('cancels a project that is far too late', () => {
    const g = run(signed(), 40)
    expect(g.ending).toBe('terminated')
    expect(g.outcome!.headline).toMatch(/cancelled/)
  })

  it('stops when lenders stop', () => {
    let g = signed()
    for (let i = 0; i < 6; i++) g = site(g, 'gas-ct', 1)
    g = run(g, 14)
    expect(g.ending).toBe('insolvent')
    expect(g.cash).toBeLessThan(-g.creditLimit)
  })

  it('does not accept moves afterwards', () => {
    const g = signed()
    endScenario(g, 'terminated')
    expect(site(g, 'gas-ct', 1).plants).toHaveLength(0)
    expect(endQuarter(g).state).toBe(g)
  })
})

describe('score', () => {
  it('is the balance', () => {
    const good = operate(build({ classId: '230d', style: 'homes' }))
    expect(good.outcome!.score).toBe(Math.round(good.cash))
    const rough = operate(build({ classId: '230', steps: [1], hearing: 2 }))
    expect(good.outcome!.score).toBeGreaterThan(rough.outcome!.score)
  })

  it('says so when homes paid for the campus', () => {
    const g = operate(build({ classId: '230d' }))
    g.realtime!.unservedCustomerMwh = 900
    expect(scoreScenario(g).headline).toMatch(/Homes in Sumter County lost power/)
  })
})
