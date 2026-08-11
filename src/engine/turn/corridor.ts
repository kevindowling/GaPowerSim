/**
 * Corridor actions: plan a route, buy the right-of-way, condemn what won't sell,
 * and build the line.
 *
 * A corridor moves through four states. While `planned` it costs nothing and can
 * be redrawn freely — this is where the player should be experimenting with
 * route shape, because that is where severance damage is decided. Committing it
 * starts `acquiring`, and from that point every parcel is a negotiation.
 */

import type { GameState, Corridor } from '../types.ts'
import type { HexGrid } from '../geo/mapTypes.ts'
import type { Parcel } from '../parcels/types.ts'
import { findRoute, pathToCenterline, DEFAULT_WEIGHTS, type RouteWeights } from '../geo/routing.ts'
import { computeTakings, type CorridorTakings } from '../parcels/takings.ts'
import { newDeal, condemnationQuarters, condemnationLegalCost, condemnationApprovalCost } from '../parcels/negotiation.ts'
import { lineClass, lineCapex, lineBuildQuarters, type LineClassId } from '../../data/transmission.ts'
import { cellCenter } from '../geo/hex.ts'
import { pushLog } from '../state.ts'
import { Rng } from '../rng.ts'

let corridorCounter = 0

export function resetCorridorCounter(): void {
  corridorCounter = 0
}

/** World-space centre of a grid cell. */
function cellToWorld(grid: HexGrid, cell: number): [number, number] {
  const row = Math.floor(cell / grid.spec.cols)
  return cellCenter(grid.spec, cell - row * grid.spec.cols, row)
}

export interface CorridorPlan {
  cells: number[]
  centerline: Array<[number, number]>
  lengthKm: number
  classId: LineClassId
  takings: CorridorTakings
  /** Line construction cost, before right-of-way. */
  lineCapex: number
  /** Appraised right-of-way cost across every affected parcel. */
  rowAppraised: number
  buildQuarters: number
}

/**
 * Propose a route between two cells and price it end to end.
 *
 * Cheap enough to call while the player is dragging, because the takings pass
 * only tests parcels whose bounding box meets the corridor's.
 */
export function planCorridor(
  grid: HexGrid,
  from: number,
  to: number,
  classId: LineClassId,
  parcels: readonly Parcel[],
  weights: RouteWeights = DEFAULT_WEIGHTS,
): CorridorPlan | null {
  const route = findRoute(grid, from, to, weights)
  if (!route) return null

  const cls = lineClass(classId)
  const centerline = pathToCenterline(route.cells, (c) => cellToWorld(grid, c))
  const takings = computeTakings(centerline, cls.rowHalfWidthKm, parcels)

  return {
    cells: route.cells,
    centerline,
    lengthKm: route.lengthKm,
    classId,
    takings,
    lineCapex: lineCapex(cls, route.lengthKm),
    rowAppraised: takings.totalAppraised,
    buildQuarters: lineBuildQuarters(cls, route.lengthKm),
  }
}

/** Commit a planned route and start acquiring the right-of-way. */
export function commitCorridor(
  prev: GameState, plan: CorridorPlan, parcels: readonly Parcel[],
): GameState {
  const state: GameState = structuredClone(prev)
  const cls = lineClass(plan.classId)
  corridorCounter += 1

  const byId = new Map(parcels.map((p) => [p.id, p]))
  const deals: Corridor['deals'] = {}
  const takings: Corridor['takings'] = {}
  for (const t of plan.takings.takings) {
    const parcel = byId.get(t.parcelId)
    if (!parcel) continue
    takings[t.parcelId] = t
    deals[t.parcelId] = newDeal(parcel)
  }

  const corridor: Corridor = {
    id: `corridor-${corridorCounter}`,
    name: `${cls.name} ${corridorCounter}`,
    classId: plan.classId,
    cells: plan.cells,
    centerline: plan.centerline,
    lengthKm: plan.lengthKm,
    status: 'acquiring',
    deals,
    takings,
    condemnations: 0,
    legalCosts: 0,
    rowPaid: 0,
    capexTotal: plan.lineCapex,
    capexSpent: 0,
    buildQuartersRemaining: plan.buildQuarters,
    delayQuarters: 0,
  }

  state.corridors.push(corridor)

  const blocked = Object.values(deals).filter((d) => d.status === 'blocked').length
  pushLog(
    state, 'grid',
    `${corridor.name} routed — ${plan.lengthKm.toFixed(1)} km across ` +
    `${plan.takings.parcelsAffected} parcels, ${Math.round(plan.takings.totalAcres)} acres of right-of-way.`,
    true,
  )
  if (plan.takings.parcelsSevered > 0) {
    pushLog(
      state, 'grid',
      `${plan.takings.parcelsSevered} of those parcels are cut in two. Severance damages will be owed on top of the land.`,
    )
  }
  if (blocked > 0) {
    pushLog(
      state, 'politics',
      `${blocked} parcel${blocked === 1 ? ' is' : 's are'} protected and cannot be taken at any price. This route cannot be completed.`,
      true,
    )
  }
  return state
}

/** Abandon a planned or in-progress corridor. Money already paid is gone. */
export function abandonCorridor(prev: GameState, corridorId: string): GameState {
  const state: GameState = structuredClone(prev)
  const idx = state.corridors.findIndex((c) => c.id === corridorId)
  if (idx < 0) return prev
  const corridor = state.corridors[idx]
  if (corridor.status === 'energized') return prev

  state.corridors.splice(idx, 1)
  const sunk = corridor.rowPaid + corridor.legalCosts + corridor.capexSpent
  pushLog(
    state, 'grid',
    sunk > 0
      ? `${corridor.name} abandoned. $${(sunk / 1e6).toFixed(1)}M already spent does not come back.`
      : `${corridor.name} abandoned before any money was committed.`,
    true,
  )
  return state
}

/** Put an offer on the table for one parcel, at a multiple of appraised value. */
export function setOffer(
  prev: GameState, corridorId: string, parcelId: string, multiple: number,
): GameState {
  const state: GameState = structuredClone(prev)
  const corridor = state.corridors.find((c) => c.id === corridorId)
  const deal = corridor?.deals[parcelId]
  if (!corridor || !deal) return prev
  if (deal.status === 'accepted' || deal.status === 'condemned' || deal.status === 'blocked') return prev
  if (deal.status === 'condemning') return prev

  deal.offerMultiple = Math.max(1, Math.min(6, multiple))
  deal.status = 'offered'
  return state
}

/** Offer the same multiple to everyone still outstanding. */
export function offerAll(prev: GameState, corridorId: string, multiple: number): GameState {
  const state: GameState = structuredClone(prev)
  const corridor = state.corridors.find((c) => c.id === corridorId)
  if (!corridor) return prev

  let count = 0
  for (const deal of Object.values(corridor.deals)) {
    if (deal.status === 'accepted' || deal.status === 'condemned'
      || deal.status === 'blocked' || deal.status === 'condemning') continue
    deal.offerMultiple = Math.max(1, Math.min(6, multiple))
    deal.status = 'offered'
    count += 1
  }
  if (count > 0) {
    pushLog(
      state, 'money',
      `${count} offer${count === 1 ? '' : 's'} at ${multiple.toFixed(2)}× appraised value on ${corridor.name}.`,
    )
  }
  return state
}

/**
 * Begin condemnation on a parcel.
 *
 * This is the decision the game is built around, so its costs are deliberately
 * not all financial: quarters of delay, county approval, and — the one that
 * bites — every remaining holdout on this corridor gets harder to deal with.
 */
export function condemn(prev: GameState, corridorId: string, parcelId: string, parcel: Parcel): GameState {
  const state: GameState = structuredClone(prev)
  const corridor = state.corridors.find((c) => c.id === corridorId)
  const deal = corridor?.deals[parcelId]
  if (!corridor || !deal) return prev
  if (deal.status === 'blocked') {
    pushLog(state, 'politics', `${parcel.owner} cannot be condemned. This land is protected.`, true)
    return prev
  }
  if (deal.status === 'accepted' || deal.status === 'condemned' || deal.status === 'condemning') return prev

  const rng = new Rng(state.rngState)
  deal.status = 'condemning'
  deal.condemnationQuarters = condemnationQuarters(parcel, rng)
  state.rngState = rng.state

  const legal = condemnationLegalCost(corridor.takings[parcelId])
  corridor.legalCosts += legal
  state.cash -= legal

  const county = state.counties[parcel.countyFips]
  const approvalHit = condemnationApprovalCost(parcel)
  if (county) {
    county.approval = Math.max(0, county.approval - approvalHit)
    county.grievances.push(`${parcel.owner} condemned for ${corridor.name}`)
  }

  corridor.condemnations += 1

  pushLog(
    state, 'politics',
    `Condemnation filed against ${parcel.owner}. ` +
    `${deal.condemnationQuarters} quarters in court, $${(legal / 1e6).toFixed(1)}M in fees, ` +
    `and ${county?.name ?? 'the county'} County drops ${approvalHit} points.`,
    true,
  )

  const remaining = Object.values(corridor.deals).filter(
    (d) => d.status === 'pending' || d.status === 'holdout' || d.status === 'offered',
  ).length
  if (remaining > 0) {
    pushLog(
      state, 'politics',
      `Word travels. The ${remaining} landowner${remaining === 1 ? '' : 's'} still holding out on ${corridor.name} just got harder to deal with.`,
    )
  }
  return state
}

/** Every parcel settled one way or another? */
export function acquisitionComplete(corridor: Corridor): boolean {
  return Object.values(corridor.deals).every(
    (d) => d.status === 'accepted' || d.status === 'condemned',
  )
}

/** Parcels that are refusing and have no proceedings under way. */
export function outstandingHoldouts(corridor: Corridor): string[] {
  return Object.entries(corridor.deals)
    .filter(([, d]) => d.status === 'holdout' || d.status === 'pending')
    .map(([id]) => id)
}

/** True when a route contains land that cannot be acquired at all. */
export function hasBlockedParcel(corridor: Corridor): boolean {
  return Object.values(corridor.deals).some((d) => d.status === 'blocked')
}
