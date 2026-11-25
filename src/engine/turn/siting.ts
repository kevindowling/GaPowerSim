import type { GameState, Plant } from '../types.ts'
import type { HexGrid } from '../geo/mapTypes.ts'
import { OUTSIDE_STATE, PROTECT, PROTECT_BLOCKING } from '../geo/mapTypes.ts'
import { cellCenter, neighbors, HEX_AREA_KM2 } from '../geo/hex.ts'
import { project } from '../geo/projection.ts'
import { plantType, type PlantType } from '../../data/plants.ts'
import { REACTOR_SITES, REACTOR_SNAP_KM } from '../../data/reactors.ts'
import { createPlant, pushLog } from '../state.ts'
import { changeRating, NO_PERMITS_BELOW, ratingOf } from '../approval.ts'
import { refreshSiteLinks } from './ownedLand.ts'

const ACRES_PER_CELL = HEX_AREA_KM2 * 247.105

/** Population byte above which a cell counts as built up. */
export const BUILT_UP = 168
/** Cooling water has to come from within this many cells. */
const WATER_REACH_CELLS = 6
/** Cost per km to pipe water further than that. */
const PIPELINE_PER_KM = 2_400_000

export interface SiteAssessment {
  ok: boolean
  /** Why the site is unusable, if it is. */
  blocker: string | null
  countyFips: string
  countyName: string
  /** Approval points the county would lose, as a positive number. */
  approvalCost: number
  /** Cells the footprint covers. */
  cells: number[]
  landCost: number
  /** Extra cost on top of the plant, such as a water pipeline. */
  extraCapex: number
  notes: string[]
}

function approvalCost(t: PlantType, populationByte: number): number {
  const density = populationByte / 255
  // A quiet rural site costs about 40% of the friction rating; a populated one, triple.
  const exposure = 0.4 + 2.6 * density ** 1.4
  return t.communityFriction * 16 * exposure
}

/** The cells a footprint of this many acres covers, nearest first. */
export function footprintCells(grid: HexGrid, cell: number, acres: number): number[] {
  const need = Math.max(1, Math.ceil(acres / ACRES_PER_CELL))
  const spec = grid.spec
  const out = [cell]
  const seen = new Set(out)
  const nb: number[] = new Array(12)
  for (let i = 0; i < out.length && out.length < need; i++) {
    const row = Math.floor(out[i] / spec.cols)
    const n = neighbors(spec, out[i] - row * spec.cols, row, nb)
    for (let k = 0; k < n && out.length < need; k++) {
      const c = nb[k * 2 + 1] * spec.cols + nb[k * 2]
      if (!seen.has(c)) { seen.add(c); out.push(c) }
    }
  }
  return out
}

/** Acres already used in each cell by the player's plants. */
function usedAcres(state: GameState, grid: HexGrid): Map<number, number> {
  const used = new Map<number, number>()
  for (const p of state.plants) {
    if (p.typeId === 'nuclear-uprate') continue
    const a = plantType(p.typeId).acres
    const cells = footprintCells(grid, p.cell, a)
    for (const c of cells) used.set(c, (used.get(c) ?? 0) + a / cells.length)
  }
  return used
}

export function cellPoint(grid: HexGrid, cell: number): [number, number] {
  const row = Math.floor(cell / grid.spec.cols)
  return cellCenter(grid.spec, cell - row * grid.spec.cols, row)
}

/** Distance in cells to the nearest water, or null if none is near or mapped. */
function cellsToWater(grid: HexGrid, cell: number, limit: number): number | null {
  const spec = grid.spec
  const wet = PROTECT.WATER | PROTECT.RIVER
  let frontier = [cell]
  const seen = new Set(frontier)
  const nb: number[] = new Array(12)
  for (let d = 0; d <= limit; d++) {
    for (const c of frontier) if ((grid.protection[c] & wet) !== 0) return d
    const next: number[] = []
    for (const c of frontier) {
      const row = Math.floor(c / spec.cols)
      const n = neighbors(spec, c - row * spec.cols, row, nb)
      for (let k = 0; k < n; k++) {
        const x = nb[k * 2 + 1] * spec.cols + nb[k * 2]
        if (!seen.has(x)) { seen.add(x); next.push(x) }
      }
    }
    frontier = next
  }
  return null
}

let gridHasWater: { grid: HexGrid; has: boolean } | null = null
function hasWaterData(grid: HexGrid): boolean {
  if (gridHasWater?.grid !== grid) {
    gridHasWater = { grid, has: grid.protection.some((v) => (v & PROTECT.WATER) !== 0) }
  }
  return gridHasWater.has
}

export function assessSite(
  state: GameState, typeId: Plant['typeId'], cell: number, grid: HexGrid,
): SiteAssessment {
  const t = plantType(typeId)
  const base: SiteAssessment = {
    ok: false, blocker: null, countyFips: '', countyName: '',
    approvalCost: 0, cells: [], landCost: 0, extraCapex: 0, notes: [],
  }
  const block = (blocker: string): SiteAssessment => ({ ...base, blocker })

  if (cell < 0 || cell >= grid.county.length) return block('Outside the map.')
  const countyIdx = grid.county[cell]
  if (countyIdx === OUTSIDE_STATE) return block('Outside Georgia.')

  const fips = grid.manifest.counties[countyIdx]?.fips ?? ''
  const countyName = grid.manifest.counties[countyIdx]?.name ?? 'Unknown'
  const rating = ratingOf(state, fips)
  base.countyFips = fips
  base.countyName = countyName

  if (state.phase === 'ended') return block('The scenario is over.')
  if (rating !== null && fips !== state.contract.countyFips && rating < NO_PERMITS_BELOW) {
    return block(`${countyName} County has stopped issuing permits to you.`)
  }

  if (typeId === 'nuclear-uprate') {
    const [x, y] = cellPoint(grid, cell)
    const near = REACTOR_SITES.find((r) => {
      const [rx, ry] = project(r.lon, r.lat)
      return Math.hypot(rx - x, ry - y) <= REACTOR_SNAP_KM
    })
    if (!near) return block('An uprate has to be at Plant Hatch or Plant Vogtle.')
    if (state.plants.some((p) => p.typeId === 'nuclear-uprate' && p.countyFips === fips)) {
      return block(`${near.name} is already being uprated.`)
    }
    return {
      ...base, ok: true, cells: [cell],
      approvalCost: approvalCost(t, grid.population[cell]) * (rating === null ? 0 : 0.4),
      landCost: 0,
      notes: [`At ${near.name}. Power arrives through the ${state.system.substationName}.`],
    }
  }

  const cells = footprintCells(grid, cell, t.acres)
  const used = usedAcres(state, grid)
  const perCell = t.acres / cells.length
  let peak = 0
  for (const c of cells) {
    const ci = grid.county[c]
    if (ci === OUTSIDE_STATE) return block('Part of this site is outside Georgia.')
    const prot = grid.protection[c]
    if ((prot & PROTECT_BLOCKING) !== 0) return block('Part of this site is protected land.')
    if ((prot & PROTECT.WATER) !== 0) return block('Part of this site is open water.')
    if ((prot & PROTECT.WETLAND) !== 0) return block('Part of this site is wetland.')
    if (c === state.contract.siteCell) return block('The campus is here.')
    if (c === state.system.substationCell) return block('The substation is here.')
    if (grid.population[c] >= BUILT_UP) return block('This is inside a built-up area.')
    if ((used.get(c) ?? 0) + perCell > ACRES_PER_CELL + 1e-6) {
      return block('Not enough room left here beside what you have already sited.')
    }
    peak = Math.max(peak, grid.population[c])
  }

  const notes: string[] = []
  let extraCapex = 0
  const here = state.plants.filter((p) => p.cell === cell).length
  if (here > 0) notes.push(`Shares a site with ${here} other ${here === 1 ? 'unit' : 'units'}.`)
  if (cells.length > 1) notes.push(`Covers about ${cells.length} square kilometres.`)
  if (t.waterGalPerMwh > 150 && hasWaterData(grid)) {
    const d = cellsToWater(grid, cell, 25)
    if (d === null) return block('No river or lake within 25 km to cool this plant.')
    if (d > WATER_REACH_CELLS) {
      extraCapex = (d - WATER_REACH_CELLS) * PIPELINE_PER_KM
      notes.push(`Water is ${d} km away. The pipeline adds $${Math.round(extraCapex / 1e6)}M.`)
    }
  }
  if (peak > 100) notes.push('People live close by. Expect organised opposition.')
  if (t.firmCapacityFraction < 0.3) {
    notes.push(`${Math.round(t.firmCapacityFraction * 100)}% of nameplate counts as firm.`)
  }

  const landCost = cells.reduce((n, c) => n + grid.landValue[c], 0) / cells.length * t.acres
  if (state.cash + state.creditLimit < landCost) {
    return block('You do not have the cash or credit to buy this land.')
  }

  return {
    ...base,
    ok: true,
    approvalCost: rating === null ? 0 : approvalCost(t, peak),
    cells,
    landCost,
    extraCapex,
    notes,
  }
}

export function sitePlant(
  prev: GameState, typeId: Plant['typeId'], cell: number, grid: HexGrid,
): GameState {
  const assessment = assessSite(prev, typeId, cell, grid)
  if (!assessment.ok) return prev
  const state: GameState = structuredClone(prev)

  const plant = createPlant(state, typeId, cell, assessment.countyFips, assessment.landCost)
  plant.capexTotal += assessment.extraCapex
  state.plants.push(plant)
  refreshSiteLinks(state, grid)
  state.cash -= assessment.landCost

  const county = state.counties[assessment.countyFips]
  if (county) {
    changeRating(state, assessment.countyFips, -assessment.approvalCost, `${plant.name} sited`)
    county.grievances.push(`${plant.name} sited`)
  }

  const t = plantType(typeId)
  pushLog(
    state, 'build',
    `${plant.name} sited in ${assessment.countyName} County: ` +
    `$${(plant.capexTotal / 1e6).toFixed(0)}M, ${t.permitQuarters + t.buildQuarters} quarters.`,
    true,
  )
  if (assessment.approvalCost > 12) {
    pushLog(
      state, 'politics',
      `${assessment.countyFips === state.contract.countyFips ? 'Data center' : `${assessment.countyName} County`} approval falls ${Math.round(assessment.approvalCost)} points.`,
    )
  }
  return state
}

/** Share of the land cost recovered by withdrawing before construction. */
export const CANCEL_LAND_RECOVERY = 0.7

export function cancelPlant(prev: GameState, plantId: string): GameState {
  const plant = prev.plants.find((p) => p.id === plantId)
  if (!plant || plant.status !== 'permitting') return prev

  const state: GameState = structuredClone(prev)
  const idx = state.plants.findIndex((p) => p.id === plantId)
  const [removed] = state.plants.splice(idx, 1)
  if (!state.plants.some((p) => p.cell === removed.cell)) {
    state.siteLinks = (state.siteLinks ?? []).filter((l) => !l.includes(removed.cell))
  }
  const landBack = removed.landCost * CANCEL_LAND_RECOVERY
  state.cash += landBack + removed.capexSpent

  pushLog(
    state, 'build',
    `${removed.name} withdrawn. $${(landBack / 1e6).toFixed(1)}M of the land cost recovered.`,
    true,
  )
  return state
}

/** Share of capex one quarter of expediting costs. */
export const EXPEDITE_COST_SHARE = 0.06
export const MAX_EXPEDITE_QUARTERS = 2

export function expediteCost(plant: Plant): number {
  return plant.capexTotal * EXPEDITE_COST_SHARE
}

export function canExpedite(plant: Plant): boolean {
  return plant.status === 'construction'
    && plant.quartersRemaining > 1
    && plant.acceleratedQuarters < MAX_EXPEDITE_QUARTERS
}

/** Pay overtime and delivery premiums to finish a quarter sooner. */
export function expeditePlant(prev: GameState, plantId: string): GameState {
  const target = prev.plants.find((p) => p.id === plantId)
  if (!target || !canExpedite(target)) return prev
  const cost = expediteCost(target)
  if (prev.cash + prev.creditLimit < cost) return prev

  const state: GameState = structuredClone(prev)
  const plant = state.plants.find((p) => p.id === plantId)!
  plant.quartersRemaining -= 1
  plant.acceleratedQuarters += 1
  state.cash -= cost
  pushLog(state, 'build', `${plant.name} expedited one quarter for $${(cost / 1e6).toFixed(0)}M.`, true)
  return state
}
