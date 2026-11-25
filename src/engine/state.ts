import type { GameState, Contract, CountyState, Plant, CapacitySummary, LogEntry, LogKind } from './types.ts'
import { plantType, unitCapex, type PlantType } from '../data/plants.ts'
import type { Scenario } from '../data/scenarios.ts'
import { STORAGE_FIRM_SHARE } from './realtime/network.ts'
import type { CountiesFile } from './geo/mapTypes.ts'
import { adjacentCounties } from './geo/adjacency.ts'
import { allUnpaid, paymentSchedule } from './payments.ts'
import { DEFAULT_APPROVAL } from './approval.ts'
import { createTutorialState } from './tutorial.ts'

/** Bump when a saved game from an older build can no longer be loaded. */
export const STATE_VERSION = 2

export function createGame(
  sc: Scenario, siteCell: number, counties: CountiesFile, substationCell: number, seed = sc.seed,
): GameState {
  const countyStates: Record<string, CountyState> = {}
  for (const c of counties.counties) {
    countyStates[c.fips] = { fips: c.fips, name: c.name, grievances: [] }
  }
  const neighbours = adjacentCounties(counties, sc.contract.countyFips)
  for (const fips of neighbours) {
    Object.assign(countyStates[fips], {
      adjacent: true, approval: sc.countyBaselines[fips] ?? DEFAULT_APPROVAL, history: [], programmes: {},
    })
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
    milestones: paymentSchedule(sc),
    latePenaltyPerQuarter: 0,
    takeOrPayMw: sc.contract.takeOrPayMw,
    energyRatePerMwh: sc.contract.energyRatePerMwh,
    shortfallPenaltyPerMwh: sc.contract.shortfallPenaltyPerMwh,
    approval: sc.countyBaselines[sc.contract.countyFips] ?? DEFAULT_APPROVAL,
    history: [],
    programmes: {},
    neighbours,
    phasesOn: 0,
    status: 'offered',
  }

  return {
    version: STATE_VERSION,
    seed,
    rngState: seed,
    scenarioId: sc.id,
    quarter: sc.startQuarter,
    startQuarter: sc.startQuarter,
    phase: 'build',
    ending: null,
    cash: 0,
    financingCost: 0,
    penaltiesAccrued: 0,
    revenue: 0,
    operatingCost: 0,
    creditLimit: sc.creditLimit,
    system: {
      substationName: sc.system.substationName,
      substationCell,
      servedPopulation: sc.system.servedPopulation,
      importLimitMw: sc.system.importLimitMw,
      transformerMw: sc.system.transformerMw,
      tieMw: sc.system.tieMw,
    },
    contract,
    plants: [],
    corridors: [],
    equipment: [],
    counties: countyStates,
    hearing: 'not-called',
    pendingEvent: null,
    firedEvents: [],
    record: { condemnations: 0, rowPaid: 0, legalCosts: 0, routesAbandoned: 0 },
    log: [],
    energizedQuarter: null,
    realtime: null,
    tutorial: sc.tutorial ? createTutorialState() : null,
    outcome: null,
  }
}

export function pushLog(
  state: GameState, kind: LogKind, text: string, important = false,
): void {
  const entry: LogEntry = { quarter: state.quarter, kind, text }
  if (important) entry.important = true
  state.log.push(entry)
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400)
}

export function capacitySummary(state: GameState): CapacitySummary {
  let onlineFirmMw = 0
  let onlineNameplateMw = 0
  let underConstructionFirmMw = 0

  const storageCap = state.contract.contractedMw * STORAGE_FIRM_SHARE
  let storageOnline = 0
  let storageBuilding = 0

  for (const p of state.plants) {
    const t = plantType(p.typeId)
    const firm = p.nameplateMw * t.firmCapacityFraction
    if (t.id === 'battery') {
      if (p.status === 'online') { storageOnline += firm; onlineNameplateMw += p.nameplateMw }
      else storageBuilding += firm
      continue
    }
    if (p.status === 'online') {
      onlineFirmMw += firm
      onlineNameplateMw += p.nameplateMw
    } else if (p.status === 'permitting' || p.status === 'construction') {
      underConstructionFirmMw += firm
    }
  }

  const countedOnline = Math.min(storageCap, storageOnline)
  onlineFirmMw += countedOnline
  underConstructionFirmMw += Math.min(storageCap - countedOnline, storageBuilding)

  return {
    onlineFirmMw,
    onlineNameplateMw,
    underConstructionFirmMw,
    shortfallMw: Math.max(0, state.contract.contractedMw - onlineFirmMw),
  }
}

export function committedCapex(state: GameState): number {
  const plants = state.plants.reduce(
    (sum, p) => sum + (p.status === 'online' ? 0 : p.capexTotal - p.capexSpent), 0)
  const lines = state.corridors.reduce(
    (sum, c) => sum + (c.status === 'energized' ? 0 : c.capexTotal - c.capexSpent), 0)
  const gear = (state.equipment ?? []).reduce((sum, e) => sum + e.capexTotal - e.capexSpent, 0)
  const subs = (state.builtSubs ?? []).reduce((sum, b) => sum + b.capexTotal - b.capexSpent, 0)
  return plants + lines + subs + gear * (1 - (state.ratepayerShare ?? 0))
}

/** Cash plus what is still coming, less what is already promised. */
export function headroom(state: GameState): number {
  return state.cash + allUnpaid(state) - committedCapex(state)
}

/** Quarters until the in-service deadline; negative once it has passed. */
export function quartersToDeadline(state: GameState): number {
  return state.contract.inServiceQuarter - state.quarter
}

export function canFinishInTime(state: GameState, t: PlantType): boolean {
  return t.permitQuarters + t.buildQuarters <= quartersToDeadline(state)
}

/** Next free number for an id prefix. Derived from state, so a save reloads cleanly. */
export function nextId(existing: readonly { id: string }[], prefix: string): number {
  let max = 0
  for (const e of existing) {
    const n = Number(e.id.slice(prefix.length + 1))
    if (e.id.startsWith(`${prefix}-`) && n > max) max = n
  }
  return max + 1
}

export function createPlant(
  state: GameState, typeId: Plant['typeId'], cell: number, countyFips: string, landCost = 0,
): Plant {
  const t = plantType(typeId)
  const n = nextId(state.plants, 'plant')
  const ofType = state.plants.filter((p) => p.typeId === typeId).length + 1
  return {
    id: `plant-${n}`,
    typeId,
    name: `${t.shortName} ${ofType}`,
    cell,
    countyFips,
    status: 'permitting',
    quartersRemaining: t.permitQuarters,
    nameplateMw: t.nameplateMw,
    capexTotal: unitCapex(t),
    capexSpent: 0,
    landCost,
    commissionedQuarter: null,
    acceleratedQuarters: 0,
    socMwh: 0,
  }
}
