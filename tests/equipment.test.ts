import { describe, it, expect } from 'vitest'
import { bareGame, site, plan, node, plantNodeOf, sumterSurface, operate, build, withTransformers } from './helpers/play.ts'
import { commitCorridor, planCorridor } from '../src/engine/turn/corridor.ts'
import { acceptContract, advanceProjects, resolveHearing } from '../src/engine/turn/resolve.ts'
import { HEARING_OPTIONS } from '../src/engine/turn/hearing.ts'
import {
  cancelEquipment, equipmentCost, equipmentTotal, orderBlocked, orderEquipment,
} from '../src/engine/turn/equipment.ts'
import { EQUIPMENT, EQUIPMENT_SOURCES, equipmentType, RUSH_QUARTERS } from '../src/data/equipment.ts'
import {
  firmDeliverableMw, firmFlow, plannedByLinesMw, plannedFirmMw, poolMw, regionMw,
} from '../src/engine/realtime/network.ts'
import { transformers, transformerName } from '../src/engine/realtime/reliability.ts'
import { powerForecast } from '../src/engine/forecast.ts'
import { committedCapex } from '../src/engine/state.ts'
import { stepRealtime } from '../src/engine/realtime/operate.ts'
import { BOUNDS } from './helpers/play.ts'
import { Rng } from '../src/engine/rng.ts'
import type { GameState } from '../src/engine/types.ts'
import type { LineClassId } from '../src/data/transmission.ts'

const start = (): GameState => acceptContract(bareGame())

/** Turbines online on a finished line, with whatever transformers were ordered. */
const wired = (turbines: number, cls: LineClassId = '230', to = 'campus', g0 = start()): GameState => {
  let g = site(g0, 'gas-ct', turbines)
  g = commitCorridor(g, planCorridor(sumterSurface(), plantNodeOf(g), node(g, to), cls)!)
  for (const p of g.plants) p.status = 'online'
  for (const c of g.corridors) c.status = 'energized'
  return g
}
const install = (g: GameState): GameState => {
  for (const e of g.equipment!) { e.status = 'installed'; e.capexSpent = e.capexTotal }
  return g
}

describe('a transformer', () => {
  it('is needed for a line to serve the campus', () => {
    const g = wired(2)
    expect(firmDeliverableMw(g)).toBe(0)
    expect([...firmFlow(g).plants.values()][0].limit).toEqual({ kind: 'no-transformer', place: 'campus', kv: 230 })
    expect(plannedByLinesMw(g)).toBeCloseTo(380)
    expect(firmDeliverableMw(install(orderEquipment(g, 'campus-230')))).toBeCloseTo(380)
  })

  it('has to match the voltage', () => {
    expect(firmDeliverableMw(install(orderEquipment(wired(2), 'campus-500')))).toBe(0)
    expect(firmDeliverableMw(install(orderEquipment(wired(2, '500'), 'campus-500')))).toBeCloseTo(380)
    expect(firmDeliverableMw(wired(2, '115'))).toBe(120)
    expect(firmDeliverableMw(install(orderEquipment(wired(2, '115'), 'campus-115')))).toBe(150)
  })

  it('limits what passes', () => {
    const g = install(orderEquipment(wired(3, '230d'), 'campus-115'))
    expect(firmDeliverableMw(g)).toBe(0)
    const full = install(orderEquipment(wired(3, '500'), 'campus-230'))
    expect(firmDeliverableMw(full)).toBe(0)
  })

  it('at the substation limits what comes through it', () => {
    const g = wired(3, '230', 'substation')
    expect(firmDeliverableMw(g)).toBe(120)
    g.system.transformerMw = 60
    expect(firmDeliverableMw(g)).toBe(60)
    const f = firmFlow(g)
    expect([...f.plants.values()].some((p) => p.limit?.kind === 'lines' && p.limit.ids.includes('tx-sub-1'))).toBe(true)
    expect(firmDeliverableMw(install(orderEquipment(g, 'sub-230-115')))).toBe(120)
  })

  it('at the substation is needed for a 500 kV line to end there', () => {
    const g = wired(3, '500', 'substation')
    expect([...firmFlow(g).plants.values()][0].limit).toEqual({ kind: 'no-transformer', place: 'substation', kv: 500 })
    expect(firmDeliverableMw(install(orderEquipment(g, 'sub-500-230')))).toBe(120)
  })
})

describe('ordering', () => {
  it('takes ten quarters, spreads the cost, and shows in the forecast', () => {
    let g = wired(2)
    g = orderEquipment(g, 'campus-230')
    const e = g.equipment![0]
    expect(e.quartersRemaining).toBe(10)
    expect(committedCapex(g)).toBeGreaterThanOrEqual(e.capexTotal)
    const f = powerForecast(g)
    const ready = f.points.find((p) => p.flow.totalMw > 300)!
    expect(ready.quarter).toBe(g.quarter + 9)
    expect(ready.finishing.join()).toMatch(/230 kV transformer/)
    const cash = g.cash
    const rng = new Rng(1)
    for (let i = 0; i < 9; i++) { advanceProjects(g, rng); g.quarter += 1 }
    expect(firmDeliverableMw(g)).toBe(0)
    advanceProjects(g, rng)
    expect(firmDeliverableMw(g)).toBeCloseTo(380)
    expect(g.equipment![0].capexSpent).toBeCloseTo(equipmentCost('campus-230', false))
    expect(cash - equipmentCost('campus-230', false)).toBeGreaterThan(0)
  })

  it('from stock is quicker and dearer', () => {
    const g = orderEquipment(start(), 'campus-230', true)
    expect(g.equipment![0].quartersRemaining).toBe(RUSH_QUARTERS)
    expect(g.equipment![0].capexTotal).toBeGreaterThan(equipmentCost('campus-230', false))
    expect(orderEquipment(start(), 'area-230', true).equipment![0].rush).toBe(false)
  })

  it('can be cancelled, losing what was paid', () => {
    const g = orderEquipment(start(), 'campus-230')
    advanceProjects(g, new Rng(1))
    const s = cancelEquipment(g, g.equipment![0].id)
    expect(s.equipment).toHaveLength(0)
    expect(s.cash).toBe(g.cash)
    expect(cancelEquipment(install(g), g.equipment![0].id)).toBe(g)
  })

  it('counts toward what is planned', () => {
    const g = wired(2)
    expect(plannedFirmMw(g)).toBe(0)
    expect(plannedFirmMw(orderEquipment(g, 'campus-230'))).toBeCloseTo(380)
  })
})

describe('upgrading existing lines', () => {
  it('adds room, and what the region can send', () => {
    let g = orderEquipment(start(), 'area-230')
    expect(poolMw(g, 230)).toBe(240)
    expect(regionMw(g)).toBe(150)
    g = install(g)
    expect(poolMw(g, 230)).toBe(480)
    expect(regionMw(g)).toBe(300)
    expect(poolMw(install(orderEquipment(start(), 'area-115')), 115)).toBe(180)
    expect(poolMw(install(orderEquipment(start(), 'area-500')), 500)).toBe(1000)
  })

  it('is done once', () => {
    const g = orderEquipment(start(), 'area-230')
    expect(orderBlocked(g, 'area-230')).toMatch(/Already/)
    expect(orderEquipment(g, 'area-230')).toBe(g)
  })
})

describe('the hearing', () => {
  const heard = (i: number): GameState => {
    let g = orderEquipment(start(), 'campus-230')
    advanceProjects(g, new Rng(1))
    g.hearing = 'called'
    return resolveHearing(g, HEARING_OPTIONS[i])
  }

  it('decides who pays for what was ordered, and what comes later', () => {
    const pay = heard(0)
    const rate = heard(2)
    const spent = pay.equipment![0].capexSpent
    expect(rate.cash - pay.cash).toBeCloseTo(spent)
    const cash = rate.cash
    advanceProjects(rate, new Rng(1))
    expect(rate.cash).toBeCloseTo(cash)
    expect(equipmentTotal(pay)).toBe(equipmentCost('campus-230', false))
    expect(committedCapex(rate)).toBe(0)
  })
})

describe('the operating year', () => {
  it('can lose a transformer, and a second one carries on', () => {
    const run = (n: number): number => {
      let g = wired(3, '230d')
      for (let i = 0; i < n; i++) g = orderEquipment(g, 'campus-230')
      install(g)
      advanceProjects(g, new Rng(1))
      expect(g.phase).toBe('operate')
      g.realtime!.outages.push({
        assetId: g.equipment![0].id, kind: 'transformer', cause: 'test', ticksRemaining: 9999,
        capacityFraction: 0, crews: 0, startedTick: 0,
      })
      for (let i = 0; i < 40; i++) stepRealtime(g, BOUNDS)
      return g.realtime!.unservedContractMwh
    }
    expect(run(1)).toBeGreaterThan(100)
    expect(run(2)).toBeLessThan(1)
  })

  it('names every transformer', () => {
    const g = install(orderEquipment(start(), 'campus-230'))
    const names = transformers(g).map((id) => transformerName(g, id))
    expect(names).toHaveLength(4)
    expect(new Set(names).size).toBe(4)
    expect(names.join()).toMatch(/North Americus Substation.*Liberty Americus Campus/)
  })

  it('runs a whole year with them', () => {
    const g = operate(build())
    expect(g.ending).toBe('completed')
    expect(Number.isFinite(g.cash)).toBe(true)
  })
})

describe('a save from before transformers', () => {
  it('has no limit, and cannot order any', () => {
    const g = wired(2)
    delete g.equipment
    expect(firmDeliverableMw(g)).toBeCloseTo(380)
    expect(orderEquipment(g, 'campus-230')).toBe(g)
    expect(transformers(g)).toEqual([])
    expect(plan(withTransformers(site(start(), 'gas-ct', 1)))).toBeTruthy()
  })
})

describe('the figures', () => {
  it('have sources, sizes and prices', () => {
    expect(EQUIPMENT_SOURCES.every((s) => s.url.startsWith('https://'))).toBe(true)
    expect(new Set(EQUIPMENT.map((e) => e.id)).size).toBe(EQUIPMENT.length)
    for (const e of EQUIPMENT) expect(e.mw > 0 && e.cost > 1e6 && e.quarters > 0).toBe(true)
    expect(equipmentType('campus-230').mw).toBe(420)
  })
})
