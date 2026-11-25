import type { Equipment, GameState } from '../types.ts'
import type { QuarterIndex } from '../time.ts'
import { equipmentType, RUSH_PRICE, RUSH_QUARTERS, type EquipmentId } from '../../data/equipment.ts'
import { nextId, pushLog } from '../state.ts'

/** At most this many of one line upgrade. */
const MAX_AREA = 1

export function equipmentCost(id: EquipmentId, rush: boolean): number {
  return equipmentType(id).cost * (rush ? RUSH_PRICE : 1)
}

export function equipmentQuarters(id: EquipmentId, rush: boolean): number {
  return rush ? RUSH_QUARTERS : equipmentType(id).quarters
}

/** Why one cannot be ordered, or null. */
export function orderBlocked(state: GameState, id: EquipmentId, siteId?: string): string | null {
  if (!state.equipment) return 'This saved game is from before transformers. Start a new game to order one.'
  if (state.phase === 'ended') return 'The scenario is over.'
  const t = equipmentType(id)
  if (t.place === 'area' && state.equipment.filter((e) => e.typeId === id && e.siteId === siteId).length >= MAX_AREA) return 'Already ordered.'
  return null
}

/** Order one. Returns a new state, or the same one if it cannot be ordered. */
export function orderEquipment(prev: GameState, id: EquipmentId, rush = false, siteId?: string): GameState {
  if (orderBlocked(prev, id, siteId)) return prev
  const t = equipmentType(id)
  const fast = rush && t.rush
  const state = structuredClone(prev)
  const list = state.equipment!
  const e: Equipment = {
    id: `gear-${nextId(list, 'gear')}`, typeId: id, status: 'ordered',
    quartersRemaining: equipmentQuarters(id, fast), capexTotal: equipmentCost(id, fast), capexSpent: 0, rush: fast,
    ...(siteId !== undefined && { siteId }),
  }
  list.push(e)
  pushLog(
    state, 'grid',
    `${gearName(state, e)} ordered: $${(e.capexTotal / 1e6).toFixed(1)}M, ${e.quartersRemaining} quarters.`,
    true,
  )
  return state
}

/** Cancel an order. What has been paid is lost. */
export function cancelEquipment(prev: GameState, id: string): GameState {
  const e = prev.equipment?.find((x) => x.id === id)
  if (!e || e.status !== 'ordered') return prev
  const state = structuredClone(prev)
  state.equipment = state.equipment!.filter((x) => x.id !== id)
  pushLog(state, 'grid', `${gearName(state, e)} cancelled. $${(e.capexSpent / 1e6).toFixed(1)}M already paid is lost.`, true)
  return state
}

export function gearName(state: GameState, e: Equipment): string {
  const t = equipmentType(e.typeId)
  const site = state.substations?.find((x) => x.id === e.siteId) ?? state.builtSubs?.find((x) => x.id === e.siteId)
    ?? state.customers?.find((x) => `dc:${x.id}` === e.siteId)
  return site ? `${t.name} at ${site.name}`
    : t.place === 'campus' ? `${t.name} at ${state.contract.name}`
    : t.place === 'substation' ? `${t.name} at ${state.system.substationName}`
    : t.name
}

/** Last quarter of work if nothing slips. */
export function gearFinish(state: GameState, e: Equipment): QuarterIndex {
  return e.status === 'installed' ? state.startQuarter : state.quarter + e.quartersRemaining - 1
}

/** Spend on orders and install what arrives. Mutates. */
export function advanceEquipment(state: GameState): void {
  for (const e of state.equipment ?? []) {
    if (e.status !== 'ordered') continue
    const spend = (e.capexTotal - e.capexSpent) / Math.max(1, e.quartersRemaining)
    e.capexSpent += spend
    state.cash -= spend * (1 - (state.ratepayerShare ?? 0))
    e.quartersRemaining -= 1
    if (e.quartersRemaining > 0) continue
    e.status = 'installed'
    pushLog(state, 'grid', `${gearName(state, e)} is in service, ${equipmentType(e.typeId).mw.toLocaleString()} MW.`, true)
  }
}

/** Total cost of everything ordered. */
export function equipmentTotal(state: GameState): number {
  return (state.equipment ?? []).reduce((n, e) => n + e.capexTotal, 0)
}

/** Paid so far. */
export function equipmentSpent(state: GameState): number {
  return (state.equipment ?? []).reduce((n, e) => n + e.capexSpent, 0)
}
