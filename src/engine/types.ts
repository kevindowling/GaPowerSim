import type { QuarterIndex } from './time.ts'
import type { PlantKind } from '../data/plants.ts'
import type { LineClassId } from '../data/transmission.ts'
import type { ParcelDeal } from './parcels/negotiation.ts'
import type { Taking } from './parcels/takings.ts'
import type { RealtimeState } from './realtime/types.ts'
import type { EquipmentId } from '../data/equipment.ts'
import type { TutorialState } from './tutorial.ts'
import type { ParcelArchetype } from './parcels/types.ts'

export interface CapexMilestone {
  id: string
  label: string
  /** Fraction of the advance released when this milestone is met. */
  fraction: number
  /** What has to be true for the developer to release the money. */
  trigger: 'signed' | 'phase' | 'permits-issued' | 'construction-half' | 'energized'
  /** Phase that earns it, from 1. */
  phase?: number
  /** Last quarter it pays in full. */
  dueQuarter?: QuarterIndex
  released: boolean
  /** Dollars and quarter, once paid. */
  paid?: number
  paidQuarter?: QuarterIndex
}

/** Local approval. A data center has one, and so does each county bordering its own. */
export interface Rating {
  /** 0 to 100. */
  approval?: number
  /** What moved it. */
  history?: Array<{ quarter: QuarterIndex; text: string; delta: number; outside?: boolean }>
  /** Community programmes: quarter last run and how many times. */
  programmes?: Record<string, { last: QuarterIndex; times: number }>
}

export interface Contract extends Rating {
  /** Counties bordering its own. Absent in older saves. */
  neighbours?: string[]
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
  /** Dollars per quarter of delay. Only in saves from before installments. */
  latePenaltyPerQuarter: number
  /** Minimum load billed while we can serve it, whether or not the campus draws it. */
  takeOrPayMw: number
  /** What the campus pays per MWh. */
  energyRatePerMwh: number
  /** Service-level penalty per MWh asked for and not delivered. */
  shortfallPenaltyPerMwh: number
  /** Phases with power. Absent in older saves. */
  phasesOn?: number
  status: 'offered' | 'accepted' | 'served' | 'failed'
}

/** Running totals by what the money was for, at the end of a quarter. */
export interface CashQuarter { quarter: QuarterIndex; cash: number; totals: Record<string, number> }

/** Another data center the player supplies. */
export interface Customer extends Rating {
  id: string
  name: string
  developer: string
  countyFips: string
  x: number
  y: number
  cell: number
  contractedMw: number
  phaseCount: number
  phaseMw: number
  phasesOn: number
  /** Everything the developer will pay, if it is all on time. */
  advance: number
  milestones: CapexMilestone[]
  ratePerMwh: number
  signedQuarter: QuarterIndex
  status: 'signed' | 'served' | 'cancelled'
  /** Counties bordering its own. */
  neighbours: string[]
  /** Georgia Power's spare power set aside for it. */
  spareMw: number
  revenue: number
  energyCost: number
  /** Georgia Power's customer before the game began. */
  existing?: boolean
  /** Spent connecting it before the game began. */
  spentBefore?: number
  /** Why its size is assumed. */
  assumed?: string
  /** MW that already reaches it. */
  baseMw?: number
  /** Paid for its spare power. */
  spareCost?: number
  /** Given back when it was cancelled. */
  refunded?: number
}

/** A substation the player has built. */
export interface BuiltSubstation {
  id: string
  name: string
  kv: 115 | 230 | 500
  cell: number
  x: number
  y: number
  countyFips: string
  landCost: number
  capexTotal: number
  capexSpent: number
  quartersRemaining: number
  status: 'building' | 'in-service'
  /** On an existing line of its voltage. */
  looped: boolean
  /** Data center whose area it is in. Empty for the first. */
  area: string
}

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
  /** What the site itself cost, kept so withdrawing before construction can refund it. */
  landCost: number
  commissionedQuarter: QuarterIndex | null
  /** Quarters bought back by expediting. Capped, see expeditePlant. */
  acceleratedQuarters: number
  /** Energy in the tank, MWh. Zero for anything that is not storage. */
  socMwh: number
}

export type CorridorStatus =
  | 'planned'    // drawn but not committed; can be rerouted freely
  | 'acquiring'  // buying right-of-way, parcel by parcel
  | 'building'
  | 'energized'

export interface Corridor {
  id: string
  name: string
  classId: LineClassId
  /** Network nodes the line joins. See realtime/network.ts. */
  fromNode: string
  toNode: string
  centerline: Array<[number, number]>
  lengthKm: number
  status: CorridorStatus

  /** Right-of-way negotiation, by parcel id. */
  deals: Record<string, ParcelDeal>
  /** What the corridor takes from each parcel, by parcel id. */
  takings: Record<string, Taking>
  parcels: Record<string, CorridorParcel>

  /** How many parcels have been taken by force on this corridor. */
  condemnations: number
  legalCosts: number
  /** Total paid to landowners so far. */
  rowPaid: number

  capexTotal: number
  capexSpent: number
  buildQuartersRemaining: number
  /** Absent in older saves. */
  filedQuarter?: QuarterIndex
  /** Quarters lost to condemnation proceedings. */
  delayQuarters: number
}

export interface CorridorParcel {
  id: string
  owner: string
  archetype: ParcelArchetype
  countyFips: string
  acres: number
}

export interface CountyState extends Rating {
  fips: string
  name: string
  grievances: string[]
  /** Borders the data center's county. */
  adjacent?: boolean
}

export type LogKind = 'deal' | 'build' | 'money' | 'politics' | 'grid' | 'weather' | 'system'

export interface LogEntry {
  quarter: QuarterIndex
  kind: LogKind
  text: string
  important?: boolean
}

export interface ContractOffer {
  id: string
  name: string
  mw: number
  x: number
  y: number
  opens: QuarterIndex
  /** Last quarter it can be signed. */
  closes: QuarterIndex
}

export interface GameState {
  version: number
  seed: number
  /** RNG cursor; advancing it is what makes outcomes reproducible. */
  rngState: number

  scenarioId: string
  quarter: QuarterIndex
  startQuarter: QuarterIndex
  phase: 'build' | 'operate' | 'ended'
  /** Why the scenario stopped, once it has. */
  ending: Ending | null

  /** Cash on hand, in dollars. Negative means drawing on the balance sheet. */
  cash: number
  /** Cumulative interest paid on negative balances. */
  financingCost: number
  /** Cumulative late penalties owed to the developer. */
  penaltiesAccrued: number
  /** Billed to the campus and to homes since energization. */
  revenue: number
  /** Fixed O&M, maintenance, vegetation and crews since energization. */
  operatingCost: number
  /** Fuel and purchases for phases turned on before the operating year. */
  phaseEnergyCost?: number
  /** How far below zero cash may go before lenders stop. */
  creditLimit: number

  /** The existing grid around the campus. */
  system: LocalSystem

  contract: Contract
  plants: Plant[]
  /** Plant sites whose land touches, by cell. They are wired together. */
  siteLinks?: Array<[number, number]>
  corridors: Corridor[]
  /** Transformers and line upgrades. Absent in older saves, where transformers have no limit. */
  equipment?: Equipment[]
  /** Georgia Power's own money at the start. */
  startingBudget?: number
  /** The opening has been read. Absent in older saves. */
  started?: boolean
  /** Cash at the end of each quarter, and what moved it. */
  cashHistory?: CashQuarter[]
  customers?: Customer[]
  /** Last quarter the first data center can be signed. Absent in older saves. */
  mainCloses?: QuarterIndex
  /** Contracts that come up over the game. Absent in older saves, where all are open at once. */
  offers?: ContractOffer[]
  builtSubs?: BuiltSubstation[]
  /** Spare power set aside for the first data center. */
  mainSpareMw?: number
  /** Firm MW of each plant that other data centers use. */
  reserved?: Record<string, number>
  /** Spent on spare power, upkeep charged to other customers included elsewhere. */
  spareCost?: number
  /** The first data center's part of it. */
  mainSpareCost?: number
  /** Signing money given back when the first data center was lost. */
  refunded?: number
  /** Playing on after the first data center's year. */
  afterYear?: boolean
  /** Other substations nearby, from the map. Absent until the map has loaded. */
  substations?: GridSubstation[]
  /** Share of equipment cost other customers pay, set at the hearing. */
  ratepayerShare?: number
  counties: Record<string, CountyState>

  /** Commission hearing on who pays for network upgrades. */
  hearing: 'not-called' | 'called' | 'resolved'
  /** A decision waiting on the player. */
  pendingEvent: { id: string } | null
  /** Events already seen, so none repeats. */
  firedEvents: string[]
  /** Running record that outlives any one corridor. */
  record: ProjectRecord
  log: LogEntry[]

  /** Set once the contract's load can be served, which ends the build phase. */
  energizedQuarter: QuarterIndex | null

  realtime: RealtimeState | null

  /** Present while the Americus tutorial is running; null in free play. */
  tutorial: TutorialState | null

  /** Set once the scenario has been scored, which ends it. */
  outcome: Outcome | null
}

export type Ending = 'completed' | 'insolvent' | 'terminated' | 'cancelled'

/** A transformer or line upgrade the player has ordered. */
export interface Equipment {
  id: string
  typeId: EquipmentId
  /** Where it is, if not at the first campus or its substation: a substation id or `dc:` and a customer id. */
  siteId?: string
  status: 'ordered' | 'installed'
  quartersRemaining: number
  capexTotal: number
  capexSpent: number
  rush: boolean
}

/** An existing substation of 115 kV or more near the data center. */
export interface GridSubstation {
  id: string
  name: string
  kv: number
  /** Data center whose area it is in. Absent or empty for the first. */
  area?: string
  /** Projected km. */
  x: number
  y: number
  cell: number
}

export interface LocalSystem {
  substationName: string
  substationCell: number
  /** People served from the substation. */
  servedPopulation: number
  /** Most power the wider grid can send here. */
  importLimitMw: number
  /** Existing 230/115 kV transformers at the substation. Absent in older saves. */
  transformerMw?: number
  /** Existing line between the substation and the campus. */
  tieMw: number
}

export interface ProjectRecord {
  condemnations: number
  rowPaid: number
  legalCosts: number
  routesAbandoned: number
}

export interface Outcome {
  /** Quarter the scorecard was produced. */
  quarter: QuarterIndex
  /** Balance at the end, in dollars. Older saves hold a score out of 100. */
  score: number
  headline: string
  lines: Array<{ label: string; value: string; tone: 'good' | 'bad' | 'plain' }>
}

/** Firm capacity currently online, MW. */
export interface CapacitySummary {
  onlineFirmMw: number
  onlineNameplateMw: number
  underConstructionFirmMw: number
  /** Firm MW still needed to serve the contract. */
  shortfallMw: number
}
