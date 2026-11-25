import { describe, it, expect } from 'vitest'
import { bareGame, signed } from './helpers/play.ts'
import { fixtures } from './helpers/loadFixtures.ts'
import { CENTERS } from './balance/customers.ts'
import { assignSpare, beginCompany } from '../src/engine/customers.ts'
import { lineGear, linePower, needAt, roomAt, suggestSpare, roomLeft, sortLines } from '../src/engine/turn/reach.ts'
import { orderEquipment } from '../src/engine/turn/equipment.ts'
import { gearPoint } from '../src/render/mapRenderer.ts'
import { networkNodes } from '../src/engine/turn/corridor.ts'
import { CAMPUS, dcNode, plannedFlow } from '../src/engine/realtime/network.ts'

const company = () => beginCompany(bareGame(), CENTERS, fixtures().counties, fixtures().grid)

describe('what a data center still needs', () => {
  it('counts what nothing filed will bring, and the next phase', () => {
    const g = company()
    const t5 = g.customers!.find((c) => c.name.startsWith('T5 ATL III'))!
    expect(needAt(g, dcNode(t5.id))).toMatchObject({ leftMw: 200, nextMw: 100 })
    const keep = g.customers!.find((c) => c.name.startsWith('Switch'))!
    expect(needAt(g, dcNode(keep.id))).toMatchObject({ leftMw: 0, nextMw: 0 })
    expect(needAt(signed(), CAMPUS)).toMatchObject({ leftMw: 400, nextMw: 100 })
    expect(needAt(g, 'substation')).toBeNull()
  })
})

describe('a data center with two phases', () => {
  it('gets nothing from a line alone, and both phases once enough power is set aside', () => {
    const g = company()
    const c = g.customers!.find((x) => x.name.startsWith('Microsoft Douglasville'))!
    expect(c.phaseCount).toBe(2)
    const wired = structuredClone(g)
    wired.substations = [{ id: 'sub-test', name: 'Test', kv: 230, x: c.x + 1, y: c.y, cell: c.cell, area: c.id } as any]
    wired.equipment!.push({ id: 'gear-t', typeId: 'campus-230', status: 'installed', quartersRemaining: 0, capexTotal: 1, capexSpent: 1, rush: false, siteId: dcNode(c.id) } as any)
    wired.corridors.push({ id: 'k', fromNode: dcNode(c.id), toNode: 'gsub:sub-test', classId: '230', status: 'energized', centerline: [[c.x, c.y], [c.x + 1, c.y]], lengthKm: 1, deals: {}, parcels: {}, takings: {}, name: 'K' } as any)
    expect(plannedFlow(wired).loads.get(c.id)).toBeCloseTo(0)
    expect(plannedFlow(assignSpare(wired, c.id, 108)).loads.get(c.id)).toBeCloseTo(108)
    expect(plannedFlow(assignSpare(wired, c.id, 216)).loads.get(c.id)).toBeCloseTo(216)
    // Two thirds of a phase is delivered but turns nothing on.
    const part = plannedFlow(assignSpare(wired, c.id, 180)).loads.get(c.id)!
    expect(Math.floor(part / c.phaseMw)).toBe(1)
    // What it uses is not there for the next line.
    expect(roomLeft(assignSpare(wired, c.id, 216), 230, c.id)).toBeCloseTo(24)
  })
})

describe('what a line brings', () => {
  it('needs a transformer and spare power, and says what both would bring', () => {
    const g = company()
    const c = g.customers!.find((x) => x.name.startsWith('Microsoft Douglasville'))!
    const line = { fromNode: dcNode(c.id), toNode: `grid:230:1.00,1.00@${c.id}`, classId: '230' as const }
    expect(linePower(g, line)).toMatchObject({ then: 0, needsGear: 'campus-230', siteId: dcNode(c.id), phases: { on: 0, count: 2 } })
    expect(linePower(g, line)!.most).toBeCloseTo(216)
    const spared = assignSpare(g, c.id, 216)
    expect(linePower(spared, line)!.then).toBeCloseTo(0)
    const geared = orderEquipment(g, 'campus-230', false, dcNode(c.id))
    expect(linePower(geared, line)).toMatchObject({ then: 0, needsGear: null })
    const both = linePower(assignSpare(geared, c.id, 216), line)!
    expect(both.then).toBeCloseTo(216)
    expect(both.phases.on).toBe(2)
    expect(linePower(g, { ...line, fromNode: 'substation' })).toBeNull()
  })
})

describe('spare power for a line to the grid', () => {
  const line = (id: string, to = `grid:230:1.00,1.00@${id}`) => ({ fromNode: dcNode(id), toNode: to, classId: '230' as const })
  const of = (g: ReturnType<typeof company>, name: string) => g.customers!.find((x) => x.name.startsWith(name))!

  it('is all it needs when it fits, and whole phases when it does not', () => {
    const g = company()
    expect(suggestSpare(g, line(of(g, 'Microsoft Douglasville').id))).toBe(216)
    expect(suggestSpare(g, line(of(g, 'T5 ATL III').id))).toBe(200)
    const union = of(g, 'Union City')
    expect(suggestSpare(g, line(union.id))).toBe(2 * union.phaseMw)
    // A phase is 300 MW and the lines have 240.
    expect(suggestSpare(g, line(of(g, 'Hampton').id))).toBe(0)
  })

  it('is no more than is left, and leaves other lines as they are', () => {
    const g = company()
    const c = of(g, 'Microsoft Douglasville')
    const big = of(g, 'Hampton')
    const tight = assignSpare(assignSpare(g, big.id, 1500), of(g, 'White Oak').id, 1110)
    expect(suggestSpare(tight, line(c.id))).toBe(108)
    expect(suggestSpare(g, line(c.id, 'site:5'))).toBe(0)
    expect(suggestSpare(assignSpare(g, c.id, 50), line(c.id, 'site:5'))).toBe(50)
  })
})

describe('the transformer marked on a line', () => {
  it('is missing, then ordered with its progress, then in service', () => {
    const g = company()
    const c = g.customers!.find((x) => x.name.startsWith('Microsoft Douglasville'))!
    const line = { fromNode: 'gsub:a', toNode: dcNode(c.id), classId: '230' as const }
    expect(lineGear(g, line)).toEqual([{ atStart: false, id: c.id, state: 'missing', progress: 0 }])
    const o = orderEquipment(g, 'campus-230', false, dcNode(c.id))
    expect(lineGear(o, line)[0]).toMatchObject({ state: 'ordered', progress: 0 })
    o.equipment![o.equipment!.length - 1].quartersRemaining = 4
    expect(lineGear(o, line)[0].progress).toBeCloseTo(0.6)
    o.equipment![o.equipment!.length - 1].status = 'installed'
    expect(lineGear(o, line)[0].state).toBe('installed')
    expect(lineGear(o, { ...line, classId: '500' })[0].state).toBe('missing')
  })

  it('is already there for 115 kV at the first campus, and nowhere else on a line', () => {
    const g = bareGame()
    expect(lineGear(g, { fromNode: CAMPUS, toNode: 'site:4', classId: '115' })[0]).toMatchObject({ atStart: true, id: 'main', state: 'installed' })
    expect(lineGear(g, { fromNode: CAMPUS, toNode: 'site:4', classId: '230' })[0].state).toBe('missing')
    expect(lineGear(g, { fromNode: 'gsub:a', toNode: 'site:4', classId: '230' })).toEqual([])
  })

  it('sits on the line, clear of the data center, at any zoom', () => {
    expect(gearPoint([[0, 0], [10, 0]], true, 10)).toEqual([4.2, 0])
    expect(gearPoint([[0, 0], [10, 0]], false, 10)[0]).toBeCloseTo(5.8)
    expect(gearPoint([[0, 0], [1, 0]], true, 10)[0]).toBeCloseTo(4.2)
  })
})

describe('room on existing lines', () => {
  it('is limited by the voltage, the area and the new line', () => {
    const g = company()
    const c = g.customers!.find((x) => x.name.startsWith('T5 ATL III'))!
    expect(roomLeft(g, 115, c.id)).toBe(90)
    expect(roomLeft(g, 230, c.id)).toBe(240)
    const tap = (kv: number) => ({ id: `grid:${kv}:1.00,1.00@${c.id}`, label: '', cell: 0, x: 1, y: 1 })
    expect(roomAt(g, tap(230), '115')).toBe(150)
    expect(roomAt(g, tap(230), '230')).toBe(240)
    expect(roomAt(g, networkNodes(g, fixtures().grid)[0], '230')).toBeNull()
  })

  it('splits lines by whether they can carry the next phase', () => {
    const g = company()
    const c = g.customers!.find((x) => x.name.startsWith('T5 ATL III'))!
    const from = networkNodes(g, fixtures().grid).find((n) => n.id === dcNode(c.id))!
    const line = (kv: number, dx = 1) => ({ kv, points: [[c.x + dx, c.y], [c.x + dx, c.y + 1]] as [number, number][] })
    const r = sortLines(g, fixtures().grid, from, '230', [line(115), line(230), line(500), line(230, 120)])
    expect(r.enough.map((l) => l.kv)).toEqual([230, 500])
    expect(r.short).toHaveLength(2)
  })
})
