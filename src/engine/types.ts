/**
 * Core simulation types. Pure data — no behaviour, no DOM, no React.
 *
 * GameState is a plain serialisable object: everything needed to reproduce a
 * game is in here, including the RNG cursor. That means a save is just JSON, and
 * a test can assert that the same seed plus the same moves gives the same state.
 */

import type { QuarterIndex } from './time.ts'
import type { PlantKind } from '../data/plants.ts'
import type { LineClassId } from '../data/transmission.ts'
import type { ParcelDeal } from './parcels/negotiation.ts'
import type { Taking } from './parcels/takings.ts'

// --- the deal ------------------------------------------------------------

export interface CapexMilestone {
  id: string
  label: string
  /** Fraction of the advance released when this milestone is met. */
  fraction: number
  /** What has to be true for the developer to release the money. */
  trigger: 'signed' | 'permits-issued' | 'construction-half' | 'energized'
  released: boolean
}

export interface Contract {
  id: string
  /** The campus, as the developer names it. */
  name: string
  developer: string
  countyFips: string
  /** Grid cell index of the campus itself. */
  siteCell: number
  contractedMw: number
  /** Quarter the campus must be able to draw its full contracted load. */
  inServiceQuarter: QuarterIndex
  /** Total capital the developer will front, in dollars. */
  capexAdvance: number
  milestones: CapexMilestone[]
  /** Dollars per quarter of delay past the in-service date. */
  latePenaltyPerQuarter: number
  /** Load the developer pays for whether or not they use it. */
  takeOrPayMw: number
  status: 'offered' | 'accepted' | 'served' | 'failed'
}

// --- assets --------------------------------------------------------------

export type PlantStatus = 'permitting' | 'construction' | 'online' | 'outage'

export interface Plant {
  id: string
  typeId: PlantKind
  name: string
  /** Hex grid cell index. */
  cell: number
  countyFips: string
  status: PlantStatus
  /** Quarters left in the current phase. */
  quartersRemaining: number
  nameplateMw: number
  capexTotal: number
  capexSpent: number
  commissionedQuarter: QuarterIndex | null
  /** Set when the player accelerated the schedule, for the cost report. */
  acceleratedQuarters: number
}

// --- transmission --------------------------------------------------------

export type CorridorStatus =
  | 'planned'    // drawn but not committed; can be rerouted freely
  | 'acquiring'  // buying right-of-way, parcel by parcel
  | 'building'
  | 'energized'

export interface Corridor {
  id: string
  name: string
  classId: LineClassId
  /** Hex cells the route runs through, kept so it can be redrawn or rerouted. */
  cells: number[]
  /** Simplified polyline in projected km — the actual centerline. */
  centerline: Array<[number, number]>
  lengthKm: number
  status: CorridorStatus

  /** Right-of-way negotiation, by parcel id. */
  deals: Record<string, ParcelDeal>
  /** What the corridor takes from each parcel, by parcel id. */
  takings: Record<string, Taking>

  /** How many parcels have been taken by force on this corridor. */
  condemnations: number
  legalCosts: number
  /** Total paid to landowners so far. */
  rowPaid: number

  capexTotal: number
  capexSpent: number
  buildQuartersRemaining: number
  /** Quarters lost to condemnation proceedings. */
  delayQuarters: number
}

// --- places --------------------------------------------------------------

export interface CountyState {
  fips: string
  name: string
  /** 0–100. Below 35 permits slow, below 20 the county starts fighting back. */
  approval: number
  /** Things the county remembers, which is what makes the campaign cumulative. */
  grievances: string[]
}

// --- narrative -----------------------------------------------------------

export type LogKind = 'deal' | 'build' | 'money' | 'politics' | 'grid' | 'weather' | 'system'

export interface LogEntry {
  quarter: QuarterIndex
  kind: LogKind
  text: string
  /** Marks a beat the player should not miss. */
  important?: boolean
}

// --- the whole game ------------------------------------------------------

export interface GameState {
  version: number
  seed: number
  /** RNG cursor; advancing it is what makes outcomes reproducible. */
  rngState: number

  scenarioId: string
  quarter: QuarterIndex
  phase: 'build' | 'operate' | 'ended'

  /** Cash on hand, in dollars. Negative means drawing on the balance sheet. */
  cash: number
  /** Cumulative interest paid on negative balances. */
  financingCost: number
  /** Cumulative late penalties owed to the developer. */
  penaltiesAccrued: number

  contract: Contract
  plants: Plant[]
  corridors: Corridor[]
  counties: Record<string, CountyState>
  log: LogEntry[]

  /** Set once the contract's load can be served, which ends the build phase. */
  energizedQuarter: QuarterIndex | null
}

/** Firm capacity currently online, MW. */
export interface CapacitySummary {
  onlineFirmMw: number
  onlineNameplateMw: number
  underConstructionFirmMw: number
  /** Firm MW still needed to serve the contract. */
  shortfallMw: number
}
