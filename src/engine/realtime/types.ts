/** Minutes per tick. Fifteen is the interval utilities settle on. */
export const TICK_MINUTES = 15
export const TICKS_PER_HOUR = 60 / TICK_MINUTES
export const TICKS_PER_DAY = 24 * TICKS_PER_HOUR

/** Intervals simulated per clock beat. A beat is a quarter second. */
export type Speed = 0 | 1 | 6 | 24 | 72

export type SheddingPolicy =
  | 'protect-homes'
  /** Curtail homes and businesses first. Keeps the contract whole. */
  | 'protect-contract'
  | 'proportional'

export interface Outage {
  /** Plant id or corridor id. */
  assetId: string
  kind: 'plant' | 'corridor' | 'transformer'
  cause: string
  /** Ticks of repair work left, before crew effects. */
  ticksRemaining: number
  capacityFraction: number
  /** Crews currently working it. */
  crews: number
  /** Tick it began, for the outage report. */
  startedTick: number
  /** Set by the player to pull crews here first. */
  priority?: boolean
}

export interface HeatWave {
  /** Degrees above the seasonal norm. */
  deltaC: number
  ticksUntil: number
  ticksRemaining: number
}

export interface Storm {
  id: string
  /** Position in projected km. */
  x: number
  y: number
  /** Velocity in km per tick. */
  vx: number
  vy: number
  /** Damage radius in km. */
  radiusKm: number
  /** 0–1; scales damage probability. */
  severity: number
  /** Ticks before it dissipates. */
  ticksRemaining: number
  name: string
}

export interface RealtimeState {
  /** Ticks since the moment of energization. */
  tick: number
  /** Calendar tick (from 1 January) at energization. Season and hour use this. */
  startTick: number
  /** Quarters already closed since energization. */
  quartersClosed: number
  /** True while somebody is being curtailed, so the alarm sounds once. */
  inShortfall: boolean
  heatWave: HeatWave | null
  /** Campus load it has agreed to drop on request, and hours left this year. */
  demandResponse: { mw: number; hoursLeft: number } | null
  /** Tick of the next operating decision. */
  nextEventTick: number
  speed: Speed
  policy: SheddingPolicy

  outages: Outage[]
  storms: Storm[]
  /** Repair crews available in total. */
  crewsTotal: number

  /** Vegetation programme, 0–1. Costs money per km of line. */
  vegetationSpend: number
  /** Skips the plant maintenance budget and raises trip rates. */
  maintenanceDeferred: boolean

  servedMwh: number
  servedContractMwh: number
  servedCustomerMwh: number
  /** Data-centre load that could not be served. */
  unservedContractMwh: number
  /** Homes and businesses that could not be served. */
  unservedCustomerMwh: number
  fuelCost: number
  marketCost: number
  /** Customer-minutes of interruption, the numerator of SAIDI. */
  customerMinutesLost: number

  /** Rolling window of recent intervals, for the dashboard chart. */
  history: IntervalRecord[]
}

/** One settled fifteen-minute interval. */
export interface IntervalRecord {
  tick: number
  /** Total demand, MW. */
  loadMw: number
  contractMw: number
  customerMw: number
  /** What was actually delivered. */
  servedMw: number
  /** Output of the player's own plants, MW. */
  generationMw: number
  marketMw: number
  /** Shortfall, MW. */
  unservedMw: number
  /** Wholesale price this interval, $/MWh. */
  priceMwh: number
  importLimitMw: number
  /** Stored energy across all batteries, MWh. */
  storedMwh: number
  /** Busiest line as a fraction of its rating. */
  corridorLoading: number
  unservedContractMw: number
  unservedCustomerMw: number
  lineFlowMw: Record<string, number>
}

export const HISTORY_LENGTH = 192 // two days at fifteen minutes

/** One year of operation, after which the scenario is scored. */
export const OPERATING_YEAR_TICKS = 365 * TICKS_PER_DAY
export const QUARTER_TICKS = Math.round((365 / 4) * TICKS_PER_DAY)

export function createRealtimeState(startTick = 0): RealtimeState {
  return {
    tick: 0,
    startTick,
    quartersClosed: 0,
    inShortfall: false,
    heatWave: null,
    demandResponse: null,
    nextEventTick: 12 * TICKS_PER_DAY,
    speed: 0,
    policy: 'proportional',
    outages: [],
    storms: [],
    crewsTotal: 3,
    vegetationSpend: 0.5,
    maintenanceDeferred: false,
    servedMwh: 0,
    servedContractMwh: 0,
    servedCustomerMwh: 0,
    unservedContractMwh: 0,
    unservedCustomerMwh: 0,
    fuelCost: 0,
    marketCost: 0,
    customerMinutesLost: 0,
    history: [],
  }
}
