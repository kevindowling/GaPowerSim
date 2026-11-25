import { describe, it, expect } from 'vitest'
import { bareGame, build, signed, site, plan, run, defend, acquire } from './helpers/play.ts'
import { commitCorridor } from '../src/engine/turn/corridor.ts'
import { acceptContract, advanceProjects, endQuarter } from '../src/engine/turn/resolve.ts'
import { cashForecast, changes, lastQuarter, recordCash, totalsOf } from '../src/engine/cashForecast.ts'
import { powerForecast } from '../src/engine/forecast.ts'
import { continueGame } from '../src/engine/ending.ts'
import { operate } from './helpers/play.ts'
import { Rng } from '../src/engine/rng.ts'
import type { GameState } from '../src/engine/types.ts'

const building = (): GameState => {
  const g = commitCorridor(site(signed(), 'gas-ct', 2), plan(site(signed(), 'gas-ct', 2)))
  for (const c of g.corridors) {
    for (const d of Object.values(c.deals)) d.status = 'accepted'
    c.status = 'building'
  }
  return g
}

describe('cash by quarter', () => {
  it('matches the game when nothing slips', () => {
    const g = building()
    const f = cashForecast(g, 14)
    const s = structuredClone(g)
    const rng = new Rng(1)
    for (const p of f) {
      advanceProjects(s, rng)
      expect(p.cash).toBeCloseTo(s.cash, 0)
      expect(p.quarter).toBe(s.quarter)
      s.quarter += 1
    }
  })

  it('explains each quarter', () => {
    const g = building()
    let cash = g.cash
    for (const p of cashForecast(g, 14)) {
      const sum = p.rows.reduce((n, r) => n + r.amount, 0)
      expect(Math.abs(p.cash - cash - sum)).toBeLessThan(500_000)
      cash = p.cash
    }
  })

  it('carries past the day the campus turns on', () => {
    const g = build()
    const f = cashForecast(g, 8)
    expect(f).toHaveLength(8)
    expect(f.every((p) => Number.isFinite(p.cash))).toBe(true)
  })

  it('charges for land still to buy', () => {
    const g = commitCorridor(site(signed(), 'gas-ct', 2), plan(site(signed(), 'gas-ct', 2)))
    const land = cashForecast(g, 12).reduce((n, p) => n + (p.rows.find((r) => r.label === 'Landowners and courts')?.amount ?? 0), 0)
    const appraised = Object.values(g.corridors[0].takings).reduce((n, t) => n + t.appraisedTotal, 0)
    expect(-land / appraised).toBeGreaterThan(1.8)
    expect(-land / appraised).toBeLessThan(2.6)
  })

  it('pays installments in the quarter the power forecast says', () => {
    const g = commitCorridor(site(signed(), 'gas-ct', 3), plan(site(signed(), 'gas-ct', 3)))
    const ready = powerForecast(g).readyQuarter!
    const f = cashForecast(g, 20)
    const paid = (q: number): number => f.find((p) => p.quarter === q)!.rows.find((r) => r.label === 'Paid by developers')?.amount ?? 0
    expect(paid(ready)).toBeGreaterThan(600e6)
    expect(f.filter((p) => p.quarter !== ready).reduce((n, p) => n + paid(p.quarter), 0)).toBe(0)
    expect(f[f.length - 1].cash).toBeGreaterThan(0)
    expect(f.find((p) => p.quarter === ready + 1)!.rows.some((r) => r.label === 'Power sold')).toBe(true)
  })

  it('does not change the game, and stops at the end', () => {
    const g = building()
    const before = JSON.stringify(g)
    cashForecast(g)
    expect(JSON.stringify(g)).toBe(before)
    g.phase = 'ended'
    expect(cashForecast(g)).toEqual([])
  })

  it('is quick enough to open a card', () => {
    const g = commitCorridor(site(signed(), 'gas-ct', 3), plan(site(signed(), 'gas-ct', 3)))
    const t = Date.now()
    cashForecast(g)
    expect(Date.now() - t).toBeLessThan(1500)
  })
})

describe('what changed', () => {
  it('is recorded each quarter, and adds up', () => {
    const g = endQuarter(site(acceptContract(bareGame()), 'solar', 1)).state
    expect(g.cashHistory).toHaveLength(1)
    const s = run(g, 3)
    const h = s.cashHistory!
    expect(h).toHaveLength(4)
    expect(h[3].cash).toBeCloseTo(s.cash, -6)
    const l = lastQuarter(s)!
    const sum = l.rows.reduce((n, r) => n + r.amount, 0)
    expect(Math.abs(h[3].cash - h[2].cash - sum)).toBeLessThan(500_000)
  })

  it('works on a save with no history', () => {
    const g = signed()
    expect(lastQuarter(g)).toBeNull()
    recordCash(g, g.quarter)
    expect(lastQuarter(g)!.rows[0].label).toBe('Paid by developers')
    expect(changes({}, {})).toEqual([])
  })

  it('keeps the first year in the books after it', () => {
    const g = operate(defend(acquire(build())))
    const before = totalsOf(g)['Fuel and power bought']
    const s = continueGame(g)
    expect(totalsOf(s)['Fuel and power bought']).toBeCloseTo(before)
  })
})
