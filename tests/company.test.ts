import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { bareGame, run } from './helpers/play.ts'
import { fixtures } from './helpers/loadFixtures.ts'
import { beginCompany, customerQuarter, dueDates, isExisting, mainOpen, openingMoney, openOffers, reportOffers, signBlocked, signCustomer, spareAssigned } from '../src/engine/customers.ts'
import { acceptContract, advanceProjects, endQuarter } from '../src/engine/turn/resolve.ts'
import { firmFlow, loadsOf } from '../src/engine/realtime/network.ts'
import { lastQuarter } from '../src/engine/cashForecast.ts'
import { leaving } from '../src/engine/leaving.ts'
import { ledger } from '../src/engine/ledger.ts'
import { focusOf } from '../src/engine/focus.ts'
import { allUnpaid } from '../src/engine/payments.ts'
import { STARTING_BUDGET, STARTING_CREDIT } from '../src/data/customerTerms.ts'
import { Rng } from '../src/engine/rng.ts'
import { project } from '../src/engine/geo/projection.ts'
import { quarterOf } from '../src/engine/time.ts'
import type { DataCenter } from '../src/data/dataCenters.ts'
import type { GameState } from '../src/engine/types.ts'

const list: DataCenter[] = JSON.parse(readFileSync('public/data/datacenters.json', 'utf8')).map((d: any) => {
  const [x, y] = project(d.lon, d.lat)
  return { ...d, x, y }
})
const begin = (): GameState => beginCompany(bareGame(), list, fixtures().counties, fixtures().grid)

describe('opening as Georgia Power', () => {
  it('has its own money, and the customers it already has', () => {
    const g = begin()
    const m = openingMoney(list, g.quarter)
    expect(g.quarter).toBe(quarterOf(2026, 3))
    expect(g.cash).toBeCloseTo(STARTING_BUDGET + m.paid - m.spent, 0)
    expect(g.cash).toBeGreaterThan(2e9)
    expect(g.customers!.reduce((n, c) => n + c.contractedMw, 0)).toBeCloseTo(m.mw)
    expect(g.creditLimit).toBe(STARTING_CREDIT)
    expect(g.customers!.length).toBe(list.filter(isExisting).length)
    expect(g.customers!.length).toBeGreaterThan(18)
    expect(g.contract.status).toBe('offered')
    expect(beginCompany(g, list, fixtures().counties, fixtures().grid)).toBe(g)
  })

  it('starts them where they are: running or partly built', () => {
    const g = begin()
    const of = (name: string) => g.customers!.find((c) => c.name.includes(name))!
    expect(of('QTS Atlanta Metro')).toMatchObject({ status: 'served', phasesOn: of('QTS Atlanta Metro').phaseCount })
    expect(of('QTS Fayetteville')).toMatchObject({ status: 'signed', phasesOn: 1 })
    expect(of('Hampton')).toMatchObject({ status: 'signed', phasesOn: 0 })
    expect(of('Google Douglas')).toMatchObject({ status: 'served', contractedMw: 326 })
    expect(of('Google Douglas').assumed).toMatch(/Cleanview/)
    expect(of('Hampton').assumed).toBeUndefined()
  })

  it('signs every data center that has started, once, in the area it covers', () => {
    const g = begin()
    const started = list.filter((d) => d.state === 'GA' && ['operating', 'under construction'].includes(d.status) && (!d.utility || d.utility === 'unknown' || d.utility.includes('Georgia Power')))
    const missing = started.filter((d) => !g.customers!.some((c) => c.id === d.id)).map((d) => d.name)
    // Its load is part of QTS Fayetteville's.
    expect(missing).toEqual(['QTS ATL2 East'])
  })

  it('has been paid by each one, and holds the money for phases not yet on', () => {
    const g = begin()
    const l = ledger(g)
    for (const c of g.customers!) {
      const row = l.perCenter.find((r) => r.id === c.id)!
      expect(row.paid).toBeGreaterThan(0)
      expect(row.paid - row.spent).toBeCloseTo(c.advance * 0.3 * (1 - c.phasesOn / c.phaseCount), 0)
    }
    expect(l.shared).toBeCloseTo(0, 0)
    expect(g.cashHistory).toHaveLength(1)
    const after = run(g, 1)
    expect(lastQuarter(after)!.rows.some((r) => r.label === 'Paid by developers')).toBe(false)
    for (const c of g.customers!) {
      const due = c.milestones.filter((m) => !m.released).map((m) => m.dueQuarter!)
      expect([...due].sort((a, b) => a - b)).toEqual(due)
      expect(due.every((q) => q > g.quarter && q <= quarterOf(2034, 4))).toBe(true)
    }
  })

  it('brings in money from more than one of them, every quarter', () => {
    const g = begin()
    advanceProjects(g, new Rng(1))
    const paying = g.customers!.filter((c) => c.revenue > 0)
    expect(paying.length).toBeGreaterThan(5)
    expect(g.cash).toBeGreaterThan(begin().cash)
    const l = ledger(g)
    expect(l.perCenter.filter((r) => r.sold > 0).length).toBe(paying.length)
    expect(STARTING_BUDGET + l.perCenter.reduce((n, r) => n + r.paid + r.sold - r.spent, 0) - l.shared).toBeCloseTo(g.cash, -2)
    expect(l.received[0]).toEqual({ label: 'Starting budget', amount: STARTING_BUDGET })
  })

  it('does not count what already reaches them against spare power', () => {
    const g = begin()
    expect(spareAssigned(g)).toBe(0)
    const f = firmFlow(g)
    for (const c of g.customers!) expect(f.loads.get(c.id)).toBeCloseTo(c.baseMw!)
    const q = customerQuarter(g, g.customers!.find((c) => c.phasesOn > 0)!, f)!
    expect(q.spareCost).toBe(0)
    expect(q.revenue).toBeGreaterThan(q.energyCost)
  })

  it('asks for what is not yet on', () => {
    const g = begin()
    expect(allUnpaid(g)).toBeGreaterThan(1e9)
    expect(signBlocked(g, list.find((d) => d.name.includes('Hampton Tech'))!)).toMatch(/Already/)
  })
})

describe('contracts that come up', () => {
  it('has some open at the start, and the rest spread over the years', () => {
    const g = begin()
    expect(openOffers(g).length).toBe(3)
    expect(g.offers!.length).toBeGreaterThan(15)
    const per = new Map<number, number>()
    for (const o of g.offers!) if (o.opens > g.quarter) per.set(o.opens, (per.get(o.opens) ?? 0) + 1)
    expect(Math.max(...per.values())).toBeLessThanOrEqual(2)
    expect(Math.max(...per.keys())).toBeLessThanOrEqual(quarterOf(2030, 4))
    for (const o of g.offers!) expect(o.closes).toBeGreaterThan(o.opens)
    expect(g.offers!.some((o) => o.id.startsWith('liberty'))).toBe(false)
  })

  it('cannot be signed before it opens or after it closes', () => {
    const g = begin()
    const o = g.offers!.find((x) => x.opens > g.quarter)!
    const dc = list.find((d) => d.id === o.id)!
    expect(signBlocked(g, dc)).toMatch(/comes up in/)
    expect(signBlocked({ ...g, quarter: o.opens }, dc)).toBeNull()
    expect(signBlocked({ ...g, quarter: o.closes }, dc)).toBeNull()
    expect(signBlocked({ ...g, quarter: o.closes + 1 }, dc)).toMatch(/another supplier/)
  })

  it('is reported the quarter it comes up and the quarter it goes', () => {
    const g = begin()
    const o = g.offers!.find((x) => x.opens > g.quarter)!
    const up = { ...structuredClone(g), quarter: o.opens }
    reportOffers(up)
    expect(up.log.some((e) => e.important && e.text.includes(`${o.name} offers a contract`))).toBe(true)
    const gone = { ...structuredClone(g), quarter: o.closes + 1 }
    reportOffers(gone)
    expect(gone.log.some((e) => e.text.includes(`${o.name} went to another supplier`))).toBe(true)
  })

  it('spreads due dates, so few phases share a quarter', () => {
    let g = begin()
    const count = (s: GameState) => {
      const per = new Map<number, number>()
      for (const c of s.customers!) for (const m of c.milestones) if (!m.released) per.set(m.dueQuarter!, (per.get(m.dueQuarter!) ?? 0) + 1)
      return Math.max(...per.values())
    }
    expect(count(g)).toBeLessThanOrEqual(3)
    for (const o of openOffers(g)) g = signCustomer(g, list.find((d) => d.id === o.id)!, fixtures().counties, fixtures().grid)
    expect(count(g)).toBeLessThanOrEqual(3)
  })

  it('leaves saves without them as they were', () => {
    const g = begin()
    delete g.offers
    expect(openOffers(g)).toEqual([])
    expect(signBlocked(g, list.find((d) => d.name.includes('Project Camellia'))!)).toBeNull()
    expect(endQuarter(g).state.quarter).toBe(g.quarter + 1)
  })
})

describe('a data center in trouble', () => {
  const at = (change: (g: GameState, c: any) => void) => {
    const g = begin()
    const c = g.customers!.find((x) => x.name.startsWith('T5'))!
    change(g, c)
    return leaving(g, c.id)
  }
  it('is one near losing approval, or near the end of waiting', () => {
    expect(at(() => {})).toBeNull()
    expect(at((_, c) => { c.approval = 30 })).toBe('Approval is 30. It leaves below 25.')
    const due = (c: any) => c.milestones.find((m: any) => !m.released).dueQuarter
    expect(at((g, c) => { g.quarter = due(c) + 4 })).toBeNull()
    expect(at((g, c) => { g.quarter = due(c) + 5 })).toBe('It leaves in 4 quarters without power.')
    expect(at((g, c) => { g.quarter = due(c) + 9 })).toBe('It leaves this quarter without power.')
    expect(at((_, c) => { c.approval = 30; c.status = 'served' })).toBeNull()
  })

  it('can be the first one, once signed', () => {
    const g = begin()
    g.contract.approval = 30
    expect(leaving(g, 'main')).toBeNull()
    const s = acceptContract(g)
    expect(leaving(s, 'main')).toMatch(/Approval is 30/)
    s.contract.approval = 60
    s.quarter = s.contract.inServiceQuarter + 6
    expect(leaving(s, 'main')).toBe('It leaves in 3 quarters without power.')
  })
})

describe('the limit on the first contract', () => {
  it('is eight quarters, then it goes and the guide with it', () => {
    const g = begin()
    expect(g.mainCloses).toBe(g.quarter + 8)
    expect(acceptContract({ ...g, quarter: g.mainCloses! }).contract.status).toBe('accepted')
    expect(acceptContract({ ...g, quarter: g.mainCloses! + 1 }).contract.status).toBe('offered')
    let s = g
    for (let i = 0; i < 9; i++) s = endQuarter(s).state
    expect(mainOpen(s)).toBe(false)
    expect(s.tutorial).toBeNull()
    expect(s.log.some((e) => e.text === `${s.contract.name} went to another supplier.`)).toBe(true)
    delete g.mainCloses
    expect(mainOpen({ ...g, quarter: 30 })).toBe(true)
  })
})

describe('the first data center', () => {
  it('is signed when the player chooses, and its dates run from then', () => {
    const g = begin()
    expect(loadsOf(g).some((l) => l.id === 'main')).toBe(false)
    expect(focusOf(g, 'main', list).signed).toBe(false)
    const later = run(g, 3)
    expect(later.contract.status).toBe('offered')
    const s = acceptContract(later)
    expect(s.contract.inServiceQuarter).toBe(g.contract.inServiceQuarter + 3)
    expect(s.contract.milestones[1].dueQuarter).toBe(g.contract.milestones[1].dueQuarter! + 3)
    expect(s.cash - later.cash).toBeCloseTo(288e6)
    expect(s.creditLimit).toBeGreaterThan(later.creditLimit)
    expect(loadsOf(s)[0].id).toBe('main')
  })

  it('can be left out', () => {
    let g = begin()
    for (let i = 0; i < 40 && g.phase === 'build'; i++) g = endQuarter(g).state
    expect(g.ending).toBe('completed')
    expect(g.quarter).toBe(quarterOf(2035, 1))
    expect(g.outcome!.headline).toMatch(/You supplied/)
  })
})

describe('other rules', () => {
  it('spread due dates over the published years', () => {
    expect(dueDates(3, 5, '2028-2032')[0]).toBe(quarterOf(2028, 4) < 15 ? 15 : quarterOf(2028, 4))
    expect(dueDates(3, 5, '2028-2032')[4]).toBe(quarterOf(2032, 4))
    expect(dueDates(3, 3, null)).toEqual([15, 17, 19])
    expect(Math.max(...dueDates(3, 5, '2036-12'))).toBe(quarterOf(2034, 4))
  })

  it('gives back signing money never earned when the game ends', () => {
    const g = begin()
    const dc = list.find((d) => signBlocked(g, d) === null)!
    let s = signCustomer(g, dc, fixtures().counties, fixtures().grid)
    const paid = s.customers!.find((c) => c.id === dc.id)!.milestones[0].paid!
    for (let i = 0; i < 40 && s.phase === 'build'; i++) s = endQuarter(s).state
    expect(s.customers!.find((c) => c.id === dc.id)!.refunded).toBeCloseTo(paid, 0)
  })
})
