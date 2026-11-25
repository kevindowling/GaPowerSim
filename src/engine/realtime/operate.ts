import type { GameState } from '../types.ts'
import { Rng } from '../rng.ts'
import { loadAt, customerLoadForPopulation, rampFraction, dayOfYear, hourOfDay } from './load.ts'
import { dispatch, type DispatchResult } from './dispatch.ts'
import { stepReliability, outAssets, capacityDerates } from './reliability.ts'
import {
  TICK_MINUTES, TICKS_PER_HOUR, TICKS_PER_DAY, HISTORY_LENGTH, QUARTER_TICKS,
  OPERATING_YEAR_TICKS,
  type RealtimeState, type IntervalRecord,
} from './types.ts'
import { advanceTutorial } from '../tutorial.ts'
import { changeApproval } from '../approval.ts'
import { advanceProjects } from '../turn/resolve.ts'
import { drawOperatingEvent } from '../events/events.ts'
import { recordCash } from '../cashForecast.ts'
import { checkCustomers } from '../customers.ts'
import { drawOutsideEvents } from '../events/outside.ts'
import { endScenario, checkEnding } from '../ending.ts'
import { lineClass } from '../../data/transmission.ts'
import { plantType } from '../../data/plants.ts'
import { SCENARIOS } from '../../data/scenarios.ts'

/** What homes and businesses pay per MWh. */
const RETAIL_RATE = 92
/** Regulator penalty per MWh of homes curtailed. */
const CUSTOMER_SHORTFALL_PENALTY = 2_500

/** Dollars per kW-year of routine plant maintenance, skipped when deferred. */
export const MAINTENANCE_PER_KW_YEAR = 14
/** Dollars per km-year of right-of-way clearing at 100%. */
export const VEGETATION_PER_KM_YEAR = 95_000
/** Dollars per crew-year. */
export const CREW_COST_PER_YEAR = 1_400_000
export const MIN_CREWS = 1
export const MAX_CREWS = 8

/** What the campus is paid per MWh for dropping load on request. */
const DEMAND_RESPONSE_RATE = 250

const HOURS_PER_YEAR = 8760

export interface TickResult {
  events: string[]
  /** Serious enough to stop the clock. */
  severe: boolean
}

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

/** Yearly cost of the standing programme, by part. */
export function standingCosts(state: GameState): {
  fixedOm: number; maintenance: number; vegetation: number; crews: number
} {
  const rt = state.realtime
  const online = state.plants.filter((p) => p.status === 'online')
  const fixedOm = online.reduce(
    (n, p) => n + plantType(p.typeId).fixedOmPerKwYear * p.nameplateMw * 1000, 0)
  const maintenance = rt?.maintenanceDeferred ? 0 : online.reduce(
    (n, p) => n + MAINTENANCE_PER_KW_YEAR * p.nameplateMw * 1000, 0)
  const km = state.corridors
    .filter((c) => c.status === 'energized')
    .reduce((n, c) => n + c.lengthKm, 0)
  return {
    fixedOm,
    maintenance,
    vegetation: (rt?.vegetationSpend ?? 0) * VEGETATION_PER_KM_YEAR * km,
    crews: (rt?.crewsTotal ?? 0) * CREW_COST_PER_YEAR,
  }
}

function phasesFor(state: GameState): number {
  return SCENARIOS.find((s) => s.id === state.scenarioId)?.phasing.count ?? 1
}

/** Advance one interval. Mutates `state`: cloning every tick would be wasteful. */
export function stepRealtime(state: GameState, bounds: Bounds): TickResult {
  const rt = state.realtime
  if (!rt || state.phase !== 'operate' || state.pendingEvent) return { events: [], severe: false }

  const rng = new Rng(state.rngState)
  const hours = TICK_MINUTES / 60
  const calendar = rt.startTick + rt.tick
  const events: string[] = []
  let severe = false

  for (const event of stageTutorialStorm(state, rt, rng)) {
    events.push(event)
    severe = true
  }

  const heat = stepHeatWave(rt, rng, calendar)
  if (heat) events.push(heat)
  for (const event of stepReliability(state, rt, rng, bounds)) {
    events.push(event.text)
    if (event.severe) severe = true
  }

  const customerAvg = customerLoadForPopulation(state.system.servedPopulation)
  const heatC = rt.heatWave && rt.heatWave.ticksUntil <= 0 ? rt.heatWave.deltaC : 0
  const load = loadAt(
    calendar, state.contract.contractedMw, customerAvg,
    state.contract.phasesOn === undefined ? rampFraction(rt.tick, phasesFor(state)) : 1, heatC,
  )

  const down = outAssets(rt)
  const derates = capacityDerates(rt)
  const socBefore = state.plants.map((p) => p.socMwh)
  let result: DispatchResult = dispatch(state, load, calendar, down, rt.policy, derates)
  let droppedMw = 0
  const short = result.unservedContractMw + result.unservedCustomerMw
  if (short > 0.5 && rt.demandResponse && rt.demandResponse.hoursLeft > 0) {
    droppedMw = Math.min(rt.demandResponse.mw, short, load.contractMw)
    const reduced = {
      ...load,
      contractMw: load.contractMw - droppedMw,
      totalMw: load.totalMw - droppedMw,
    }
    state.plants.forEach((p, i) => { p.socMwh = socBefore[i] })
    result = dispatch(state, reduced, calendar, down, rt.policy, derates)
    rt.demandResponse.hoursLeft -= hours
    const paid = droppedMw * hours * DEMAND_RESPONSE_RATE
    state.operatingCost += paid
    state.cash -= paid
  }

  rt.fuelCost += result.fuelCost
  rt.marketCost += result.marketCost
  state.cash -= result.fuelCost + result.marketCost

  // Take-or-pay applies only while we could have served it.
  const billedMw = result.unservedContractMw > 0.5 || droppedMw > 0
    ? result.servedContractMw
    : Math.max(result.servedContractMw, state.contract.takeOrPayMw)
  const revenue = billedMw * hours * state.contract.energyRatePerMwh
    + result.servedCustomerMw * hours * RETAIL_RATE
  state.revenue += revenue
  state.cash += revenue

  const standing = standingCosts(state)
  const standingPerTick = (standing.fixedOm + standing.maintenance + standing.vegetation
    + standing.crews) * (hours / HOURS_PER_YEAR)
  state.operatingCost += standingPerTick
  state.cash -= standingPerTick

  const penalty = (result.unservedContractMw > 0.5
    ? result.unservedContractMw * hours * state.contract.shortfallPenaltyPerMwh : 0)
    + (result.unservedCustomerMw > 0.5
      ? result.unservedCustomerMw * hours * CUSTOMER_SHORTFALL_PENALTY : 0)
  state.penaltiesAccrued += penalty
  state.cash -= penalty

  rt.servedContractMwh += result.servedContractMw * hours
  rt.servedCustomerMwh += result.servedCustomerMw * hours
  rt.servedMwh += result.servedMw * hours
  rt.unservedContractMwh += result.unservedContractMw * hours
  rt.unservedCustomerMwh += result.unservedCustomerMw * hours

  if (result.unservedCustomerMw > 0.5) {
    const share = result.unservedCustomerMw / Math.max(load.customerMw, 1e-6)
    rt.customerMinutesLost += share * state.system.servedPopulation * TICK_MINUTES
    changeApproval(state, -share * hours, 'Homes without power')
  }

  const unserved = result.unservedContractMw + result.unservedCustomerMw
  if (unserved > 1 && !rt.inShortfall) {
    rt.inShortfall = true
    severe = true
    events.push(shortfallText(result))
  } else if (unserved <= 0.5 && rt.inShortfall) {
    rt.inShortfall = false
    events.push('All load is being served again.')
  }

  const record: IntervalRecord = {
    tick: rt.tick,
    loadMw: load.totalMw,
    contractMw: load.contractMw,
    customerMw: load.customerMw,
    servedMw: result.servedMw,
    generationMw: result.generationMw,
    marketMw: result.marketMw,
    unservedMw: unserved,
    priceMwh: result.priceMwh,
    importLimitMw: result.importLimitMw,
    storedMwh: state.plants.reduce((n, p) => n + (p.status === 'online' ? p.socMwh : 0), 0),
    corridorLoading: result.corridorLoading,
    unservedContractMw: result.unservedContractMw,
    unservedCustomerMw: result.unservedCustomerMw,
    lineFlowMw: result.lineFlowMw,
  }
  rt.history.push(record)
  if (rt.history.length > HISTORY_LENGTH) rt.history.shift()

  rt.tick += 1

  if (Math.floor(rt.tick / QUARTER_TICKS) > rt.quartersClosed) {
    rt.quartersClosed += 1
    advanceProjects(state, rng)
    checkCustomers(state)
    recordCash(state, state.quarter)
    state.quarter += 1
    events.push(...drawOutsideEvents(state))
  }
  state.rngState = rng.state
  advanceTutorial(state)

  if (checkEnding(state)) {
    severe = true
  } else if (rt.tick >= OPERATING_YEAR_TICKS) {
    endScenario(state, 'completed')
    severe = true
  } else if (rt.tick >= rt.nextEventTick) {
    const r2 = new Rng(state.rngState)
    rt.nextEventTick = rt.tick + Math.round(r2.range(28, 46) * TICKS_PER_DAY)
    if (drawOperatingEvent(state, r2)) severe = true
    state.rngState = r2.state
  }

  return { events, severe }
}

function shortfallText(r: DispatchResult): string {
  const campus = r.unservedContractMw > 1 ? `campus short ${Math.round(r.unservedContractMw)} MW` : ''
  const homes = r.unservedCustomerMw > 1 ? `homes short ${Math.round(r.unservedCustomerMw)} MW` : ''
  const parts = [campus, homes].filter(Boolean).join(', ')
  return `Not enough power: ${parts}.`
}

/** Heat waves arrive in summer with two days' notice. */
function stepHeatWave(rt: RealtimeState, rng: Rng, calendar: number): string | null {
  if (rt.heatWave) {
    if (rt.heatWave.ticksUntil > 0) {
      rt.heatWave.ticksUntil -= 1
      return rt.heatWave.ticksUntil === 0 ? 'The heat wave has arrived.' : null
    }
    rt.heatWave.ticksRemaining -= 1
    if (rt.heatWave.ticksRemaining <= 0) {
      rt.heatWave = null
      return 'The heat wave has broken.'
    }
    return null
  }
  const day = dayOfYear(calendar)
  if (day < 150 || day > 255 || hourOfDay(calendar) !== 8) return null
  if (!rng.chance(0.045)) return null
  rt.heatWave = {
    deltaC: rng.range(3, 6),
    ticksUntil: 2 * TICKS_PER_DAY,
    ticksRemaining: Math.round(rng.range(3, 6) * TICKS_PER_DAY),
  }
  return `Heat wave forecast in two days: about ${Math.round(rt.heatWave.deltaC)}°C above normal. `
    + 'Expect higher demand, weaker turbines and smaller imports.'
}

function stageTutorialStorm(state: GameState, rt: RealtimeState, rng: Rng): string[] {
  const t = state.tutorial
  if (!t || t.stormFired || t.stormAtTick === null || rt.tick < t.stormAtTick) return []

  const last = rt.history[rt.history.length - 1]
  const corridor = state.corridors
    .filter((c) => c.status === 'energized')
    .sort((a, b) => (last?.lineFlowMw[b.id] ?? 0) - (last?.lineFlowMw[a.id] ?? 0))[0]
  if (!corridor) return []

  t.stormFired = true
  const cls = lineClass(corridor.classId)
  const total = cls.circuits === 1

  const mid = corridor.centerline[Math.floor(corridor.centerline.length / 2)] ?? [0, 0]
  rt.storms.push({
    id: `storm-tutorial-${rt.tick}`,
    x: mid[0] - 12, y: mid[1], vx: 2.2, vy: 0,
    radiusKm: 30, severity: 0.95, ticksRemaining: 26,
    name: 'the line out of Alabama',
  })

  const hours = rng.range(16, 26) * (1.25 - 0.5 * rt.vegetationSpend)
  rt.outages.push({
    assetId: corridor.id,
    kind: 'corridor',
    cause: 'structure down',
    ticksRemaining: Math.round(hours * TICKS_PER_HOUR),
    capacityFraction: total ? 0 : 1 / cls.circuits,
    crews: 0,
    startedTick: rt.tick,
  })

  return [total
    ? `${corridor.name}: a tower is down in a line of storms out of Alabama. This line is out of service.`
    : `${corridor.name}: one circuit lost in a line of storms out of Alabama. The other is still in service.`]
}

/** Hire or release crews. */
export function setCrews(state: GameState, n: number): void {
  if (!state.realtime) return
  state.realtime.crewsTotal = Math.min(MAX_CREWS, Math.max(MIN_CREWS, Math.round(n)))
}

/** Send crews to one fault ahead of the others, or undo that. */
export function togglePriority(state: GameState, assetId: string): void {
  for (const o of state.realtime?.outages ?? []) {
    if (o.assetId === assetId) o.priority = !o.priority
  }
}

export function reliabilityIndices(rt: RealtimeState, servedPopulation: number): {
  saidiMinutes: number
  contractAvailability: number
  daysOperated: number
} {
  const days = rt.tick / TICKS_PER_DAY
  const asked = rt.servedContractMwh + rt.unservedContractMwh
  return {
    saidiMinutes: (rt.customerMinutesLost / servedPopulation) * (365 / Math.max(30, days)),
    contractAvailability: asked > 0 ? rt.servedContractMwh / asked : 1,
    daysOperated: days,
  }
}
