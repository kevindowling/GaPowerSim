import type { GameState, Plant } from '../types.ts'
import { plantType } from '../../data/plants.ts'
import { solarFraction } from './load.ts'
import type { SheddingPolicy } from './types.ts'
import { TICK_MINUTES } from './types.ts'
import type { LoadSlice } from './load.ts'
import { FlowNet, addLines, homesNode, importNode, regionMw, sourceNode, CAMPUS } from './network.ts'

/** Ambient above which thermal plants start losing output. */
const DERATE_ONSET_C = 25
/** Fraction of capacity lost per °C above the onset. */
const DERATE_PER_C = 0.006

/** Hours of full output a battery holds. */
export const BATTERY_HOURS = 4
/** Round-trip efficiency, charged on the way in. */
export const BATTERY_EFFICIENCY = 0.86
/** What stored energy is worth. Keeps batteries back until power is dear. */
const BATTERY_DISPATCH_COST = 78
/** Batteries recharge only from power at or below this cost. */
const BATTERY_CHARGE_CEILING = 66

export function batteryCapacityMwh(plant: Pick<Plant, 'nameplateMw'>): number {
  return plant.nameplateMw * BATTERY_HOURS
}

/** Available output from a plant right now, MW. */
export function availableMw(
  plant: Plant, tick: number, ambient: number, outOfService: boolean,
): number {
  if (plant.status !== 'online' || outOfService) return 0
  const t = plantType(plant.typeId)

  if (t.id === 'solar') return plant.nameplateMw * solarFraction(tick)
  if (t.id === 'battery') {
    return Math.min(plant.nameplateMw, plant.socMwh / (TICK_MINUTES / 60))
  }
  const derate = Math.max(0, ambient - DERATE_ONSET_C) * DERATE_PER_C
  return plant.nameplateMw * Math.max(0.6, 1 - derate)
}

export function importLimitMw(state: GameState, ambient: number): number {
  const squeeze = Math.min(0.5, Math.max(0, ambient - 30) * 0.05)
  return regionMw(state) * (1 - squeeze)
}

/** Wholesale price, $/MWh. Follows heat, with a slow swing for fuel. */
export function marketPrice(tick: number, ambient: number): number {
  const base = 36 + 10 * Math.sin(tick / 91)
  const heat = Math.max(0, ambient - 27) * 9
  return Math.max(14, base + heat)
}

export interface DispatchResult {
  generationMw: number
  marketMw: number
  importLimitMw: number
  /** Power put into batteries this interval. */
  chargeMw: number
  fuelCost: number
  marketCost: number
  priceMwh: number
  servedMw: number
  servedContractMw: number
  servedCustomerMw: number
  unservedContractMw: number
  unservedCustomerMw: number
  /** MW on each line this interval, by corridor id ('tie' for the existing one). */
  lineFlowMw: Record<string, number>
  /** Busiest line into the campus as a fraction of its rating. */
  corridorLoading: number
  /** True when supply existed but could not get through. */
  corridorLimited: boolean
  plantMw: Record<string, number>
}

interface Source { id: string; node: string; mw: number; cost: number; plant: Plant | null }

function collectSources(
  state: GameState, load: LoadSlice, tick: number, out: ReadonlySet<string>,
): { sources: Source[]; price: number; importMw: number } {
  const price = marketPrice(tick, load.ambientC)
  const importMw = importLimitMw(state, load.ambientC)
  const sources: Source[] = state.plants.map((p) => {
    const t = plantType(p.typeId)
    return {
      id: p.id,
      node: sourceNode(state, p),
      mw: availableMw(p, tick, load.ambientC, out.has(p.id)) * (1 - Math.min(1, state.reserved?.[p.id] ?? 0)),
      cost: t.id === 'battery' ? BATTERY_DISPATCH_COST : t.variableCostPerMwh,
      plant: p,
    }
  }).filter((s) => s.mw > 1e-6)
  sources.push({ id: 'market', node: importNode(state), mw: importMw, cost: price, plant: null })
  sources.sort((a, b) => a.cost - b.cost)
  return { sources, price, importMw }
}

/** Deliver up to the given amounts, homes or campus first. */
function deliver(
  state: GameState, sources: readonly Source[], derates: ReadonlyMap<string, number>,
  campusMw: number, homesMw: number, first: 'homes' | 'campus',
): { campus: number; homes: number } {
  const net = new FlowNet()
  addLines(net, state, derates)
  for (const s of sources) net.arc('S', s.node, s.mw)
  const run = (who: 'homes' | 'campus'): number => {
    if (who === 'homes') {
      net.arc(homesNode(state), 'T', homesMw)
    } else {
      net.arc(CAMPUS, 'T', campusMw)
    }
    return net.push('S', 'T')
  }
  if (first === 'homes') {
    const homes = run('homes')
    return { homes, campus: run('campus') }
  }
  const campus = run('campus')
  return { campus, homes: run('homes') }
}

function split(
  state: GameState, sources: readonly Source[], derates: ReadonlyMap<string, number>,
  load: LoadSlice, policy: SheddingPolicy,
): { campus: number; homes: number } {
  const want = load.contractMw + load.customerMw
  const all = deliver(state, sources, derates, load.contractMw, load.customerMw, 'homes')
  if (all.campus + all.homes >= want - 1e-6) return all
  if (policy === 'protect-homes') return all
  if (policy === 'protect-contract') {
    return deliver(state, sources, derates, load.contractMw, load.customerMw, 'campus')
  }
  let lo = 0
  let hi = 1
  for (let i = 0; i < 14; i++) {
    const f = (lo + hi) / 2
    const d = deliver(state, sources, derates, load.contractMw * f, load.customerMw * f, 'homes')
    if (d.campus + d.homes >= want * f - 1e-6) lo = f
    else hi = f
  }
  const base = { campus: load.contractMw * lo, homes: load.customerMw * lo }
  const net = new FlowNet()
  addLines(net, state, derates)
  for (const s of sources) net.arc('S', s.node, s.mw)
  net.arc(homesNode(state), 'T', base.homes)
  net.arc(CAMPUS, 'T', base.campus)
  net.push('S', 'T')
  net.arc(homesNode(state), 'T', load.customerMw - base.homes)
  const moreHomes = net.push('S', 'T')
  net.arc(CAMPUS, 'T', load.contractMw - base.campus)
  const moreCampus = net.push('S', 'T')
  return { campus: base.campus + moreCampus, homes: base.homes + moreHomes }
}

/** Settle one interval. Updates battery charge on `state.plants`. */
export function dispatch(
  state: GameState,
  load: LoadSlice,
  tick: number,
  outAssets: ReadonlySet<string>,
  policy: SheddingPolicy,
  derates: ReadonlyMap<string, number> = new Map(),
): DispatchResult {
  const hours = TICK_MINUTES / 60
  const { sources, price, importMw } = collectSources(state, load, tick, outAssets)
  const served = split(state, sources, derates, load, policy)

  const net = new FlowNet()
  const lines = addLines(net, state, derates)
  net.arc(homesNode(state), 'T', served.homes)
  net.arc(CAMPUS, 'T', served.campus)
  const used = new Map<string, number>()
  let remaining = served.homes + served.campus
  for (const s of sources) {
    if (remaining <= 1e-9) break
    const h = net.arc('S', s.node, s.mw)
    const got = net.push('S', 'T', remaining)
    remaining -= got
    used.set(s.id, got)
    // Whatever was not needed is not available to later, dearer sources.
    net.setResidual(h, 0)
  }

  // Recharge batteries from cheap power that nobody needed.
  let chargeMw = 0
  const chargeCostBySource = new Map<string, number>()
  const shortBy = load.totalMw - served.homes - served.campus
  if (shortBy <= 1e-6) {
    const sinks: Array<{ plant: Plant; handle: number; cap: number }> = []
    for (const p of state.plants) {
      if (p.typeId !== 'battery' || p.status !== 'online' || outAssets.has(p.id)) continue
      if ((used.get(p.id) ?? 0) > 1e-6) continue
      const room = (batteryCapacityMwh(p) - p.socMwh) / BATTERY_EFFICIENCY / hours
      const cap = Math.min(p.nameplateMw, Math.max(0, room))
      if (cap > 1e-6) sinks.push({ plant: p, handle: net.arc(sourceNode(state, p), 'CHARGE', cap), cap })
    }
    if (sinks.length > 0) {
      for (const s of sources) {
        if (s.plant?.typeId === 'battery' || s.cost > BATTERY_CHARGE_CEILING) continue
        const spare = s.mw - (used.get(s.id) ?? 0)
        if (spare <= 1e-6) continue
        net.arc('S', s.node, spare)
        const got = net.push('S', 'CHARGE')
        if (got > 0) {
          chargeMw += got
          chargeCostBySource.set(s.id, got)
        }
      }
      for (const k of sinks) {
        const into = k.cap - net.residual(k.handle)
        k.plant.socMwh = Math.min(
          batteryCapacityMwh(k.plant), k.plant.socMwh + into * hours * BATTERY_EFFICIENCY,
        )
      }
    }
  }

  let generationMw = 0
  let marketMw = 0
  let fuelCost = 0
  let marketCost = 0
  const plantMw: Record<string, number> = {}
  for (const s of sources) {
    const mw = (used.get(s.id) ?? 0) + (chargeCostBySource.get(s.id) ?? 0)
    if (!s.plant) {
      marketMw = mw
      marketCost = mw * hours * price
      continue
    }
    generationMw += mw
    plantMw[s.id] = mw
    fuelCost += mw * hours * plantType(s.plant.typeId).variableCostPerMwh
    if (s.plant.typeId === 'battery') {
      s.plant.socMwh = Math.max(0, s.plant.socMwh - mw * hours)
    }
  }

  const lineFlowMw: Record<string, number> = {}
  let corridorLoading = 0
  for (const l of lines) {
    const flow = Math.abs(net.residual(l.handle + 1) - net.residual(l.handle)) / 2
    lineFlowMw[l.id] = Math.max(lineFlowMw[l.id] ?? 0, flow)
    if (l.capMw > 0) corridorLoading = Math.max(corridorLoading, flow / l.capMw)
  }

  const totalAvailable = sources.reduce((n, s) => n + s.mw, 0)
  const unservedContractMw = Math.max(0, load.contractMw - served.campus)
  const unservedCustomerMw = Math.max(0, load.customerMw - served.homes)

  return {
    generationMw,
    marketMw,
    importLimitMw: importMw,
    chargeMw,
    fuelCost,
    marketCost,
    priceMwh: price,
    servedMw: served.campus + served.homes,
    servedContractMw: served.campus,
    servedCustomerMw: served.homes,
    unservedContractMw,
    unservedCustomerMw,
    lineFlowMw,
    corridorLoading,
    corridorLimited:
      unservedContractMw + unservedCustomerMw > 1e-6 && totalAvailable >= load.totalMw,
    plantMw,
  }
}
