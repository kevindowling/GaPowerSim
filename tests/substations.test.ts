import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { bareGame, node, plantNodeOf, site, sumterSurface } from './helpers/play.ts'
import { fixtures } from './helpers/loadFixtures.ts'
import { inflateSubstation, type Substation } from '../src/data/substations.ts'
import { areaSubstations, commitCorridor, networkNodes, planCorridor } from '../src/engine/turn/corridor.ts'
import { acceptContract } from '../src/engine/turn/resolve.ts'
import { firmDeliverableMw, nodesRoutedToCampus, plantNode, subNode, subVoltages } from '../src/engine/realtime/network.ts'
import { gearName, orderEquipment } from '../src/engine/turn/equipment.ts'
import { isMain, mapHit, withBox } from '../src/ui/mapHit.ts'
import { SUB_POSITION_COST } from '../src/data/taps.ts'
import type { GameState } from '../src/engine/types.ts'
import type { LineClassId } from '../src/data/transmission.ts'

const all: Substation[] = JSON.parse(readFileSync('public/data/gis/substations.json', 'utf8')).map(inflateSubstation)
const grid = () => fixtures().grid
const start = (): GameState => {
  const g = acceptContract(bareGame())
  g.substations = areaSubstations(g, grid(), all)
  return g
}
const near = (g: GameState, kv: number) => g.substations!.find((s) => s.kv === kv)!

const wired = (toId: string, cls: LineClassId = '230'): GameState => {
  let g = site(start(), 'gas-ct', 2)
  const to = networkNodes(g, grid()).find((n) => n.id === toId)!
  g = commitCorridor(g, planCorridor(sumterSurface(), plantNodeOf(g), to, cls)!)
  for (const p of g.plants) p.status = 'online'
  for (const c of g.corridors) c.status = 'energized'
  return g
}

describe('real substations', () => {
  it('cover the service area', () => {
    expect(all.length).toBeGreaterThan(1500)
    expect(new Set(all.map((s) => s.state))).toEqual(new Set(['GA', 'AL', 'MS']))
    expect(all.every((s) => s.kv >= 115)).toBe(true)
    expect(all.some((s) => s.transformers.some((t) => /MVA/.test(t.rating ?? '')))).toBe(true)
  })

  it('near Americus are many, not one', () => {
    const g = start()
    expect(g.substations!.length).toBeGreaterThan(12)
    expect(new Set(g.substations!.map((s) => s.id)).size).toBe(g.substations!.length)
    expect(networkNodes(g, grid()).filter((n) => n.id.startsWith('gsub:'))).toHaveLength(g.substations!.length)
  })
})

describe('a line to one', () => {
  it('reaches the campus through the existing lines', () => {
    const g0 = start()
    const sub = near(g0, 230)
    const g = wired(subNode(sub.id))
    expect(nodesRoutedToCampus(g).has(plantNode(g.plants[0]))).toBe(true)
    expect(firmDeliverableMw(g)).toBe(120)
  })

  it('costs a breaker position, not a station', () => {
    const g = site(start(), 'gas-ct', 1)
    const to = networkNodes(g, grid()).find((n) => n.id === subNode(near(g, 230).id))!
    const p = planCorridor(sumterSurface(), plantNodeOf(g), to, '230')!
    expect(p.taps.cost).toBe(SUB_POSITION_COST)
  })

  it('carries only the voltages it has', () => {
    expect(subVoltages(500)).toEqual([500, 230])
    expect(subVoltages(230)).toEqual([230, 115])
    const g0 = start()
    expect(firmDeliverableMw(wired(subNode(near(g0, 115).id), '115'))).toBe(90)
    expect(firmDeliverableMw(wired(subNode(near(g0, 115).id), '500'))).toBe(0)
  })
})

describe('a transformer at one', () => {
  it('is ordered there, and is named for it', () => {
    const g = start()
    const sub = near(g, 230)
    const s = orderEquipment(g, 'sub-230-115', false, sub.id)
    expect(s.equipment![0].siteId).toBe(sub.id)
    expect(gearName(s, s.equipment![0])).toContain(sub.name)
  })

  it('lets 230 kV power use the 115 kV lines', () => {
    let g = wired('substation')
    g.system.transformerMw = 0
    expect(firmDeliverableMw(g)).toBe(0)
    g = orderEquipment(g, 'sub-230-115', false, near(g, 230).id)
    g.equipment![0].status = 'installed'
    expect(firmDeliverableMw(g)).toBe(90)
  })
})

describe('clicking the grid', () => {
  it('finds substations and lines', () => {
    const g = start()
    const sub = all.find((s) => s.id === near(g, 230).id)!
    const things = { substations: all, lines: [withBox({ kv: 230, points: [[-80, -80], [-60, -80]] })] }
    expect(mapHit(g, grid(), sub.x, sub.y, -1, 24, [], things)).toEqual({ kind: 'gsub', id: sub.id })
    expect(mapHit(g, grid(), -70, -80.05, -1, 24, [], things)).toMatchObject({ kind: 'xline', index: 0 })
    expect(mapHit(g, grid(), -70, -80.05, -1, 2, [], things)).toBeNull()
    expect(all.filter((s) => isMain(g, grid(), s)).length).toBeGreaterThan(0)
    expect(node(g, 'substation').label).toBe('North Americus Substation')
  })
})
