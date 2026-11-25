import { describe, it, expect } from 'vitest'
import { signed, site, plan, build, newGame } from './helpers/play.ts'
import { fixtures } from './helpers/loadFixtures.ts'
import { commitCorridor } from '../src/engine/turn/corridor.ts'
import { acceptContract, advanceProjects, endQuarter } from '../src/engine/turn/resolve.ts'
import { resolveEvent } from '../src/engine/events/events.ts'
import { amountIfPaid, LATE_FLOOR, shareIfPaid, SIGNING_SHARE, unpaidAdvance } from '../src/engine/payments.ts'
import { migrateApproval } from '../src/engine/approval.ts'
import { Rng } from '../src/engine/rng.ts'
import { SCENARIOS, AMERICUS, DUBLIN } from '../src/data/scenarios.ts'
import type { GameState } from '../src/engine/types.ts'

const TOTAL = AMERICUS.contract.capexAdvance

const running = (turbines: number, quarter = AMERICUS.startQuarter): GameState => {
  let g = site(signed(), 'gas-ct', turbines)
  g = commitCorridor(g, plan(g))
  for (const p of g.plants) { p.status = 'online'; p.quartersRemaining = 0; p.capexSpent = p.capexTotal }
  for (const c of g.corridors) { c.status = 'energized'; c.capexSpent = c.capexTotal }
  g.quarter = quarter
  return g
}

describe('the payment schedule', () => {
  it('is one on signing and one for each phase, adding to the total', () => {
    for (const s of SCENARIOS) {
      const m = newGame(s).contract.milestones
      expect(m).toHaveLength(s.phasing.count + 1)
      expect(m.reduce((n, x) => n + x.fraction, 0)).toBeCloseTo(1)
      expect(s.phasing.due).toHaveLength(s.phasing.count)
      expect(s.phasing.due[s.phasing.count - 1]).toBe(s.contract.inServiceQuarter)
      expect([...s.phasing.due].sort((a, b) => a - b)).toEqual([...s.phasing.due])
    }
    expect(newGame(DUBLIN).contract.milestones[1].label).toBe('200 MW at the campus')
  })

  it('pays on signing', () => {
    expect(signed().cash).toBeCloseTo(TOTAL * SIGNING_SHARE)
  })
})

describe('an installment', () => {
  it('is paid in full when its power is on time', () => {
    const g = running(1)
    const cash = g.cash
    const before = unpaidAdvance(g)
    advanceProjects(g, new Rng(1))
    const m = g.contract.milestones.find((x) => x.phase === 1)!
    expect(m.released).toBe(true)
    expect(m.paid).toBeCloseTo(TOTAL * m.fraction)
    expect(m.paidQuarter).toBe(g.quarter)
    expect(g.cash - cash).toBeCloseTo(m.paid!, 0)
    expect(before - unpaidAdvance(g)).toBeCloseTo(m.paid!, 0)
    expect(g.contract.milestones.filter((x) => x.released)).toHaveLength(2)
  })

  it('loses a tenth for each quarter late, to a floor', () => {
    const g = signed()
    const m = g.contract.milestones[1]
    expect(shareIfPaid(m, m.dueQuarter!)).toBe(1)
    expect(shareIfPaid(m, m.dueQuarter! + 1)).toBeCloseTo(0.9)
    expect(shareIfPaid(m, m.dueQuarter! + 3)).toBeCloseTo(0.7)
    expect(shareIfPaid(m, m.dueQuarter! + 30)).toBe(LATE_FLOOR)
    expect(amountIfPaid(g, m, m.dueQuarter! + 2)).toBeCloseTo(TOTAL * m.fraction * 0.8)
  })

  it('is cut when it arrives late, and says so', () => {
    const due = AMERICUS.phasing.due[0]
    const g = running(1, due + 2)
    advanceProjects(g, new Rng(1))
    const m = g.contract.milestones[1]
    expect(m.paid).toBeCloseTo(TOTAL * m.fraction * 0.8)
    expect(g.log.some((l) => /20% less for being late/.test(l.text))).toBe(true)
  })

  it('is not paid for power that cannot reach the campus', () => {
    const g = running(2)
    g.corridors = []
    advanceProjects(g, new Rng(1))
    expect(g.contract.milestones.filter((m) => m.released)).toHaveLength(1)
  })

  it('is paid once, and several can be paid together', () => {
    const g = running(3)
    advanceProjects(g, new Rng(1))
    expect(g.contract.milestones.every((m) => m.released)).toBe(true)
    const cash = g.cash
    g.phase = 'build'
    g.contract.phasesOn = 0
    const s = structuredClone(g)
    advanceProjects(s, new Rng(1))
    expect(s.cash).toBeLessThanOrEqual(cash)
  })

  it('is due sooner after the bonus for early service', () => {
    const g = site(signed(), 'gas-ct', 1)
    g.pendingEvent = { id: 'early-service' }
    const s = resolveEvent(g, 0)
    g.contract.milestones.forEach((m, i) => {
      if (m.dueQuarter !== undefined) expect(s.contract.milestones[i].dueQuarter).toBe(m.dueQuarter - 1)
    })
  })
})

describe('a whole build', () => {
  it('leaves what was lost to lateness on the scorecard', () => {
    const g = build({ steps: [1] })
    const paid = g.contract.milestones.reduce((n, m) => n + (m.paid ?? 0), 0)
    expect(paid).toBeLessThan(TOTAL)
    expect(g.penaltiesAccrued).toBe(0)
  })
})

describe('a save with the old payments', () => {
  it('keeps them, and its late fee', () => {
    const g = acceptContract(newGame())
    delete g.contract.phasesOn
    g.contract.latePenaltyPerQuarter = 18e6
    g.contract.milestones = [
      { id: 'signing', label: 'Contract signed', fraction: 0.2, trigger: 'signed', released: true },
      { id: 'permits', label: 'Permits issued', fraction: 0.2, trigger: 'permits-issued', released: false },
      { id: 'halfway', label: 'Construction half complete', fraction: 0.35, trigger: 'construction-half', released: false },
      { id: 'energized', label: 'Load energized', fraction: 0.25, trigger: 'energized', released: false },
    ]
    migrateApproval(g, fixtures().counties)
    let s = site(g, 'gas-ct', 1)
    s.plants[0].quartersRemaining = 1
    s = endQuarter(s).state
    expect(s.contract.milestones[1].released).toBe(true)
    expect(s.contract.milestones[1].paid).toBeCloseTo(TOTAL * 0.2)
    s.quarter = s.contract.inServiceQuarter + 1
    s.contract.approval = 60
    expect(endQuarter(s).state.penaltiesAccrued).toBe(18e6)
  })
})
