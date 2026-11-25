import type { GameState } from '../types.ts'
import { assignSpare } from '../customers.ts'
import { equipmentQuarters, orderEquipment } from './equipment.ts'
import type { EquipmentId } from '../../data/equipment.ts'
import type { HexGrid } from '../geo/mapTypes.ts'
import { TAP_RANGE_KM, tapClassFor, type TapKv } from '../../data/taps.ts'
import { lineClass, type LineClassId } from '../../data/transmission.ts'
import { phasing } from '../phases.ts'
import {
  CAMPUS, parseGridTap, parseSub, plannedFlow, plannedWithLine, poolMw, subVoltages, tapArea, type PowerFlow,
} from '../realtime/network.ts'
import { areaAt, nearestOn, type ExistingLine, type NetNode } from './corridor.ts'

export interface Need {
  id: string
  name: string
  /** MW of its contract nothing filed will bring. */
  leftMw: number
  /** MW still wanted to turn on its next phase. Zero when all are covered. */
  nextMw: number
}

/** What the data center at a node still needs once everything filed is finished. Null elsewhere. */
export function needAt(state: GameState, nodeId: string, flow: PowerFlow = plannedFlow(state)): Need | null {
  const id = nodeId === CAMPUS ? 'main' : nodeId.startsWith('dc:') ? nodeId.slice(3) : null
  if (id === null) return null
  const c = state.customers?.find((x) => x.id === id)
  if (id !== 'main' && !c) return null
  const total = c ? c.contractedMw : state.contract.contractedMw
  const each = c ? c.phaseMw : phasing(state).mwEach
  const arriving = flow.loads.get(id) ?? 0
  const leftMw = Math.max(0, total - arriving)
  if (leftMw < 0.5) return { id, name: c?.name ?? state.contract.name, leftMw: 0, nextMw: 0 }
  const next = Math.min(total, (Math.floor((arriving + 1e-6) / each) + 1) * each)
  return { id, name: c?.name ?? state.contract.name, leftMw, nextMw: next - arriving }
}

/** Room left on the existing lines of a voltage in an area, after everything filed. */
export function roomLeft(state: GameState, kv: TapKv, area: string, flow: PowerFlow = plannedFlow(state)): number {
  const used = flow.lines.get(area ? `pool:${area}:${kv}` : `pool:${kv}`) ?? 0
  return Math.max(0, poolMw(state, kv, () => true, area) - used)
}

/** MW a new line could take from an existing line or substation. Null for anything else. */
export function roomAt(state: GameState, node: NetNode, classId: LineClassId, flow: PowerFlow = plannedFlow(state)): number | null {
  const cls = lineClass(classId)
  const tap = parseGridTap(node.id)
  if (tap !== null) return Math.min(cls.ratingMw, roomLeft(state, tap, tapArea(node.id), flow))
  const sub = state.substations?.find((s) => s.id === parseSub(node.id))
  if (!sub) return null
  const kv = cls.kv as TapKv
  if (!subVoltages(sub.kv).includes(kv)) return 0
  return Math.min(cls.ratingMw, roomLeft(state, kv, sub.area ?? '', flow))
}

/** Existing lines that could carry a data center's next phase, and those that could not. */
export function sortLines(
  state: GameState, grid: HexGrid, from: NetNode, classId: LineClassId, lines: readonly ExistingLine[],
): { enough: ExistingLine[]; short: ExistingLine[] } {
  const flow = plannedFlow(state)
  const need = needAt(state, from.id, flow)
  if (!need || need.nextMw <= 0) return { enough: [...lines], short: [] }
  const rooms = new Map<string, number>()
  const out = { enough: [] as ExistingLine[], short: [] as ExistingLine[] }
  for (const l of lines) {
    const t = tapClassFor(l.kv)
    const n = nearestOn(l.points, from.x, from.y)
    if (!t || n.d > TAP_RANGE_KM) { out.short.push(l); continue }
    const area = areaAt(state, grid, n.x, n.y)
    const key = `${t.kv}:${area}`
    const room = rooms.get(key) ?? Math.min(lineClass(classId).ratingMw, roomLeft(state, t.kv, area, flow))
    rooms.set(key, room)
    ;(room + 1e-6 >= need.nextMw ? out.enough : out.short).push(l)
  }
  return out
}


export interface LinePower {
  id: string
  name: string
  needMw: number
  /** MW arriving without and with the line, once everything filed is finished. */
  now: number
  then: number
  /** MW arriving with the line, a transformer and all the spare power it could use. */
  most: number
  spareMw: number
  spareArriving: number
  baseMw: number
  phases: { on: number; count: number }
  /** A transformer it still lacks for this line. */
  needsGear: EquipmentId | null
  siteId: string | undefined
}

/** What a new line would bring the data center at one of its ends. Null when it ends at none. */
export function linePower(
  state: GameState, line: { fromNode: string; toNode: string; classId: LineClassId },
): LinePower | null {
  const node = [line.fromNode, line.toNode].find((n) => n === CAMPUS || n.startsWith('dc:'))
  if (!node) return null
  const id = node === CAMPUS ? 'main' : node.slice(3)
  const c = state.customers?.find((x) => x.id === id)
  if (id !== 'main' && !c) return null
  const needMw = c ? c.contractedMw : state.contract.contractedMw
  const spareMw = c ? c.spareMw : state.mainSpareMw ?? 0
  const baseMw = c?.baseMw ?? 0
  const each = c ? c.phaseMw : phasing(state).mwEach
  const count = c ? c.phaseCount : phasing(state).count
  const { kv } = lineClass(line.classId)
  const siteId = c ? node : undefined
  const gear = `campus-${kv}` as EquipmentId
  // The first campus has a 115 kV transformer already.
  const needsGear = state.equipment && (c || kv !== 115)
    && !state.equipment.some((e) => e.typeId === gear && e.siteId === siteId) ? gear : null
  const after = plannedWithLine(state, line)
  const geared = needsGear ? orderEquipment(state, needsGear, false, siteId) : state
  const best = plannedWithLine(assignSpare(geared, id, needMw - baseMw), line).loads.get(id) ?? 0
  const then = after.loads.get(id) ?? 0
  return {
    id, name: c?.name ?? state.contract.name, needMw, then, most: Math.max(then, best), spareMw, baseMw,
    now: plannedFlow(state).loads.get(id) ?? 0, spareArriving: after.spare.get(id) ?? 0,
    phases: { on: Math.min(count, Math.floor((then + 1e-6) / each)), count }, needsGear, siteId,
  }
}

/** Spare power a line to the existing grid could bring, in whole phases. What is set aside now for any other line. */
export function suggestSpare(
  state: GameState, line: { fromNode: string; toNode: string; classId: LineClassId },
): number {
  const p = linePower(state, line)
  if (!p) return 0
  if (![line.fromNode, line.toNode].some((n) => /^(grid:|gsub:|nsub:|substation$)/.test(n))) return p.spareMw
  const geared = p.needsGear ? orderEquipment(state, p.needsGear, false, p.siteId) : state
  const flow = plannedWithLine(assignSpare(geared, p.id, p.needMw - p.baseMw), line)
  const total = flow.loads.get(p.id) ?? 0
  const spare = flow.spare.get(p.id) ?? 0
  const each = p.needMw / p.phases.count
  const whole = Math.floor((total + 1e-6) / each) * each
  // Part of a phase turns nothing on, so it is left for others.
  const wanted = whole > p.baseMw + 0.5 ? Math.max(0, spare - (total - whole)) : 0
  return Math.max(p.spareMw, Math.ceil(wanted - 1e-6))
}

export interface LineGear {
  /** Which end of the line the data center is at. */
  atStart: boolean
  /** 'main' is the first data center. */
  id: string
  state: 'missing' | 'ordered' | 'installed'
  /** 0 to 1, of an order. */
  progress: number
}

/** The transformer at each data center a line ends at. */
export function lineGear(state: GameState, line: { fromNode: string; toNode: string; classId: LineClassId }): LineGear[] {
  if (!state.equipment) return []
  const { kv } = lineClass(line.classId)
  return [line.fromNode, line.toNode].flatMap((n, i): LineGear[] => {
    if (n !== CAMPUS && !n.startsWith('dc:')) return []
    const id = n === CAMPUS ? 'main' : n.slice(3)
    if (id !== 'main' && !state.customers?.some((c) => c.id === id && c.status !== 'cancelled')) return []
    const at = { atStart: i === 0, id }
    const here = state.equipment!.filter((e) => e.typeId === `campus-${kv}` && e.siteId === (id === 'main' ? undefined : n))
    if ((id === 'main' && kv === 115) || here.some((e) => e.status === 'installed')) return [{ ...at, state: 'installed', progress: 1 }]
    if (here.length === 0) return [{ ...at, state: 'missing', progress: 0 }]
    return [{ ...at, state: 'ordered', progress: Math.max(...here.map((e) => 1 - e.quartersRemaining / equipmentQuarters(e.typeId, e.rush))) }]
  })
}
