import { describe, it, expect } from 'vitest'
import { CAREFUL, playAmericus, type Style } from './balance/americus.ts'
import { playCompany } from './balance/company.ts'
import { playCustomers, type Plan } from './balance/customers.ts'

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length / 1e6
const americus = (o: Partial<Style>): number => mean([1, 2, 3, 4].map((s) => playAmericus(s, { ...CAREFUL, ...o }).cash))
const base: Plan = { names: ['Project Sail'], grid: ['230d'], rebuild: true, spare: 1, plants: [], deliver: true }
const others = (o: Partial<Plan>): number => mean([1, 2].map((s) => playCustomers(s, { ...base, ...o }).cash))

describe('the balance, for the first data center', () => {
  const careful = americus({})

  it('rewards careful play', () => {
    expect(careful).toBeGreaterThan(80)
    expect(careful).toBeLessThan(400)
  })

  it('punishes being cancelled', () => {
    expect(americus({ hearing: 2, events: 'last', defend: 0, rounds: 1, line: '230' })).toBeLessThan(careful - 80)
  })

  it('punishes skipping upkeep', () => {
    expect(americus({ vegetation: 0, crews: 1, defer: true })).toBeLessThan(careful - 60)
  })

  it('punishes having no reserve', () => {
    expect(americus({ plants: [['gas-ct', 2], ['battery', 2]] })).toBeLessThan(careful - 60)
  })
}, 120_000)

describe('the balance, for the company', () => {
  it('rewards connecting what is signed, and not just waiting', () => {
    const idle = playCompany(1, { connect: 0, grid: [], rebuild: false, spare: false, sign: 0 }).cash / 1e6
    const busy = playCompany(1, { connect: 6, grid: ['115', '230d', '500'], rebuild: true, spare: true, sign: 0 }).cash / 1e6
    const greedy = playCompany(1, { connect: 0, grid: [], rebuild: false, spare: false, sign: 10 }).cash / 1e6
    expect(idle).toBeGreaterThan(900)
    expect(busy).toBeGreaterThan(idle + 800)
    expect(greedy).toBeLessThan(idle + 50)
  })
}, 120_000)

describe('the balance, for the others', () => {
  it('rewards delivering, and delivering all of it', () => {
    const some = others({})
    const all = others({ grid: ['115', '230d', '500'] })
    expect(some).toBeGreaterThan(50)
    expect(all).toBeGreaterThan(some + 50)
  })

  it('does not reward signing and doing nothing', () => {
    expect(others({ deliver: false })).toBeLessThan(5)
  })

  it('lets building plants pay by the end', () => {
    expect(others({ grid: [], spare: 0, plants: [['gas-ct', 5]] })).toBeGreaterThan(50)
    expect(others({ spare: 0.4, plants: [['gas-ccgt', 1]] })).toBeGreaterThan(50)
  })
}, 120_000)
