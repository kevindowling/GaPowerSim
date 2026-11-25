import type { BuiltSubstation, GameState } from '../types.ts'
import type { HexGrid } from '../geo/mapTypes.ts'
import { OUTSIDE_STATE, PROTECT, PROTECT_BLOCKING } from '../geo/mapTypes.ts'
import { LOOP_KM, substationType } from '../../data/newSubstations.ts'
import { changeRating, NO_PERMITS_BELOW, ratingOf } from '../approval.ts'
import { nextId, pushLog } from '../state.ts'
import { distanceToCenterline } from '../realtime/reliability.ts'
import { areaAt, type ExistingLine } from './corridor.ts'
import { BUILT_UP, cellPoint } from './siting.ts'

export interface SubstationSite {
  ok: boolean
  blocker: string | null
  countyFips: string
  countyName: string
  landCost: number
  approvalCost: number
  /** On an existing line of its voltage. */
  looped: boolean
}

export function assessSubstation(
  state: GameState, kv: number, cell: number, grid: HexGrid, lines: readonly ExistingLine[],
): SubstationSite {
  const t = substationType(kv)
  const base: SubstationSite = { ok: false, blocker: null, countyFips: '', countyName: '', landCost: 0, approvalCost: 0, looped: false }
  const block = (blocker: string): SubstationSite => ({ ...base, blocker })
  if (!state.equipment) return block('This saved game is from before substations. Start a new game.')
  if (state.phase === 'ended') return block('The scenario is over.')
  if (cell < 0 || cell >= grid.county.length || grid.county[cell] === OUTSIDE_STATE) return block('Outside Georgia.')
  const county = grid.manifest.counties[grid.county[cell]]
  base.countyFips = county?.fips ?? ''
  base.countyName = county?.name ?? ''
  const rating = ratingOf(state, base.countyFips)
  if (rating !== null && rating < NO_PERMITS_BELOW) return block(`${base.countyName} County has stopped issuing permits to you.`)
  const prot = grid.protection[cell]
  if ((prot & PROTECT_BLOCKING) !== 0) return block('This is protected land.')
  if ((prot & PROTECT.WATER) !== 0) return block('This is open water.')
  if ((prot & PROTECT.WETLAND) !== 0) return block('This is wetland.')
  if (grid.population[cell] >= BUILT_UP) return block('This is inside a built-up area.')
  if (state.plants.some((p) => p.cell === cell) || (state.builtSubs ?? []).some((b) => b.cell === cell)
    || cell === state.contract.siteCell || cell === state.system.substationCell) return block('Something is already here.')
  const [x, y] = cellPoint(grid, cell)
  const landCost = grid.landValue[cell] * t.acres
  if (state.cash + state.creditLimit < landCost) return block('You do not have the cash or credit to buy this land.')
  return {
    ...base, ok: true, landCost,
    approvalCost: rating === null ? 0 : t.friction * 16 * (0.4 + 2.6 * (grid.population[cell] / 255) ** 1.4),
    looped: lines.some((l) => l.kv >= kv && l.kv < kv * 2 && distanceToCenterline(x, y, l.points as [number, number][]) <= LOOP_KM),
  }
}

/** Build a substation. Returns a new state, or the same one if it cannot go there. */
export function buildSubstation(
  prev: GameState, kv: 115 | 230 | 500, cell: number, grid: HexGrid, lines: readonly ExistingLine[],
): GameState {
  const a = assessSubstation(prev, kv, cell, grid, lines)
  if (!a.ok) return prev
  const state = structuredClone(prev)
  const t = substationType(kv)
  const list = (state.builtSubs ??= [])
  const n = nextId(list, 'sub')
  const [x, y] = cellPoint(grid, cell)
  const b: BuiltSubstation = {
    id: `sub-${n}`, name: `New ${kv} kV substation ${n}`, kv, cell, x, y, countyFips: a.countyFips,
    landCost: a.landCost, capexTotal: t.cost, capexSpent: 0, quartersRemaining: t.quarters,
    status: 'building', looped: a.looped, area: areaAt(state, grid, x, y),
  }
  list.push(b)
  state.cash -= a.landCost
  changeRating(state, a.countyFips, -a.approvalCost, `${b.name} sited`)
  pushLog(state, 'build', `${b.name} sited in ${a.countyName} County: $${(t.cost / 1e6).toFixed(0)}M, ${t.quarters} quarters.${a.looped ? ' It is on an existing line.' : ''}`, true)
  return state
}

export function subFinish(state: GameState, b: BuiltSubstation): number {
  return b.status === 'in-service' ? state.startQuarter : state.quarter + b.quartersRemaining - 1
}

/** Mutates. */
export function advanceSubstations(state: GameState): void {
  for (const b of state.builtSubs ?? []) {
    if (b.status !== 'building') continue
    const spend = (b.capexTotal - b.capexSpent) / Math.max(1, b.quartersRemaining)
    b.capexSpent += spend
    state.cash -= spend
    b.quartersRemaining -= 1
    if (b.quartersRemaining > 0) continue
    b.status = 'in-service'
    pushLog(state, 'grid', `${b.name} is in service.`, true)
  }
}
