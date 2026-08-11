/**
 * Siting: choosing where a plant goes, and living with who lives there.
 *
 * The decision is deliberately not a pure cost calculation. The cheapest, most
 * convenient site is usually close to the load and close to a road, which is
 * also where people are — and people are the thing that can stop a project.
 */

import type { GameState, Plant } from '../types.ts'
import type { HexGrid } from '../geo/mapTypes.ts'
import { OUTSIDE_STATE } from '../geo/mapTypes.ts'
import { plantType, type PlantType } from '../../data/plants.ts'
import { createPlant, pushLog } from '../state.ts'

/** Acres in a square kilometre, for turning a footprint into cells. */
const ACRES_PER_KM2 = 247.105

export interface SiteAssessment {
  ok: boolean
  /** Why the site is unusable, if it is. */
  blocker: string | null
  countyFips: string
  countyName: string
  /** Approval points the county would lose, as a positive number. */
  approvalCost: number
  /** Cells the footprint needs. */
  cellsNeeded: number
  /** Land acquisition cost for the plant site itself, in dollars. */
  landCost: number
  /** Plain-language notes shown before the player commits. */
  notes: string[]
}

/**
 * How much a county minds a given plant on a given cell.
 *
 * Friction scales with how many people are nearby, because a gas turbine in the
 * middle of a pine plantation and the same turbine two miles from a subdivision
 * are not the same proposal.
 */
function approvalCost(t: PlantType, populationByte: number): number {
  const density = populationByte / 255
  // A quiet rural site costs ~40% of the friction rating; a populated one, triple.
  const exposure = 0.4 + 2.6 * density ** 1.4
  return t.communityFriction * 16 * exposure
}

export function assessSite(
  state: GameState, typeId: Plant['typeId'], cell: number, grid: HexGrid,
): SiteAssessment {
  const t = plantType(typeId)
  const empty: SiteAssessment = {
    ok: false, blocker: null, countyFips: '', countyName: '',
    approvalCost: 0, cellsNeeded: 0, landCost: 0, notes: [],
  }

  if (cell < 0 || cell >= grid.county.length) {
    return { ...empty, blocker: 'Outside the map.' }
  }
  const countyIdx = grid.county[cell]
  if (countyIdx === OUTSIDE_STATE) {
    return { ...empty, blocker: 'Outside Georgia. Georgia Power cannot site here.' }
  }

  const fips = grid.manifest.counties[countyIdx]?.fips ?? ''
  const countyName = grid.manifest.counties[countyIdx]?.name ?? 'Unknown'
  const county = state.counties[fips]

  const cellsNeeded = Math.max(1, Math.ceil(t.acres / ACRES_PER_KM2))
  const landCost = grid.landValue[cell] * t.acres
  const cost = approvalCost(t, grid.population[cell])

  const notes: string[] = []
  if (t.acres > 500) {
    notes.push(`${t.acres.toLocaleString()} acres — roughly ${cellsNeeded} km² of land assembled.`)
  }
  if (t.waterGalPerMwh > 150) {
    notes.push('Significant consumptive water use. Expect questions about the river.')
  }
  if (grid.population[cell] > 140) {
    notes.push('This site is close to where people live. Opposition will be organised.')
  }
  if (t.firmCapacityFraction < 0.3) {
    notes.push(`Only ${Math.round(t.firmCapacityFraction * 100)}% of nameplate counts toward firm capacity.`)
  }

  // A county already at rock bottom stops issuing permits at all.
  if (county && county.approval < 12) {
    return {
      ...empty,
      blocker: `${countyName} County has stopped permitting. You have spent your welcome here.`,
      countyFips: fips, countyName,
    }
  }

  return {
    ok: true,
    blocker: null,
    countyFips: fips,
    countyName,
    approvalCost: cost,
    cellsNeeded,
    landCost,
    notes,
  }
}

/** Commit to a site. Returns a new state; assumes `assessSite` said ok. */
export function sitePlant(
  prev: GameState, typeId: Plant['typeId'], cell: number, grid: HexGrid,
): GameState {
  const state: GameState = structuredClone(prev)
  const assessment = assessSite(state, typeId, cell, grid)
  if (!assessment.ok) return prev

  const plant = createPlant(typeId, cell, assessment.countyFips)
  state.plants.push(plant)
  state.cash -= assessment.landCost

  const county = state.counties[assessment.countyFips]
  if (county) {
    county.approval = Math.max(0, county.approval - assessment.approvalCost)
    county.grievances.push(`${plant.name} sited ${state.quarter === 0 ? 'at the outset' : 'here'}`)
  }

  pushLog(
    state, 'build',
    `${plant.name} sited in ${assessment.countyName} County — ` +
    `$${(plant.capexTotal / 1e6).toFixed(0)}M, ${plantType(typeId).permitQuarters + plantType(typeId).buildQuarters} quarters to power.`,
    true,
  )
  if (assessment.approvalCost > 12) {
    pushLog(
      state, 'politics',
      `${assessment.countyName} County approval falls ${Math.round(assessment.approvalCost)} points.`,
    )
  }
  return state
}
