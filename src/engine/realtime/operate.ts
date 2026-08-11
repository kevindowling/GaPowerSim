/**
 * The operate loop: one fifteen-minute interval at a time.
 *
 * Build phase asked "can you get it built by the deadline". Operate phase asks
 * the harder question, which is whether what you built actually holds — and it
 * bills you for the answer every interval.
 */

import type { GameState } from '../types.ts'
import { Rng } from '../rng.ts'
import { pushLog } from '../state.ts'
import { loadAt, customerLoadForPopulation } from './load.ts'
import { dispatch } from './dispatch.ts'
import { stepReliability, outAssets, capacityDerates } from './reliability.ts'
import {
  TICK_MINUTES, TICKS_PER_HOUR, HISTORY_LENGTH,
  type RealtimeState, type IntervalRecord,
} from './types.ts'
import { advanceTutorial } from '../tutorial.ts'
import { lineClass } from '../../data/transmission.ts'

/** Dollars per MWh of contracted load not delivered. */
const CONTRACT_SHORTFALL_PENALTY = 420

/**
 * Population served off the same system as the campus.
 *
 * Sumter County plus its neighbours: enough people that curtailing them is a
 * real event, and nowhere near enough that curtailing them rescues a 400 MW
 * shortfall. Both halves of that matter.
 */
const SERVED_POPULATION = 42_000

export interface TickResult {
  /** Things worth surfacing to the player. */
  events: string[]
  severe: boolean
}

/**
 * Advance one interval. Mutates `state` — the operate loop runs many ticks per
 * second, and cloning the whole game state at 4× speed would be wasteful.
 */
export function stepRealtime(
  state: GameState,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): TickResult {
  const rt = state.realtime
  if (!rt) return { events: [], severe: false }

  const rng = new Rng(state.rngState)
  const hours = TICK_MINUTES / 60
  const events: string[] = []
  let severe = false

  // 0. The tutorial's storm is scripted, because the lesson it teaches is the
  //    whole reason the redundancy choice existed and it cannot be left to a
  //    die roll that might never come up.
  for (const event of stageTutorialStorm(state, rt, rng)) {
    events.push(event)
    severe = true
  }

  // 1. What broke, what the weather is doing, what got fixed.
  for (const event of stepReliability(state, rt, rng, bounds)) {
    events.push(event.text)
    if (event.severe) severe = true
  }
  const down = outAssets(rt)
  const derates = capacityDerates(rt)

  // 2. What is being asked for.
  const customerAvg = customerLoadForPopulation(SERVED_POPULATION)
  const load = loadAt(rt.tick, state.contract.contractedMw, customerAvg)

  // 3. What can be made, bought, and delivered — and who goes without.
  const result = dispatch(state, load, rt.tick, down, rt.policy, derates)

  // 4. Bill it.
  rt.fuelCost += result.fuelCost
  rt.marketCost += result.marketCost
  state.cash -= result.fuelCost + result.marketCost

  rt.servedMwh += result.servedMw * hours
  rt.unservedContractMwh += result.unservedContractMw * hours
  rt.unservedCustomerMwh += result.unservedCustomerMw * hours

  if (result.unservedContractMw > 0.5) {
    const penalty = result.unservedContractMw * hours * CONTRACT_SHORTFALL_PENALTY
    state.penaltiesAccrued += penalty
    state.cash -= penalty
  }

  if (result.unservedCustomerMw > 0.5) {
    // Customer-minutes lost, the numerator of SAIDI. Every one of these is a
    // household with the lights off.
    const customersAffected = (result.unservedCustomerMw / Math.max(customerAvg, 1e-6)) * SERVED_POPULATION
    rt.customerMinutesLost += customersAffected * TICK_MINUTES
  }

  // 5. Record the interval for the dashboard.
  const record: IntervalRecord = {
    tick: rt.tick,
    loadMw: load.totalMw,
    contractMw: load.contractMw,
    customerMw: load.customerMw,
    servedMw: result.servedMw,
    generationMw: result.generationMw,
    marketMw: result.marketMw,
    unservedMw: result.unservedContractMw + result.unservedCustomerMw,
    priceMwh: result.priceMwh,
    corridorLoading: result.corridorLoading,
  }
  rt.history.push(record)
  if (rt.history.length > HISTORY_LENGTH) rt.history.shift()

  rt.tick += 1
  state.rngState = rng.state
  advanceTutorial(state)

  return { events, severe }
}

/**
 * Put a storm on the corridor at a fixed point in the tutorial.
 *
 * A single-circuit line loses everything and the campus goes dark. A double
 * circuit loses one side and keeps carrying. Same weather, opposite night, and
 * the difference was chosen hours ago at the voltage-class picker.
 */
function stageTutorialStorm(state: GameState, rt: RealtimeState, rng: Rng): string[] {
  const t = state.tutorial
  if (!t || t.stormFired || rt.tick < t.stormAtTick) return []

  const corridor = state.corridors.find((c) => c.status === 'energized')
  if (!corridor) return []

  t.stormFired = true
  const cls = lineClass(corridor.classId)
  const total = cls.circuits === 1

  // Park a severe cell right on the line so the player can see the cause.
  const mid = corridor.centerline[Math.floor(corridor.centerline.length / 2)] ?? [0, 0]
  rt.storms.push({
    id: `storm-tutorial-${rt.tick}`,
    x: mid[0] - 12,
    y: mid[1],
    vx: 2.2,
    vy: 0,
    radiusKm: 30,
    severity: 0.95,
    ticksRemaining: 26,
    name: 'the line out of Alabama',
  })

  rt.outages.push({
    assetId: corridor.id,
    kind: 'corridor',
    cause: 'structure down',
    ticksRemaining: Math.round(rng.range(10, 20) * TICKS_PER_HOUR),
    capacityFraction: total ? 0 : 1 / cls.circuits,
    crews: 0,
    startedTick: rt.tick,
  })

  return [total
    ? `${cls.name}: structure down in the line out of Alabama. The campus is dark.`
    : `${cls.name}: one circuit lost in the line out of Alabama. The other is carrying the campus.`]
}

/**
 * Switch the game into operate mode.
 *
 * Called the quarter the load is first energized, which is where the game stops
 * being about deadlines and starts being about whether it stays up.
 */
export function beginOperations(state: GameState, rt: RealtimeState): void {
  state.phase = 'operate'
  state.realtime = rt
  pushLog(
    state, 'grid',
    'Operations begin. The campus is drawing, and from here it never stops.',
    true,
  )
}

/** Reliability indices, the way a utility would report them. */
export function reliabilityIndices(rt: RealtimeState): {
  saidiMinutes: number
  contractAvailability: number
  daysOperated: number
} {
  const days = Math.max(1, rt.tick / (24 * (60 / TICK_MINUTES)))
  const totalContractMwh = rt.servedMwh + rt.unservedContractMwh
  return {
    // System Average Interruption Duration Index, annualised.
    saidiMinutes: (rt.customerMinutesLost / SERVED_POPULATION) * (365 / days),
    contractAvailability: totalContractMwh > 0
      ? 1 - rt.unservedContractMwh / totalContractMwh
      : 1,
    daysOperated: days,
  }
}
