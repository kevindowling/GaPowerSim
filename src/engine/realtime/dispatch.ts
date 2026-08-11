/**
 * Economic dispatch, delivery limits, and who gets curtailed.
 *
 * Three things have to line up for a megawatt to arrive: something has to make
 * it, a wire has to carry it, and it has to be cheaper to make than to buy. When
 * they do not line up, somebody's power goes off, and the interesting question
 * is whose.
 */

import type { GameState, Plant, Corridor } from '../types.ts'
import { plantType } from '../../data/plants.ts'
import { lineClass } from '../../data/transmission.ts'
import { solarFraction } from './load.ts'
import type { SheddingPolicy } from './types.ts'
import { TICK_MINUTES } from './types.ts'
import type { LoadSlice } from './load.ts'

/** Ambient above which thermal plants start losing output. */
const DERATE_ONSET_C = 25
/** Fraction of capacity lost per °C above the onset. */
const DERATE_PER_C = 0.006

/**
 * Available output from a plant right now.
 *
 * Solar follows the sun. Thermal plants lose capacity as the air warms, which is
 * unhelpfully correlated with the hottest hour of the year being the hour you
 * need them most.
 */
export function availableMw(
  plant: Plant, tick: number, ambient: number, outOfService: boolean,
): number {
  if (plant.status !== 'online' || outOfService) return 0
  const t = plantType(plant.typeId)

  if (t.id === 'solar') return plant.nameplateMw * solarFraction(tick)
  if (t.id === 'battery') return plant.nameplateMw // limited by energy, handled below

  const derate = Math.max(0, ambient - DERATE_ONSET_C) * DERATE_PER_C
  return plant.nameplateMw * Math.max(0.6, 1 - derate)
}

/**
 * Transfer capability into the campus, accounting for damage.
 *
 * `derates` maps an asset id to the fraction of its rating still available. A
 * double-circuit line that has lost one circuit is at 0.5 and still carrying
 * half the campus; a single-circuit line in the same storm is at zero.
 */
export function deliverableMw(
  corridors: readonly Corridor[], derates: ReadonlyMap<string, number>,
): number {
  let total = 0
  for (const c of corridors) {
    if (c.status !== 'energized') continue
    const fraction = derates.get(c.id) ?? 1
    total += lineClass(c.classId).ratingMw * fraction
  }
  return total
}

/**
 * Wholesale price for an interval.
 *
 * Cheap most of the time and violently expensive exactly when everyone else is
 * short too, which is the property that makes leaning on the market instead of
 * building capacity a bad long-term plan.
 */
export function marketPrice(tick: number, ambient: number, scarcity: number): number {
  const base = 34 + 12 * Math.sin(tick / 91)
  const heat = Math.max(0, ambient - 28) * 4.5
  // Scarcity is the fraction of demand we cannot self-supply.
  const spike = scarcity > 0 ? 90 * scarcity ** 1.6 + (scarcity > 0.35 ? 600 * (scarcity - 0.35) : 0) : 0
  return Math.max(12, base + heat + spike)
}

export interface DispatchResult {
  generationMw: number
  marketMw: number
  fuelCost: number
  marketCost: number
  priceMwh: number
  /** Total delivered to load. */
  servedMw: number
  unservedContractMw: number
  unservedCustomerMw: number
  /** Fraction of corridor rating in use. */
  corridorLoading: number
  /** True when the wire, not the generation, was the binding constraint. */
  corridorLimited: boolean
}

/**
 * Settle one interval.
 *
 * Merit order first — cheapest generation runs — then the market fills whatever
 * is left, then the wire decides how much of it can actually arrive, then
 * whatever still cannot be delivered is curtailed according to policy.
 */
export function dispatch(
  state: GameState,
  load: LoadSlice,
  tick: number,
  outAssets: ReadonlySet<string>,
  policy: SheddingPolicy,
  derates: ReadonlyMap<string, number> = new Map(),
): DispatchResult {
  const hours = TICK_MINUTES / 60

  // --- generation, cheapest first ---
  const units = state.plants
    .map((p) => ({
      plant: p,
      cost: plantType(p.typeId).variableCostPerMwh,
      mw: availableMw(p, tick, load.ambientC, outAssets.has(p.id)),
    }))
    .filter((u) => u.mw > 0)
    .sort((a, b) => a.cost - b.cost)

  let remaining = load.totalMw
  let generationMw = 0
  let fuelCost = 0

  for (const u of units) {
    if (remaining <= 0) break
    const take = Math.min(u.mw, remaining)
    generationMw += take
    fuelCost += take * hours * u.cost
    remaining -= take
  }

  // --- the market covers the rest, at a price ---
  const scarcity = load.totalMw > 0 ? Math.max(0, remaining) / load.totalMw : 0
  const priceMwh = marketPrice(tick, load.ambientC, scarcity)
  // Imports are themselves limited by the network; you cannot buy your way out
  // of an empty wire.
  const marketMw = Math.max(0, remaining)
  const marketCost = marketMw * hours * priceMwh

  // --- the wire ---
  const capability = deliverableMw(state.corridors, derates)
  const supplyMw = generationMw + marketMw
  // Customer load in the surrounding counties is served off the existing
  // distribution network; only the campus depends on the new corridor.
  const contractDeliverable = Math.min(load.contractMw, capability)
  const corridorLimited = contractDeliverable + 1e-9 < load.contractMw

  // Supply is shared between the two loads; the corridor caps the campus's share.
  const customerSupply = Math.min(load.customerMw, Math.max(0, supplyMw - contractDeliverable))
  let servedContract = Math.min(contractDeliverable, supplyMw)
  let servedCustomer = customerSupply

  const totalDeliverable = servedContract + servedCustomer
  const shortfall = load.totalMw - totalDeliverable

  if (shortfall > 1e-9) {
    // Whatever is short has to come off somebody. Policy decides whom.
    const contractShort = load.contractMw - servedContract
    const customerShort = load.customerMw - servedCustomer

    if (policy === 'protect-contract' && customerShort < load.customerMw) {
      // Take more from customers to top the campus back up, as far as the
      // corridor and the supply allow.
      const canRecover = Math.min(contractShort, servedCustomer, Math.max(0, contractDeliverable - servedContract))
      servedContract += canRecover
      servedCustomer -= canRecover
    } else if (policy === 'protect-homes' && contractShort < load.contractMw) {
      const canRecover = Math.min(customerShort, servedContract)
      servedCustomer += canRecover
      servedContract -= canRecover
    }
    // 'proportional' leaves the natural split alone.
  }

  return {
    generationMw,
    marketMw,
    fuelCost,
    marketCost,
    priceMwh,
    servedMw: servedContract + servedCustomer,
    unservedContractMw: Math.max(0, load.contractMw - servedContract),
    unservedCustomerMw: Math.max(0, load.customerMw - servedCustomer),
    corridorLoading: capability > 0 ? load.contractMw / capability : load.contractMw > 0 ? Infinity : 0,
    corridorLimited,
  }
}
