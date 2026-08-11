/**
 * Game state construction and the read-only queries the UI asks of it.
 *
 * Mutation happens in engine/turn/*. Everything here either builds a fresh state
 * or answers a question about one.
 */

import type { GameState, Contract, CountyState, Plant, CapacitySummary, LogEntry, LogKind } from './types.ts'
import { plantType, unitCapex, type PlantType } from '../data/plants.ts'
import { DEFAULT_COUNTY_APPROVAL, type Scenario } from '../data/scenarios.ts'
import type { CountiesFile } from './geo/mapTypes.ts'

export const STATE_VERSION = 1

/** Fraction of the advance released at each milestone. Must sum to 1. */
const MILESTONE_SCHEDULE = [
  { id: 'signing', label: 'Contract signed', fraction: 0.2, trigger: 'signed' as const },
  { id: 'permits', label: 'Permits issued', fraction: 0.2, trigger: 'permits-issued' as const },
  { id: 'halfway', label: 'Construction half complete', fraction: 0.3, trigger: 'construction-half' as const },
  { id: 'energized', label: 'Load energized', fraction: 0.3, trigger: 'energized' as const },
]

export function createGame(sc: Scenario, siteCell: number, counties: CountiesFile): GameState {
  const countyStates: Record<string, CountyState> = {}
  for (const c of counties.counties) {
    countyStates[c.fips] = {
      fips: c.fips,
      name: c.name,
      approval: sc.countyBaselines[c.fips] ?? DEFAULT_COUNTY_APPROVAL,
      grievances: [],
    }
  }

  const contract: Contract = {
    id: sc.id,
    name: sc.contract.name,
    developer: sc.contract.developer,
    countyFips: sc.contract.countyFips,
    siteCell,
    contractedMw: sc.contract.contractedMw,
    inServiceQuarter: sc.contract.inServiceQuarter,
    capexAdvance: sc.contract.capexAdvance,
    milestones: MILESTONE_SCHEDULE.map((m) => ({ ...m, released: false })),
    latePenaltyPerQuarter: sc.contract.latePenaltyPerQuarter,
    takeOrPayMw: sc.contract.takeOrPayMw,
    status: 'offered',
  }

  return {
    version: STATE_VERSION,
    seed: sc.seed,
    rngState: sc.seed,
    scenarioId: sc.id,
    quarter: sc.startQuarter,
    phase: 'build',
    cash: 0,
    financingCost: 0,
    penaltiesAccrued: 0,
    contract,
    plants: [],
    corridors: [],
    counties: countyStates,
    log: [],
    energizedQuarter: null,
  }
}

// --- log -----------------------------------------------------------------

export function pushLog(
  state: GameState, kind: LogKind, text: string, important = false,
): void {
  const entry: LogEntry = { quarter: state.quarter, kind, text }
  if (important) entry.important = true
  state.log.push(entry)
  // The log is narrative, not an audit trail; old quarters stop mattering.
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400)
}

// --- queries -------------------------------------------------------------

/** Firm capacity is what actually keeps a data center up, so it leads. */
export function capacitySummary(state: GameState): CapacitySummary {
  let onlineFirmMw = 0
  let onlineNameplateMw = 0
  let underConstructionFirmMw = 0

  for (const p of state.plants) {
    const t = plantType(p.typeId)
    const firm = p.nameplateMw * t.firmCapacityFraction
    if (p.status === 'online') {
      onlineFirmMw += firm
      onlineNameplateMw += p.nameplateMw
    } else if (p.status === 'permitting' || p.status === 'construction') {
      underConstructionFirmMw += firm
    }
  }

  return {
    onlineFirmMw,
    onlineNameplateMw,
    underConstructionFirmMw,
    shortfallMw: Math.max(0, state.contract.contractedMw - onlineFirmMw),
  }
}

/** Capital committed but not yet spent — money that is already promised. */
export function committedCapex(state: GameState): number {
  return state.plants.reduce(
    (sum, p) => sum + (p.status === 'online' ? 0 : p.capexTotal - p.capexSpent),
    0,
  )
}

/** Quarters until the in-service deadline; negative once it has passed. */
export function quartersToDeadline(state: GameState): number {
  return state.contract.inServiceQuarter - state.quarter
}

/**
 * Whether a plant ordered now could physically be online by the deadline.
 * The UI uses this to warn before the player spends half a billion dollars on
 * something that cannot arrive in time.
 */
export function canFinishInTime(state: GameState, t: PlantType): boolean {
  return t.permitQuarters + t.buildQuarters <= quartersToDeadline(state)
}

export function countyApproval(state: GameState, fips: string): number {
  return state.counties[fips]?.approval ?? DEFAULT_COUNTY_APPROVAL
}

/** Descriptive band for an approval score, used in the UI and in event text. */
export function approvalBand(approval: number): {
  label: string
  tone: 'good' | 'fair' | 'poor' | 'hostile'
} {
  if (approval >= 65) return { label: 'Supportive', tone: 'good' }
  if (approval >= 45) return { label: 'Uneasy', tone: 'fair' }
  if (approval >= 25) return { label: 'Opposed', tone: 'poor' }
  return { label: 'Hostile', tone: 'hostile' }
}

// --- construction --------------------------------------------------------

let plantCounter = 0

/** Reset between games so plant ids stay deterministic across a reload. */
export function resetPlantCounter(): void {
  plantCounter = 0
}

export function createPlant(
  typeId: Plant['typeId'], cell: number, countyFips: string,
): Plant {
  const t = plantType(typeId)
  plantCounter += 1
  return {
    id: `plant-${plantCounter}`,
    typeId,
    name: `${t.name} ${plantCounter}`,
    cell,
    countyFips,
    status: 'permitting',
    quartersRemaining: t.permitQuarters,
    nameplateMw: t.nameplateMw,
    capexTotal: unitCapex(t),
    capexSpent: 0,
    commissionedQuarter: null,
    acceleratedQuarters: 0,
  }
}
