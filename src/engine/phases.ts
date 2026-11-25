import type { GameState } from './types.ts'
import { SCENARIOS } from '../data/scenarios.ts'
import { formatQuarter, quarterInYear } from './time.ts'
import { pushLog } from './state.ts'
import { firmDeliverableMw } from './realtime/network.ts'
import { dispatch } from './realtime/dispatch.ts'
import { customerLoadForPopulation, loadAt } from './realtime/load.ts'
import { standingCosts } from './realtime/operate.ts'
import { QUARTER_TICKS, TICK_MINUTES, TICKS_PER_DAY } from './realtime/types.ts'

export interface Phasing { count: number; mwEach: number }

/** How a data center is split up. */
export function phasing(state: GameState): Phasing {
  return SCENARIOS.find((s) => s.id === state.scenarioId)?.phasing
    ?? { count: 1, mwEach: state.contract.contractedMw }
}

/** Phases an amount of firm power can turn on. */
export function phasesPowered(state: GameState, mw: number): number {
  const { count, mwEach } = phasing(state)
  return Math.min(count, Math.floor((mw + 1e-6) / mwEach))
}

export function phasesOn(state: GameState): number {
  return state.contract.phasesOn ?? 0
}

/** Turn on every phase that has its power. Mutates. */
export function turnOnPhases(state: GameState): void {
  const before = phasesOn(state)
  const now = Math.max(before, phasesPowered(state, firmDeliverableMw(state)))
  state.contract.phasesOn = now
  if (now === before) return
  const { count, mwEach } = phasing(state)
  pushLog(
    state, 'grid',
    `${state.contract.name}: ${now} of ${count} phases on, ${now * mwEach} MW. It pays from ${formatQuarter(state.quarter + 1)}.`,
    true,
  )
}

export interface PhaseQuarter {
  mw: number
  revenue: number
  /** Fuel and purchases to serve the data center. */
  energyCost: number
  upkeep: number
}

/** Days of the quarter run to work out its energy. */
const SAMPLE_DAYS = 8

/** A quarter's service to the phases that are on. Does not change the state. */
export function phaseQuarter(state: GameState): PhaseQuarter | null {
  const on = phasesOn(state)
  if (on === 0) return null
  const { count, mwEach } = phasing(state)
  const mw = on * mwEach
  const homes = customerLoadForPopulation(state.system.servedPopulation)
  const copy = (): GameState => ({ ...state, plants: state.plants.map((p) => ({ ...p })) })
  const withCampus = copy()
  const homesOnly = copy()
  const hours = TICK_MINUTES / 60
  const start = (quarterInYear(state.quarter) - 1) * QUARTER_TICKS
  const scale = QUARTER_TICKS / (SAMPLE_DAYS * TICKS_PER_DAY)
  const minimum = state.contract.takeOrPayMw * (on / count)
  let billedMwh = 0
  let cost = 0
  for (let d = 0; d < SAMPLE_DAYS; d++) {
    const day = start + Math.floor((d + 0.5) * (QUARTER_TICKS / SAMPLE_DAYS / TICKS_PER_DAY)) * TICKS_PER_DAY
    for (let t = day; t < day + TICKS_PER_DAY; t++) {
      const load = loadAt(t, mw, homes)
      const a = dispatch(withCampus, load, t, new Set(), 'protect-homes')
      const b = dispatch(homesOnly, { ...load, contractMw: 0, totalMw: load.customerMw }, t, new Set(), 'protect-homes')
      const billed = a.unservedContractMw > 0.5 ? a.servedContractMw : Math.max(a.servedContractMw, minimum)
      billedMwh += billed * hours
      cost += a.fuelCost + a.marketCost - b.fuelCost - b.marketCost
    }
  }
  const { fixedOm, maintenance } = standingCosts(state)
  return {
    mw,
    revenue: billedMwh * scale * state.contract.energyRatePerMwh,
    energyCost: cost * scale,
    upkeep: (fixedOm + maintenance) / 4,
  }
}

/** Bill the phases that are on for the quarter. Mutates. */
export function settlePhases(state: GameState): void {
  const q = phaseQuarter(state)
  if (!q) return
  state.revenue += q.revenue
  state.operatingCost += q.upkeep
  state.phaseEnergyCost = (state.phaseEnergyCost ?? 0) + q.energyCost
  state.cash += q.revenue - q.energyCost - q.upkeep
  const m = (v: number): string => `$${(v / 1e6).toFixed(1)}M`
  pushLog(
    state, 'money',
    `${state.contract.name} paid ${m(q.revenue)} for ${q.mw} MW. Power cost ${m(q.energyCost)} and plant upkeep ${m(q.upkeep)}.`,
    true,
  )
}
