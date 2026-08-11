/**
 * Real-time operations state.
 *
 * Once the load is energized the game stops being about quarters and starts
 * being about fifteen-minute intervals, because that is the timescale on which
 * the grid actually fails. Everything here is serialisable and lives inside
 * GameState, so a save still captures the whole simulation.
 */

/** Minutes per tick. Fifteen is the interval utilities settle on. */
export const TICK_MINUTES = 15
export const TICKS_PER_HOUR = 60 / TICK_MINUTES
export const TICKS_PER_DAY = 24 * TICKS_PER_HOUR

export type Speed = 0 | 1 | 2 | 4

/**
 * Who gets the power when there isn't enough.
 *
 * This is the game's central moral choice made into a setting, because in the
 * real thing it is a setting too — a pre-agreed curtailment order, decided long
 * before the night it matters.
 */
export type SheddingPolicy =
  /** Curtail the data centre first. Contract penalties, but the lights stay on. */
  | 'protect-homes'
  /** Curtail homes and businesses first. Keeps the contract whole. */
  | 'protect-contract'
  /** Share the pain proportionally. */
  | 'proportional'

export interface Outage {
  /** Plant id or corridor id. */
  assetId: string
  kind: 'plant' | 'corridor'
  cause: string
  /** Ticks of repair work left, before crew effects. */
  ticksRemaining: number
  /**
   * Fraction of the asset's rating still available while this outage lasts.
   * Zero for a dead asset; 0.5 when one circuit of a double-circuit line is
   * down and the other is still carrying. This is what the extra money bought.
   */
  capacityFraction: number
  /** Crews currently working it. */
  crews: number
  /** Tick it began, for the outage report. */
  startedTick: number
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
  speed: Speed
  policy: SheddingPolicy

  outages: Outage[]
  storms: Storm[]
  /** Repair crews available in total. */
  crewsTotal: number

  /** Spend per quarter on keeping vegetation off the line, 0–1. */
  vegetationSpend: number
  /** Deferring maintenance saves money now and raises failure rates. */
  maintenanceDeferred: boolean

  // --- running totals ---
  servedMwh: number
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
  /** Generation dispatched by source, MW. */
  generationMw: number
  marketMw: number
  /** Shortfall, MW. */
  unservedMw: number
  /** Wholesale price this interval, $/MWh. */
  priceMwh: number
  /** How much of the corridor's rating was in use, 0–1+. */
  corridorLoading: number
}

export const HISTORY_LENGTH = 192 // two days at fifteen minutes

export function createRealtimeState(): RealtimeState {
  return {
    tick: 0,
    speed: 0,
    policy: 'proportional',
    outages: [],
    storms: [],
    crewsTotal: 3,
    vegetationSpend: 0.5,
    maintenanceDeferred: false,
    servedMwh: 0,
    unservedContractMwh: 0,
    unservedCustomerMwh: 0,
    fuelCost: 0,
    marketCost: 0,
    customerMinutesLost: 0,
    history: [],
  }
}
