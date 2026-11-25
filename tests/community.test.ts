import { describe, it, expect } from 'vitest'
import { signed, site, plan, run, build, operate } from './helpers/play.ts'
import { fixtures } from './helpers/loadFixtures.ts'
import { commitCorridor, condemn } from '../src/engine/turn/corridor.ts'
import { resolveHearing } from '../src/engine/turn/resolve.ts'
import { HEARING_OPTIONS } from '../src/engine/turn/hearing.ts'
import {
  PROGRAMMES, PROGRAMME_CAP, approvalAdvice, approvalEffects, programmesFor, runProgramme,
} from '../src/engine/turn/community.ts'
import { changeApproval } from '../src/engine/approval.ts'
import { resolveEvent } from '../src/engine/events/events.ts'
import { countyStats } from '../src/engine/geo/countyStats.ts'
import { BUILT_UP } from '../src/engine/turn/siting.ts'
import type { GameState } from '../src/engine/types.ts'

const F = '13261'
const approval = (g: GameState): number => g.contract.approval!
const total = (g: GameState): number => (g.contract.history ?? []).reduce((n, h) => n + h.delta, 0)

describe('why approval is what it is', () => {
  it('accounts for every point', () => {
    let g = site(signed(), 'gas-ct', 3)
    g = commitCorridor(g, plan(g, '230', 'direct'))
    g = condemn(g, 'corridor-1', Object.keys(g.corridors[0].deals)[0])
    g = resolveHearing(g, HEARING_OPTIONS[2])
    g.pendingEvent = { id: 'water' }
    g = resolveEvent(g, 2)
    expect(62 + total(g)).toBeCloseTo(approval(g), 6)
    const reasons = g.contract.history!.map((h) => h.text).join('|')
    for (const r of ['sited', 'filed', 'condemned', 'Hearing', 'Cooling water']) expect(reasons).toContain(r)
  })

  it('still accounts for it after a year of operation', () => {
    const g = operate(build({ classId: '230' }))
    if ((g.contract.history ?? []).length < 40) expect(62 + total(g)).toBeCloseTo(approval(g), 4)
    expect(g.contract.history!.length).toBeGreaterThan(3)
  })

  it('merges repeats within a quarter', () => {
    const g = signed()
    for (let i = 0; i < 20; i++) changeApproval(g, -0.1, 'Homes without power')
    expect(g.contract.history).toHaveLength(1)
    expect(g.contract.history![0].delta).toBeCloseTo(-2, 6)
  })

  it('works on a save from before the record existed', () => {
    const g = signed()
    delete g.contract.history
    delete g.contract.programmes
    expect(runProgramme(g, F, 'meeting').contract.approval).toBeGreaterThan(approval(g))
  })
})

describe('community programmes', () => {
  it('cost money and raise approval', () => {
    const g = signed()
    const next = runProgramme(g, F, 'fund')
    expect(g.cash - next.cash).toBe(12_000_000)
    expect(approval(next)).toBeCloseTo(approval(g) + 9, 6)
  })

  it('have cooldowns, and are worth less each time', () => {
    let g = runProgramme(signed(), F, 'meeting')
    const first = approval(g) - 62
    expect(runProgramme(g, F, 'meeting')).toBe(g)
    expect(programmesFor(g, F).find((o) => o.programme.id === 'meeting')!.blocked).toMatch(/Again in 2 quarters/)
    g = run(g, 2)
    const before = approval(g)
    g = runProgramme(g, F, 'meeting')
    expect(approval(g) - before).toBeGreaterThan(0)
    expect(approval(g) - before).toBeLessThan(first)
    g = runProgramme(g, F, 'fund')
    expect(run(g, 8).contract.programmes!.fund.times).toBe(1)
    expect(runProgramme(run(g, 8), F, 'fund').contract.programmes!.fund.times).toBe(1)
  })

  it('need something to work on', () => {
    const g = signed()
    const blocked = (s: GameState, id: string) => programmesFor(s, F).find((o) => o.programme.id === id)!.blocked
    expect(blocked(g, 'screening')).toMatch(/no plant/)
    expect(blocked(g, 'roads')).toMatch(/Nothing has been built/)
    expect(blocked(g, 'local-hiring')).toMatch(/Nothing is under construction/)
    let s = site(g, 'gas-ct', 1)
    expect(blocked(s, 'screening')).toBeNull()
    for (let i = 0; i < 6 && s.plants[0].status === 'permitting'; i++) s = run(s, 1)
    expect(blocked(s, 'local-hiring')).toBeNull()
  })

  it('stop at a ceiling', () => {
    const g = signed()
    g.contract.approval = PROGRAMME_CAP - 2
    expect(runProgramme(g, F, 'fund').contract.approval).toBe(PROGRAMME_CAP)
    g.contract.approval = 92
    expect(runProgramme(g, F, 'fund')).toBe(g)
  })

  it('have to be affordable', () => {
    const g = signed()
    g.cash = -g.creditLimit
    expect(programmesFor(g, F).every((o) => o.blocked !== null)).toBe(true)
  })

  it('come out of the balance', () => {
    const g = signed()
    let s = g
    for (const p of PROGRAMMES) s = runProgramme(s, F, p.id)
    expect(s.cash).toBeLessThan(g.cash)
    expect(approval(s)).toBeGreaterThan(approval(g))
  })
})

describe('the county card', () => {
  it('explains what approval does', () => {
    const g = signed()
    const at = (a: number): string => {
      g.contract.approval = a
      return approvalEffects(g, F).join(' ')
    }
    expect(at(80)).toMatch(/on schedule.*less than usual/)
    expect(at(30)).toMatch(/one quarter in five.*more than usual/)
    expect(at(5)).toMatch(/cancelled if the quarter ends/)
  })

  it('gives advice that fits the moment', () => {
    expect(approvalAdvice(signed(), F).join(' ')).toMatch(/hearing: \+14/)
    let g = site(signed(), 'gas-ct', 3)
    g = commitCorridor(g, plan(g))
    expect(approvalAdvice(g, F).join(' ')).toMatch(/Buy rather than condemn/)
    expect(approvalAdvice(operate(build({ classId: '230d' }), { ticks: 10 }), F).join(' ')).toMatch(/Keep homes powered/)
  })

  it('measures the county', () => {
    const s = countyStats(fixtures().grid, F, BUILT_UP)!
    // Census land area of Sumter County is about 1,250 km2.
    expect(s.areaKm2).toBeGreaterThan(1200)
    expect(s.areaKm2).toBeLessThan(1320)
    expect(s.landValue).toBeGreaterThan(2000)
  })
})
