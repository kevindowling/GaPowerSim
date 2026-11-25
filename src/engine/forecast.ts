import type { BuiltSubstation, Corridor, Customer, Equipment, GameState, Plant } from './types.ts'
import type { QuarterIndex } from './time.ts'
import { plantType } from '../data/plants.ts'
import { subFinish } from './turn/substations.ts'
import { gearFinish, gearName } from './turn/equipment.ts'
import { capacitySummary } from './state.ts'
import { phasesOn, phasing } from './phases.ts'
import { firmFlow, type PowerFlow } from './realtime/network.ts'

/** Quarters from filing a line to settling its land. Scripted games took 7 to 8, court included. */
export const LAND_QUARTERS = 8

/** Last quarter of work on a plant if nothing slips. */
export function plantFinish(state: GameState, p: Plant): QuarterIndex {
  if (p.status === 'online') return p.commissionedQuarter ?? state.startQuarter
  const after = p.status === 'permitting' ? plantType(p.typeId).buildQuarters : 0
  return state.quarter + p.quartersRemaining + after - 1
}

/** Quarters until a line's land is settled, or null if it never can be. */
export function landQuartersLeft(state: GameState, c: Corridor): number | null {
  if (c.status !== 'acquiring') return 0
  const deals = Object.values(c.deals)
  if (deals.some((d) => d.status === 'blocked')) return null
  const court = Math.max(1, ...deals.map((d) => (d.status === 'condemning' ? d.condemnationQuarters : 0)))
  const open = deals.some((d) => d.status === 'pending' || d.status === 'holdout')
  if (!open) return court
  const elapsed = c.filedQuarter === undefined ? 0 : state.quarter - c.filedQuarter
  return Math.max(court, LAND_QUARTERS - elapsed, 2)
}

/** Last quarter of work on a line, or null if its land can never be settled. */
export function lineFinish(state: GameState, c: Corridor): QuarterIndex | null {
  if (c.status === 'energized') return state.startQuarter
  const land = landQuartersLeft(state, c)
  return land === null ? null : state.quarter + land + c.buildQuartersRemaining - 1
}

export interface ForecastPoint {
  /** Null for today. Otherwise the quarter at whose end this holds. */
  quarter: QuarterIndex | null
  flow: PowerFlow
  /** Firm MW of finished plants, whether or not it arrives. */
  finishedMw: number
  /** Plants and lines that finish in this quarter. */
  finishing: string[]
}

/** Quarter is null for a phase that is on, or that nothing filed will power. */
export interface PhaseDate { on: boolean; quarter: QuarterIndex | null }

export interface PowerForecast {
  points: ForecastPoint[]
  /** First quarter the full contract arrives. */
  readyQuarter: QuarterIndex | null
  /** Firm MW arriving once everything filed is finished. */
  plannedMw: number
  /** Quarter that last raises it, or null if nothing will. */
  plannedQuarter: QuarterIndex | null
  /** When each phase turns on. */
  phases: PhaseDate[]
  /** Lines whose land is still being bought. */
  landAssumed: Corridor[]
}

export function powerForecast(state: GameState): PowerForecast {
  const plantAt = new Map(state.plants.map((p) => [p.id, plantFinish(state, p)]))
  const lineAt = new Map(state.corridors.map((c) => [c.id, lineFinish(state, c)]))
  const gear = state.equipment ?? []
  const gearAt = new Map(gear.map((e) => [e.id, gearFinish(state, e)]))
  const subs = state.builtSubs ?? []
  const subAt = new Map(subs.map((b) => [b.id, subFinish(state, b)]))
  const dates = [...plantAt.values(), ...lineAt.values(), ...gearAt.values(), ...subAt.values()].filter((q): q is number => q !== null)
  const last = Math.max(state.quarter, state.contract.inServiceQuarter, ...dates)

  const now = firmFlow(state)
  const points: ForecastPoint[] = [{
    quarter: null, flow: now, finishedMw: capacitySummary(state).onlineFirmMw, finishing: [],
  }]
  for (let q = state.quarter; q <= last; q++) {
    const plantOn = (p: Plant): boolean => p.status === 'online' || plantAt.get(p.id)! <= q
    const lineOn = (c: Corridor): boolean => c.status === 'energized' || (lineAt.get(c.id) ?? Infinity) <= q
    const gearOn = (e: Equipment): boolean => e.status === 'installed' || gearAt.get(e.id)! <= q
    const subOn = (b: BuiltSubstation): boolean => b.status === 'in-service' || subAt.get(b.id)! <= q
    const finishing = [
      ...subs.filter((b) => b.status !== 'in-service' && subAt.get(b.id) === q).map((b) => b.name),
      ...state.plants.filter((p) => p.status !== 'online' && plantAt.get(p.id) === q).map((p) => p.name),
      ...state.corridors.filter((c) => c.status !== 'energized' && lineAt.get(c.id) === q).map((c) => c.name),
      ...gear.filter((e) => e.status !== 'installed' && gearAt.get(e.id) === q).map((e) => gearName(state, e)),
    ]
    if (finishing.length === 0) {
      points.push({ ...points[points.length - 1], quarter: q, finishing })
      continue
    }
    const then = {
      ...state,
      plants: state.plants.map((p) => (plantOn(p) ? { ...p, status: 'online' as const } : p)),
    }
    points.push({
      quarter: q, flow: firmFlow(state, plantOn, lineOn, gearOn, subOn),
      finishedMw: capacitySummary(then).onlineFirmMw, finishing,
    })
  }

  const contract = state.contract.contractedMw
  const { count, mwEach } = phasing(state)
  const ready = points.find((p) => p.flow.totalMw + 1e-6 >= contract)
  const plannedMw = points[points.length - 1].flow.totalMw
  const rise = points.find((p) => p.flow.totalMw > plannedMw - 1e-6)
  return {
    points,
    readyQuarter: ready ? ready.quarter ?? state.energizedQuarter ?? state.quarter : null,
    plannedMw,
    plannedQuarter: plannedMw > now.totalMw + 1e-6 ? rise?.quarter ?? null : null,
    phases: Array.from({ length: count }, (_, i) => {
      if (i < phasesOn(state)) return { on: true, quarter: null }
      const at = points.slice(1).find((p) => p.flow.totalMw + 1e-6 >= (i + 1) * mwEach)
      return { on: false, quarter: at?.quarter ?? null }
    }),
    landAssumed: state.corridors.filter((c) => c.status === 'acquiring'),
  }
}

/** First quarter a plant delivers all it ever will under the current filing. */
export function plantArrival(f: PowerForecast, id: string): { mw: number; quarter: QuarterIndex | null } {
  const best = f.points[f.points.length - 1].flow.plants.get(id)?.arrivingMw ?? 0
  const at = f.points.find((p) => (p.flow.plants.get(id)?.arrivingMw ?? 0) > best - 0.01 && best > 0)
  return { mw: best, quarter: at?.quarter ?? null }
}

/** When each of a customer's phases turns on. */
export function customerPhases(f: PowerForecast, c: Customer): PhaseDate[] {
  return Array.from({ length: c.phaseCount }, (_, i) => {
    if (i < c.phasesOn) return { on: true, quarter: null }
    const at = f.points.slice(1).find((p) => (p.flow.loads.get(c.id) ?? 0) + 1e-6 >= (i + 1) * c.phaseMw)
    return { on: false, quarter: at?.quarter ?? null }
  })
}
