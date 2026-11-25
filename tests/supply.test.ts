import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { bareGame, node, run, site, sumterSurface, build, operate, defend } from './helpers/play.ts'
import { fixtures } from './helpers/loadFixtures.ts'
import { inflateSubstation } from '../src/data/substations.ts'
import { areaSubstations, commitCorridor, networkNodes, planCorridor } from '../src/engine/turn/corridor.ts'
import { acceptContract, advanceProjects, endQuarter } from '../src/engine/turn/resolve.ts'
import {
  assignSpare, customerQuarter, signBlocked, signCustomer, spareAssigned, spareLeft, termsFor, waitsUntil,
} from '../src/engine/customers.ts'
import { orderEquipment } from '../src/engine/turn/equipment.ts'
import { assessSubstation, buildSubstation } from '../src/engine/turn/substations.ts'
import { firmFlow, dcNode, builtNode, subNode, plannedFlow } from '../src/engine/realtime/network.ts'
import { customerPhases, powerForecast } from '../src/engine/forecast.ts'
import { ratingOf, neighbours } from '../src/engine/approval.ts'
import { allUnpaid, customerUnpaid } from '../src/engine/payments.ts'
import { ledger } from '../src/engine/ledger.ts'
import { canContinue, continueGame, endScenario } from '../src/engine/ending.ts'
import { runProgramme } from '../src/engine/turn/community.ts'
import { drawOutsideEvents } from '../src/engine/events/outside.ts'
import { phasesFor } from '../src/data/customerTerms.ts'
import { poolAt } from '../src/data/sparePower.ts'
import { Rng } from '../src/engine/rng.ts'
import { pointToCell } from '../src/engine/geo/hex.ts'
import { project } from '../src/engine/geo/projection.ts'
import { quarterOf } from '../src/engine/time.ts'
import type { DataCenter } from '../src/data/dataCenters.ts'
import type { GameState } from '../src/engine/types.ts'

const grid = () => fixtures().grid
const counties = () => fixtures().counties
const list: DataCenter[] = JSON.parse(readFileSync('public/data/datacenters.json', 'utf8')).map((d: any) => {
  const [x, y] = project(d.lon, d.lat)
  return { ...d, x, y }
})
const subs = JSON.parse(readFileSync('public/data/gis/substations.json', 'utf8')).map(inflateSubstation)
const by = (name: string): DataCenter => list.find((d) => d.name.includes(name))!
const SAIL = () => by('Project Sail')
const CAMELLIA = () => by('Project Camellia')

const start = (): GameState => acceptContract(bareGame())
const signed = (dc = SAIL(), g = start()): GameState => {
  const s = signCustomer(g, dc, counties(), grid())
  s.substations = areaSubstations(s, grid(), subs)
  return s
}
const c0 = (g: GameState) => g.customers![0]

/** A finished line from a customer to its nearest substation of a voltage, with a transformer. */
const wired = (g0: GameState, kv: 230 | 115 | 500 = 230): GameState => {
  let g = g0
  const c = c0(g)
  const near = g.substations!.filter((s) => s.kv === kv && s.area === c.id).sort((a, b) =>
    Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0]
  const nodes = networkNodes(g, grid())
  const p = planCorridor(sumterSurface(), nodes.find((n) => n.id === dcNode(c.id))!, nodes.find((n) => n.id === subNode(near.id))!, `${kv}` as '230')!
  g = commitCorridor(g, p)
  for (const x of g.corridors) { x.status = 'energized'; x.capexSpent = x.capexTotal }
  g = orderEquipment(g, `campus-${kv}` as 'campus-230', false, dcNode(c.id))
  for (const e of g.equipment!) { e.status = 'installed'; e.capexSpent = e.capexTotal }
  return g
}

describe('signing a data center', () => {
  it('sets phases from its size', () => {
    expect(phasesFor(400)).toEqual({ count: 4, mwEach: 100 })
    expect(phasesFor(900)).toEqual({ count: 5, mwEach: 180 })
    expect(phasesFor(1000)).toEqual({ count: 5, mwEach: 200 })
    expect(phasesFor(3210)).toEqual({ count: 5, mwEach: 642 })
    expect(phasesFor(40)).toEqual({ count: 1, mwEach: 40 })
  })

  it('pays on signing, into the one budget', () => {
    const g = start()
    const s = signed(SAIL(), g)
    const c = c0(s)
    expect(s.customers).toHaveLength(1)
    expect(s.cash - g.cash).toBeCloseTo(c.advance * 0.3)
    expect(s.creditLimit).toBeGreaterThan(g.creditLimit)
    expect(c.milestones).toHaveLength(c.phaseCount + 1)
    expect(allUnpaid(s)).toBeCloseTo(allUnpaid(g) + customerUnpaid(s, c))
  })

  it('is refused when it makes no sense', () => {
    const g = start()
    expect(signBlocked(g, SAIL())).toBeNull()
    expect(signBlocked(g, list.find((d) => d.state === 'AL')!)).toMatch(/It is in AL/)
    expect(signBlocked(g, list.find((d) => d.state === 'GA' && /EMC/.test(d.utility ?? '') && !/Georgia Power/.test(d.utility ?? ''))!)).toMatch(/Another utility/)
    expect(signBlocked(g, list.find((d) => d.state === 'GA' && d.mw === null && d.status === 'proposed' && (!d.utility || d.utility === 'unknown'))!)).toMatch(/not published/)
    expect(signBlocked(signed(), SAIL())).toMatch(/Already/)
    const late = structuredClone(g)
    late.quarter = waitsUntil(g, SAIL()) + 1
    expect(signBlocked(late, SAIL())).toMatch(/another supplier/)
    expect(signBlocked(bareGame(), SAIL())).toMatch(/first contract/)
  })

  it('gives dates after today', () => {
    const t = termsFor(start(), CAMELLIA())
    expect(t.due[0]).toBeGreaterThan(start().quarter)
    expect([...t.due].sort((a, b) => a - b)).toEqual(t.due)
  })
})

describe('supplying it', () => {
  it('needs a line and a transformer of its own', () => {
    const g = assignSpare(signed(), SAIL().id, 900)
    expect(firmFlow(g).loads.get(SAIL().id)).toBe(0)
    const w = wired(g)
    expect(firmFlow(w).loads.get(SAIL().id)).toBeCloseTo(240)
    w.equipment = []
    expect(firmFlow(w).loads.get(SAIL().id)).toBe(0)
  })

  it('is held by the room on existing lines, which can be rebuilt', () => {
    let g = wired(assignSpare(signed(), SAIL().id, 900))
    g = orderEquipment(g, 'area-230', false, dcNode(SAIL().id))
    for (const e of g.equipment!) e.status = 'installed'
    expect(firmFlow(g).loads.get(SAIL().id)).toBeCloseTo(400)
  })

  it('can use a plant at the other end of the state', () => {
    let g = wired(signed())
    g = site(g, 'gas-ct', 1)
    const sub = g.substations!.filter((s) => s.kv === 230 && s.area === '')[0]
    const plant = networkNodes(g, grid()).find((n) => n.id.startsWith('site:'))!
    g = commitCorridor(g, planCorridor(sumterSurface(), plant, networkNodes(g, grid()).find((n) => n.id === subNode(sub.id))!, '230')!)
    for (const x of g.corridors) x.status = 'energized'
    for (const p of g.plants) p.status = 'online'
    const f = firmFlow(g)
    expect(f.loads.get(SAIL().id)).toBeGreaterThan(30)
    expect(f.plants.get('plant-1')!.arrivingMw).toBeCloseTo([...f.loads.values()].reduce((a, b) => a + b, 0))
  })

  it('turns phases on, pays installments and sells power', () => {
    const g = wired(assignSpare(signed(), SAIL().id, 900))
    const cash = g.cash
    advanceProjects(g, new Rng(1))
    const c = c0(g)
    expect(c.phasesOn).toBe(1)
    expect(c.milestones[1].paid).toBeGreaterThan(0)
    expect(g.cash).toBeGreaterThan(cash)
    const q = customerQuarter(g, c, firmFlow(g))!
    expect(q.revenue).toBeCloseTo(180 * 0.95 * 2190 * 90)
    expect(q.energyCost).toBeGreaterThan(0)
    expect(q.spareCost).toBeGreaterThan(0)
    const before = g.cash
    advanceProjects(g, new Rng(1))
    expect(g.cash - before).toBeGreaterThan(-q.spareCost)
    expect(c.revenue).toBeCloseTo(q.revenue)
  })

  it('is in the forecast', () => {
    const g = wired(assignSpare(signed(), SAIL().id, 900))
    for (const e of g.equipment!) { e.status = 'ordered'; e.quartersRemaining = 4 }
    const p = customerPhases(powerForecast(g), c0(g))
    expect(p[0]).toEqual({ on: false, quarter: g.quarter + 3 })
    expect(p[4]).toEqual({ on: false, quarter: null })
    expect(plannedFlow(g).loads.get(SAIL().id)).toBeCloseTo(240)
  })

  it('does not change the first data center', () => {
    const g = build()
    const s = signCustomer({ ...g, phase: 'build' }, SAIL(), counties(), grid())
    expect(firmFlow(s).totalMw).toBeCloseTo(firmFlow(g).totalMw)
  })
})

describe('spare power', () => {
  it('is one pool', () => {
    let g = signed(CAMELLIA(), signed())
    expect(poolAt(g.quarter)).toBe(2733)
    g = assignSpare(g, SAIL().id, 900)
    g = assignSpare(g, CAMELLIA().id, 9999)
    expect(spareAssigned(g)).toBe(2733)
    expect(spareLeft(g)).toBe(0)
    g = assignSpare(g, 'main', 100)
    expect(g.mainSpareMw ?? 0).toBe(0)
    g = assignSpare(g, SAIL().id, 500)
    g = assignSpare(g, 'main', 100)
    expect(g.mainSpareMw).toBe(100)
    expect(spareLeft(g)).toBe(300)
  })

  it('set aside for one does not serve another', () => {
    const g = assignSpare(signed(), SAIL().id, 900)
    expect(firmFlow(g).totalMw).toBe(0)
    expect(firmFlow(wired(g)).totalMw).toBe(0)
  })

  it('reaches the first campus over what the region can send', () => {
    const g = assignSpare(start(), 'main', 400)
    const got = firmFlow(g).totalMw
    expect(got).toBeGreaterThan(20)
    expect(got).toBeLessThan(120)
  })

  it('beyond the pool is bought, for more', () => {
    const g = signed(CAMELLIA())
    g.quarter = quarterOf(2030, 4)
    c0(g).spareMw = 3210
    g.mainSpareMw = 0
    expect(spareLeft(g)).toBeGreaterThan(0)
    g.quarter = quarterOf(2026, 4)
    expect(spareLeft(g)).toBeLessThan(0)
    const cash = g.cash
    advanceProjects(g, new Rng(1))
    expect(g.spareCost).toBeGreaterThan(0)
    expect(g.cash).toBeLessThan(cash)
  })
})

describe('approval', () => {
  it('is its own, with its own neighbours', () => {
    const g = signed()
    const c = c0(g)
    expect(ratingOf(g, c.countyFips)).toBe(c.approval)
    expect(c.neighbours.length).toBeGreaterThan(3)
    expect(neighbours(g)).toHaveLength(8)
    for (const f of c.neighbours) expect(ratingOf(g, f)).not.toBeNull()
    const s = runProgramme(g, c.countyFips, 'fund')
    expect(c0(s).approval!).toBeCloseTo(c.approval! + 9)
    expect(s.contract.approval).toBe(g.contract.approval)
  })

  it('too low cancels it, gives its power back, and the game goes on', () => {
    const g = assignSpare(signed(), SAIL().id, 600)
    c0(g).approval = 20
    const s = endQuarter(g).state
    expect(c0(s).status).toBe('cancelled')
    expect(g.cash - s.cash).toBeCloseTo(c0(g).advance * 0.3, -1)
    expect(s.creditLimit).toBe(start().creditLimit)
    expect(spareAssigned(s)).toBe(0)
    expect(customerUnpaid(s, c0(s))).toBe(0)
    expect(s.ending).toBeNull()
  })

  it('leaves when its power is far too late, and takes the money back', () => {
    const g = signed()
    const due = c0(g).milestones[1].dueQuarter!
    g.quarter = due + 8
    g.contract.inServiceQuarter = 99
    expect(c0(endQuarter(g).state).status).toBe('signed')
    g.quarter = due + 9
    const s = endQuarter(g).state
    expect(c0(s).status).toBe('cancelled')
    expect(s.log.some((l) => /waited 9 quarters/.test(l.text))).toBe(true)
  })

  it('keeps the phases that are on', () => {
    const g = wired(assignSpare(signed(), SAIL().id, 900))
    advanceProjects(g, new Rng(1))
    const c = c0(g)
    c.approval = 10
    const s = endQuarter(g).state
    expect(c0(s)).toMatchObject({ status: 'served', phaseCount: 1, phasesOn: 1, contractedMw: 180 })
    expect(c0(s).refunded).toBeCloseTo(c.advance * 0.3 * 0.8)
    expect(c0(s).spareMw).toBe(180)
    expect(customerUnpaid(s, c0(s))).toBe(0)
  })

  it('losing the first data center leaves the others', () => {
    const g = signed()
    g.contract.approval = 10
    const s = endQuarter(g).state
    expect(s.contract.status).toBe('failed')
    expect(s.ending).toBeNull()
    const alone = start()
    alone.contract.approval = 10
    expect(endQuarter(alone).state.ending).toBe('cancelled')
  })

  it('moves with events at each one', () => {
    let hits = 0
    for (let seed = 1; seed < 12; seed++) {
      const g = signed(SAIL(), acceptContract(bareGame(undefined, seed)))
      for (let i = 0; i < 12; i++) { drawOutsideEvents(g); g.quarter += 1 }
      hits += c0(g).history!.length
    }
    expect(hits).toBeGreaterThan(10)
  })
})

describe('a new substation', () => {
  const lines = [{ kv: 230, points: [[-60, -55], [-40, -55]] as [number, number][] }]
  const cellNear = (x: number, y: number): number => {
    const [col, row] = pointToCell(grid().spec, x, y)
    const near: number[] = []
    for (let dc = -3; dc <= 3; dc++) near.push(row * grid().spec.cols + col + dc)
    return near.find((cell) => assessSubstation(start(), 230, cell, grid(), lines).ok)!
  }

  it('is refused in water, towns and outside Georgia', () => {
    expect(assessSubstation(start(), 230, -1, grid(), []).blocker).toMatch(/Outside/)
    expect(assessSubstation(start(), 230, start().contract.siteCell, grid(), []).ok).toBe(false)
  })

  it('is paid for as it is built, and joins a line it stands on', () => {
    const cell = cellNear(-50, -55)
    let g = buildSubstation(start(), 230, cell, grid(), lines)
    const b = g.builtSubs![0]
    expect(b.looped).toBe(true)
    expect(buildSubstation(g, 230, cell, grid(), lines)).toBe(g)
    const rng = new Rng(1)
    for (let i = 0; i < 6; i++) { advanceProjects(g, rng); g.quarter += 1 }
    expect(g.builtSubs![0].status).toBe('in-service')
    expect(g.builtSubs![0].capexSpent).toBeCloseTo(23e6)

    g = site(g, 'gas-ct', 1)
    const nodes = networkNodes(g, grid())
    const plant = nodes.find((n) => n.id.startsWith('site:'))!
    g = commitCorridor(g, planCorridor(sumterSurface(), plant, nodes.find((n) => n.id === builtNode(b.id))!, '230')!)
    g.corridors[0].status = 'energized'
    g.plants[0].status = 'online'
    expect(firmFlow(g).totalMw).toBe(120)
    g.builtSubs![0].status = 'building'
    expect(firmFlow(g).totalMw).toBe(0)
    g.builtSubs![0].looped = false
    g.builtSubs![0].status = 'in-service'
    expect(firmFlow(g).totalMw).toBe(0)
  })

  it('takes transformers', () => {
    let g = buildSubstation(start(), 230, cellNear(-50, -55), grid(), lines)
    g = orderEquipment(g, 'sub-230-115', false, g.builtSubs![0].id)
    expect(g.log[g.log.length - 1].text).toMatch(/at New 230 kV substation 1/)
    expect(node(g, 'campus')).toBeTruthy()
  })
})

describe('the budget', () => {
  it('adds up, across every data center', () => {
    let g = wired(assignSpare(signed(), SAIL().id, 900))
    g = site(g, 'gas-ct', 2)
    g = defend(run(g, 4))
    const l = ledger(g)
    const net = l.received.reduce((n, r) => n + r.amount, 0) - l.spent.reduce((n, r) => n + r.amount, 0)
    expect(net).toBeCloseTo(g.cash, -4)
    expect(l.perCenter).toHaveLength(2)
    expect(l.perCenter.reduce((n, r) => n + r.paid + r.sold - r.spent, 0) - l.shared).toBeCloseTo(g.cash, -2)
    expect(l.perCenter[1].spent).toBeGreaterThan(1e6)
    expect(l.perCenter[1].paid).toBeGreaterThan(0)
    expect(l.toCome).toBeCloseTo(allUnpaid(g))
  })
})

describe('after the first year', () => {
  it('can carry on for the others, to the end', () => {
    const g = operate(build())
    expect(canContinue(g)).toBe(true)
    const open: GameState = { ...structuredClone(g), ending: null, outcome: null, phase: 'build' }
    const s = signed(list.find((d) => signBlocked(open, d) === null)!, open)
    endScenario(s, 'completed')
    expect(canContinue(s)).toBe(true)
    let t = continueGame(s)
    expect(t.phase).toBe('build')
    expect(t.ending).toBeNull()
    t.creditLimit = 1e12
    for (let i = 0; i < 40 && t.phase === 'build'; i++) t = endQuarter(t).state
    expect(t.ending).toBe('completed')
    expect(t.quarter).toBe(quarterOf(2035, 1))
    expect(t.outcome!.lines.some((l) => l.label === 'Other data centers signed')).toBe(true)
  })
})
