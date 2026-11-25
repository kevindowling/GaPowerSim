import type { CapexMilestone, Customer, GameState } from './types.ts'
import type { QuarterIndex } from './time.ts'
import type { DataCenter } from '../data/dataCenters.ts'
import { phasesFor } from '../data/customerTerms.ts'
import type { PhaseDate, PowerForecast } from './forecast.ts'
import { phasesOn, phasing } from './phases.ts'
import { CAMPUS, dcNode } from './realtime/network.ts'

/** The data center the player is looking at. 'main' is the first one. */
export interface Focus {
  id: string
  name: string
  developer: string
  signed: boolean
  cancelled: boolean
  needMw: number
  /** Last phase's due quarter. Null before signing. */
  deadline: QuarterIndex | null
  count: number
  mwEach: number
  phasesOn: number
  milestones: readonly CapexMilestone[]
  advance: number
  /** County whose rating is its approval. Null before signing. */
  fips: string | null
  /** Where lines connect. */
  node: string
  ratePerMwh: number
  spareMw: number
  customer: Customer | null
}

export function focusOf(game: GameState, id: string, centers: readonly DataCenter[]): Focus {
  const c = game.customers?.find((x) => x.id === id)
  if (c) {
    const due = c.milestones.map((m) => m.dueQuarter).filter((q): q is number => q !== undefined)
    return {
      id, name: c.name, developer: c.developer, signed: true, cancelled: c.status === 'cancelled',
      needMw: c.contractedMw, deadline: due.length > 0 ? Math.max(...due) : null,
      count: c.phaseCount, mwEach: c.phaseMw, phasesOn: c.phasesOn, milestones: c.milestones, advance: c.advance,
      fips: c.countyFips, node: dcNode(c.id), ratePerMwh: c.ratePerMwh, spareMw: c.spareMw, customer: c,
    }
  }
  const dc = id === 'main' ? undefined : centers.find((d) => d.id === id)
  if (dc) {
    const p = phasesFor(dc.mw ?? 0)
    return {
      id, name: dc.name, developer: dc.developer ?? 'Not published', signed: false, cancelled: false,
      needMw: dc.mw ?? 0, deadline: null, count: p.count, mwEach: p.mwEach, phasesOn: 0, milestones: [], advance: 0,
      fips: null, node: dcNode(dc.id), ratePerMwh: 0, spareMw: 0, customer: null,
    }
  }
  const m = game.contract
  const { count, mwEach } = phasing(game)
  return {
    id: 'main', name: m.name, developer: m.developer, signed: m.status !== 'offered', cancelled: m.status === 'failed',
    needMw: m.contractedMw, deadline: m.inServiceQuarter, count, mwEach, phasesOn: phasesOn(game),
    milestones: m.milestones, advance: m.capexAdvance, fips: m.countyFips, node: CAMPUS,
    ratePerMwh: m.energyRatePerMwh, spareMw: game.mainSpareMw ?? 0, customer: null,
  }
}

export interface FocusForecast {
  /** Firm MW arriving, for each point of the forecast. */
  arriving: number[]
  now: number
  plannedMw: number
  /** Quarter that last raises it. */
  plannedQuarter: QuarterIndex | null
  /** Quarter all of it arrives. */
  readyQuarter: QuarterIndex | null
  phases: PhaseDate[]
}

export function focusForecast(f: PowerForecast, focus: Focus): FocusForecast {
  const arriving = f.points.map((p) => p.flow.loads.get(focus.id) ?? 0)
  const now = arriving[0]
  const plannedMw = arriving[arriving.length - 1]
  const rise = f.points[arriving.findIndex((v) => v > plannedMw - 1e-6)]
  const ready = arriving.findIndex((v) => focus.needMw > 0 && v + 1e-6 >= focus.needMw)
  return {
    arriving, now, plannedMw,
    plannedQuarter: plannedMw > now + 1e-6 ? rise?.quarter ?? null : null,
    readyQuarter: ready < 0 ? null : f.points[ready].quarter ?? f.points[1]?.quarter ?? null,
    phases: Array.from({ length: focus.count }, (_, i) => {
      if (i < focus.phasesOn) return { on: true, quarter: null }
      const at = arriving.findIndex((v, k) => k > 0 && v + 1e-6 >= (i + 1) * focus.mwEach)
      return { on: false, quarter: at < 0 ? null : f.points[at].quarter }
    }),
  }
}
