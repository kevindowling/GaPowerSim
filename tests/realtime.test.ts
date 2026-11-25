import { describe, it, expect } from 'vitest'
import { signed, site, plan, build, operate, BOUNDS } from './helpers/play.ts'
import { commitCorridor } from '../src/engine/turn/corridor.ts'
import { createRealtimeState, TICKS_PER_DAY, OPERATING_YEAR_TICKS } from '../src/engine/realtime/types.ts'
import {
  customerShape, solarFraction, ambientC, loadAt, hourOfDay, dayOfYear, rampFraction,
} from '../src/engine/realtime/load.ts'
import {
  dispatch, availableMw, marketPrice, importLimitMw, batteryCapacityMwh, BATTERY_HOURS,
} from '../src/engine/realtime/dispatch.ts'
import { tripProbability, distanceToCenterline, stormDamageChance } from '../src/engine/realtime/reliability.ts'
import {
  stepRealtime, reliabilityIndices, standingCosts, setCrews, togglePriority,
} from '../src/engine/realtime/operate.ts'
import type { GameState } from '../src/engine/types.ts'
import type { PlantKind } from '../src/data/plants.ts'
import type { LineClassId } from '../src/data/transmission.ts'
import type { SheddingPolicy } from '../src/engine/realtime/types.ts'

const JULY_EVENING = 200 * TICKS_PER_DAY + 74

/** Everything built and connected, at full load. */
function operating(classId: LineClassId = '230d', plants: Array<[PlantKind, number]> = [['gas-ct', 3]]): GameState {
  let g = signed()
  for (const [t, n] of plants) g = site(g, t, n)
  g = commitCorridor(g, plan(g, classId))
  g.corridors[0].status = 'energized'
  for (const p of g.plants) {
    p.status = 'online'
    p.capexSpent = p.capexTotal
    if (p.typeId === 'battery') p.socMwh = batteryCapacityMwh(p)
  }
  g.energizedQuarter = g.quarter
  g.phase = 'operate'
  g.realtime = createRealtimeState()
  g.tutorial = null
  return g
}

const PEAK = loadAt(JULY_EVENING, 400, 58.8)
const none = new Set<string>()
const line = (g: GameState): string => g.corridors[0].id

describe('load', () => {
  it('keeps a calendar', () => {
    expect(hourOfDay(4)).toBe(1)
    expect(dayOfYear(TICKS_PER_DAY * 3)).toBe(3)
  })

  it('peaks on summer evenings', () => {
    expect(customerShape(74)).toBeGreaterThan(customerShape(12))
    expect(customerShape(JULY_EVENING)).toBeGreaterThan(customerShape(100 * TICKS_PER_DAY + 74))
    expect(ambientC(200 * TICKS_PER_DAY + 60)).toBeGreaterThan(ambientC(10 * TICKS_PER_DAY + 60))
  })

  it('has no sun at night', () => {
    expect(solarFraction(0)).toBe(0)
    expect(solarFraction(48)).toBeGreaterThan(0.5)
  })

  it('opens the campus in phases', () => {
    expect(rampFraction(0, 4)).toBe(0.25)
    expect(rampFraction(50 * TICKS_PER_DAY, 4)).toBe(0.5)
    expect(rampFraction(300 * TICKS_PER_DAY, 4)).toBe(1)
  })

  it('adds demand in a heat wave', () => {
    expect(loadAt(JULY_EVENING, 400, 58.8, 1, 5).customerMw).toBeGreaterThan(PEAK.customerMw)
  })
})

describe('supply', () => {
  it('derates thermal plants in heat', () => {
    const p = operating().plants[0]
    expect(availableMw(p, 0, 38, false)).toBeLessThan(availableMw(p, 0, 15, false))
    expect(availableMw(p, 0, 15, true)).toBe(0)
  })

  it('limits imports, more so in heat', () => {
    const g = operating()
    expect(importLimitMw(g, 20)).toBe(g.system.importLimitMw)
    expect(importLimitMw(g, 38)).toBeLessThan(g.system.importLimitMw * 0.7)
    expect(marketPrice(0, 38)).toBeGreaterThan(marketPrice(0, 20) * 2)
  })

  it('goes short when every plant is out, because imports are limited', () => {
    const g = operating()
    const r = dispatch(g, PEAK, JULY_EVENING, new Set(g.plants.map((p) => p.id)), 'proportional')
    expect(r.marketMw).toBeLessThanOrEqual(g.system.importLimitMw)
    expect(r.unservedContractMw + r.unservedCustomerMw).toBeGreaterThan(250)
  })

  it('buys cheap power before running turbines', () => {
    const g = operating()
    const spring = loadAt(100 * TICKS_PER_DAY, 400, 58.8)
    const r = dispatch(g, spring, 100 * TICKS_PER_DAY, none, 'proportional')
    expect(r.priceMwh).toBeLessThan(62)
    expect(r.marketMw).toBeCloseTo(r.importLimitMw, 0)
  })

  it('runs turbines first when the market is dearer', () => {
    const g = operating()
    const r = dispatch(g, PEAK, JULY_EVENING, none, 'proportional')
    expect(r.priceMwh).toBeGreaterThan(62)
    expect(r.generationMw).toBeGreaterThan(r.marketMw)
  })

  it('balances what is made with what is used', () => {
    const g = operating('230', [['gas-ct', 2], ['battery', 1]])
    for (const t of [0, 4000, JULY_EVENING]) {
      const load = loadAt(t, 400, 58.8)
      const r = dispatch(g, load, t, none, 'proportional')
      expect(r.generationMw + r.marketMw).toBeCloseTo(r.servedMw + r.chargeMw, 3)
    }
  })

  it('never puts more on a line than its rating', () => {
    const g = operating('115')
    const r = dispatch(g, PEAK, JULY_EVENING, none, 'proportional')
    expect(r.lineFlowMw[line(g)]).toBeLessThanOrEqual(150 + 1e-6)
    expect(r.lineFlowMw.tie).toBeLessThanOrEqual(g.system.tieMw + 1e-6)
    expect(r.unservedContractMw).toBeGreaterThan(50)
  })
})

describe('batteries', () => {
  it('run out after about four hours', () => {
    const g = operating('230d', [['battery', 4]])
    const heavy = { ...PEAK, contractMw: 600, totalMw: 600 + PEAK.customerMw }
    let hours = 0
    for (let i = 0; i < 96; i++) {
      const r = dispatch(g, heavy, JULY_EVENING, none, 'proportional')
      if (r.generationMw > 350) hours += 0.25
    }
    expect(hours).toBeGreaterThan(BATTERY_HOURS - 0.6)
    expect(hours).toBeLessThan(BATTERY_HOURS + 0.6)
    expect(g.plants.every((p) => p.socMwh < 1)).toBe(true)
  })

  it('recharge from spare cheap power, with losses', () => {
    const g = operating('230d', [['gas-ct', 3], ['battery', 1]])
    const b = g.plants.find((p) => p.typeId === 'battery')!
    b.socMwh = 0
    const spring = loadAt(100 * TICKS_PER_DAY, 200, 58.8)
    const r = dispatch(g, spring, 100 * TICKS_PER_DAY, none, 'proportional')
    expect(r.chargeMw).toBeGreaterThan(50)
    expect(b.socMwh).toBeLessThan(r.chargeMw * 0.25)
  })

  it('cannot carry a contract alone', () => {
    const g = build({ plants: [['battery', 7]] })
    expect(g.energizedQuarter).toBeNull()
  })
})

describe('who goes without', () => {
  const short = (policy: SheddingPolicy) => {
    const g = operating()
    return dispatch(g, PEAK, JULY_EVENING, new Set(g.plants.slice(0, 2).map((p) => p.id)), policy)
  }

  it('depends on the policy', () => {
    const homes = short('protect-homes')
    const share = short('proportional')
    const campus = short('protect-contract')
    expect(homes.unservedCustomerMw).toBeCloseTo(0, 1)
    expect(campus.unservedCustomerMw).toBeGreaterThan(share.unservedCustomerMw + 1)
    expect(share.unservedCustomerMw).toBeGreaterThan(homes.unservedCustomerMw + 1)
    expect(campus.unservedContractMw).toBeLessThan(share.unservedContractMw)
    expect(share.unservedContractMw).toBeLessThan(homes.unservedContractMw)
  })

  it('delivers the same total either way', () => {
    expect(short('protect-homes').servedMw).toBeCloseTo(short('protect-contract').servedMw, 0)
  })

  it('shares evenly when the lines allow it', () => {
    const r = short('proportional')
    expect(r.unservedContractMw / PEAK.contractMw).toBeCloseTo(r.unservedCustomerMw / PEAK.customerMw, 1)
  })

  it('costs county approval when it is homes', () => {
    const g = operating()
    g.realtime!.policy = 'protect-contract'
    g.realtime!.startTick = 200 * TICKS_PER_DAY
    g.realtime!.tick = 200 * TICKS_PER_DAY
    g.realtime!.startTick = 0
    g.realtime!.nextEventTick = Infinity
    g.contract.inServiceQuarter = 99
    for (const p of g.plants) {
      g.realtime!.outages.push({ assetId: p.id, kind: 'plant', cause: 'test', ticksRemaining: 9999, capacityFraction: 0, crews: 0, startedTick: 0 })
    }
    const before = g.contract.approval!
    for (let i = 0; i < 96; i++) stepRealtime(g, BOUNDS)
    expect(g.contract.approval!).toBeLessThan(before - 3)
    expect(g.penaltiesAccrued).toBeGreaterThan(0)
  })
})

describe('redundancy', () => {
  it('keeps the campus up on one of two circuits', () => {
    const g = operating('230d')
    const r = dispatch(g, PEAK, JULY_EVENING, none, 'proportional', new Map([[line(g), 0.5]]))
    expect(r.unservedContractMw).toBeLessThan(1)
  })

  it('loses most of the campus when a single line is down', () => {
    const g = operating('230')
    const r = dispatch(g, PEAK, JULY_EVENING, none, 'protect-homes', new Map([[line(g), 0]]))
    expect(r.unservedContractMw).toBeGreaterThan(250)
    expect(r.generationMw).toBeLessThan(1)
  })

  it('pays for itself over a year', () => {
    const total = (classId: LineClassId) => [1, 2, 4, 5].reduce((n, seed) =>
      n + operate(build({ seed, classId, style: 'property' })).realtime!.unservedContractMwh, 0)
    expect(total('230d')).toBeLessThan(total('230'))
  }, 60_000)
})

describe('faults', () => {
  it('turns outage rates into sane hazards', () => {
    const p = tripProbability(0.05, 60, false)
    expect(p).toBeGreaterThan(0)
    expect(p).toBeLessThan(0.01)
    expect(tripProbability(0.05, 60, true)).toBeGreaterThan(p * 2)
  })

  it('measures distance to a line', () => {
    expect(distanceToCenterline(5, 3, [[0, 0], [10, 0]])).toBeCloseTo(3, 6)
    expect(distanceToCenterline(14, 0, [[0, 0], [10, 0]])).toBeCloseTo(4, 6)
  })

  it('does less storm damage to a cleared line', () => {
    const storm = { id: 's', x: 0, y: 0, vx: 1, vy: 0, radiusKm: 20, severity: 0.8, ticksRemaining: 10, name: 't' }
    expect(stormDamageChance(storm, 1, false)).toBeLessThan(stormDamageChance(storm, 0, false))
  })

  it('sends crews to the fault the player picked', () => {
    const g = operating()
    const rt = g.realtime!
    rt.crewsTotal = 2
    rt.nextEventTick = Infinity
    const fault = (assetId: string, kind: 'plant' | 'corridor') => ({
      assetId, kind, cause: 't', ticksRemaining: 400, capacityFraction: 0, crews: 0, startedTick: 0,
    })
    rt.outages.push(fault(line(g), 'corridor'), fault(g.plants[0].id, 'plant'))
    stepRealtime(g, BOUNDS)
    expect(rt.outages.find((o) => o.kind === 'corridor')!.crews).toBe(2)
    togglePriority(g, g.plants[0].id)
    stepRealtime(g, BOUNDS)
    expect(rt.outages.find((o) => o.assetId === g.plants[0].id)!.crews).toBe(2)
  })

  it('trips more often with maintenance deferred', () => {
    const trips = (deferred: boolean): number => {
      const g = operating()
      g.rngState = 4242
      g.realtime!.maintenanceDeferred = deferred
      g.realtime!.nextEventTick = Infinity
      g.creditLimit = Infinity
      let n = 0
      for (let i = 0; i < 12_000; i++) {
        n += stepRealtime(g, BOUNDS).events.filter((e) => /tripped offline/.test(e)).length
      }
      return n
    }
    expect(trips(true)).toBeGreaterThan(trips(false))
  })
})

describe('upkeep has a price', () => {
  it('charges for clearing, maintenance and crews', () => {
    const g = operating()
    const base = standingCosts(g)
    g.realtime!.vegetationSpend = 1
    expect(standingCosts(g).vegetation).toBeGreaterThan(base.vegetation)
    g.realtime!.maintenanceDeferred = true
    expect(standingCosts(g).maintenance).toBe(0)
    expect(base.maintenance).toBeGreaterThan(1_000_000)
    setCrews(g, 6)
    expect(standingCosts(g).crews).toBeGreaterThan(base.crews)
    setCrews(g, 50)
    expect(g.realtime!.crewsTotal).toBe(8)
  })

  it('shows up in cash', () => {
    const spent = (veg: number): number => {
      const g = operating()
      g.realtime!.vegetationSpend = veg
      const before = g.cash
      stepRealtime(g, BOUNDS)
      return before - g.cash
    }
    expect(spent(1)).toBeGreaterThan(spent(0))
  })
})

describe('the operating year', () => {
  it('earns revenue and ends after one year', () => {
    const g = operate(build({ classId: '230d', style: 'property' }))
    expect(g.ending).toBe('completed')
    expect(g.realtime!.tick).toBe(OPERATING_YEAR_TICKS)
    expect(g.revenue).toBeGreaterThan(200_000_000)
    expect(g.revenue).toBeGreaterThan(g.realtime!.fuelCost + g.realtime!.marketCost + g.operatingCost)
    expect(g.outcome).not.toBeNull()
  })

  it('moves the quarter along with the clock', () => {
    const g = build({ classId: '230d' })
    const q = g.quarter
    operate(g, { ticks: 92 * TICKS_PER_DAY })
    expect(g.quarter).toBe(q + 1)
  })

  it('reaches summer', () => {
    const days = new Set<number>()
    const g = build({ classId: '230d' })
    operate(g, { onTick: (s) => days.add(dayOfYear(s.realtime!.startTick + s.realtime!.tick)) })
    expect(days.has(200)).toBe(true)
  })

  it('stops for a decision until it is answered', () => {
    const g = operating()
    g.pendingEvent = { id: 'import-offer' }
    stepRealtime(g, BOUNDS)
    expect(g.realtime!.tick).toBe(0)
  })

  it('sounds the alarm once per shortfall', () => {
    const g = operating('230')
    g.realtime!.nextEventTick = Infinity
    g.realtime!.startTick = 0
    g.realtime!.tick = 200 * TICKS_PER_DAY
    g.realtime!.outages.push({ assetId: line(g), kind: 'corridor', cause: 't', ticksRemaining: 4000, capacityFraction: 0, crews: 0, startedTick: 0 })
    let severe = 0
    for (let i = 0; i < 60; i++) if (stepRealtime(g, BOUNDS).severe) severe++
    expect(severe).toBe(1)
  })

  it('keeps finite books over a year', () => {
    const g = operate(build({ classId: '230' }))
    for (const v of [g.cash, g.revenue, g.operatingCost, g.realtime!.servedMwh, g.penaltiesAccrued]) {
      expect(Number.isFinite(v)).toBe(true)
    }
  })

  it('reports availability for the campus alone', () => {
    const rt = createRealtimeState()
    rt.tick = 9600
    rt.servedContractMwh = 90
    rt.unservedContractMwh = 10
    rt.servedCustomerMwh = 100_000
    expect(reliabilityIndices(rt, 42_000).contractAvailability).toBeCloseTo(0.9, 6)
  })

  it('replays the same from the same state', () => {
    const play = (): string => JSON.stringify(operate(build({ seed: 5 }), { ticks: 3000 }).realtime)
    expect(play()).toBe(play())
  })
})
