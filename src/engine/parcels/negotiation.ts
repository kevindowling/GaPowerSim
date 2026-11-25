import { ratingOf } from '../approval.ts'
import { Rng, deriveSeed } from '../rng.ts'
import type { Corridor, GameState } from '../types.ts'
import { isProtected, type Parcel, type ParcelArchetype } from './types.ts'
import type { Taking } from './takings.ts'

export type DealStatus =
  | 'pending'    // no offer made yet
  | 'offered'    // an offer is on the table, resolving at end of quarter
  | 'accepted'   // signed
  | 'holdout'    // refused the last offer
  | 'condemning' // in condemnation proceedings
  | 'condemned'  // taken
  | 'blocked'    // cannot be acquired at all

export interface ParcelDeal {
  parcelId: string
  status: DealStatus
  /** Multiple of appraised value currently offered. */
  offerMultiple: number
  /** Highest multiple refused so far; 0 if none. */
  refusedAt: number
  refusals: number
  /** Quarters left in condemnation proceedings. */
  condemnationQuarters: number
  /** What has actually been paid out. */
  paid: number
}

export const MAX_OFFER = 6

type OwnerFacts = Pick<Parcel, 'id' | 'archetype'>

export function newDeal(parcel: OwnerFacts): ParcelDeal {
  return {
    parcelId: parcel.id,
    status: isProtected(parcel.archetype) ? 'blocked' : 'pending',
    offerMultiple: 1,
    refusedAt: 0,
    refusals: 0,
    condemnationQuarters: 0,
    paid: 0,
  }
}

const PRICING: Record<ParcelArchetype, { median: number; spread: number; never: number }> = {
  timber: { median: 1.1, spread: 0.18, never: 0 },
  industrial: { median: 1.35, spread: 0.22, never: 0 },
  public: { median: 1.25, spread: 0.2, never: 0 },
  'row-crop': { median: 1.6, spread: 0.3, never: 0.03 },
  homestead: { median: 2.3, spread: 0.38, never: 0.1 },
  church: { median: 3.4, spread: 0.4, never: 0.3 },
  historic: { median: 99, spread: 0.1, never: 1 },
}

/** Each condemnation on the line raises every remaining price by this much. */
export const CONTAGION_PER_CONDEMNATION = 0.09
/** How much of the gap to the best price paid carries over to everyone else. */
export const GOING_RATE_PULL = 0.4

export interface NegotiationContext {
  /** Game seed, so owners are the same every time a run is replayed. */
  seed: number
  countyApproval: number
  condemnations: number
  /** Highest multiple paid on this line in earlier quarters; 0 if none. */
  bestPaid: number
}

export function highestMultiplePaid(corridor: Corridor): number {
  let best = 0
  for (const d of Object.values(corridor.deals)) {
    if (d.status === 'accepted') best = Math.max(best, d.offerMultiple)
  }
  return best
}

export function negotiationContext(
  state: GameState, corridor: Corridor, countyFips: string,
  bestPaid = highestMultiplePaid(corridor),
): NegotiationContext {
  return {
    seed: state.seed,
    countyApproval: ratingOf(state, countyFips) ?? 50,
    condemnations: corridor.condemnations,
    bestPaid,
  }
}

function adjust(base: number, taking: Taking, ctx: NegotiationContext): number {
  const severed = (taking.severed ? 0.16 : 0) + Math.min(0.15, taking.severanceFactor * 0.3)
  const county = (50 - ctx.countyApproval) / 180
  const pressure = CONTAGION_PER_CONDEMNATION * ctx.condemnations
  const price = base * Math.max(0.7, 1 + severed + county + pressure)
  return ctx.bestPaid > price ? price + GOING_RATE_PULL * (ctx.bestPaid - price) : price
}

/** Standard normal via the generator's own normal(). Bounded, which suits prices. */
function ownerDraw(parcel: OwnerFacts, seed: number): { z: number; never: boolean } {
  const rng = new Rng(deriveSeed(seed, parcel.id))
  const never = rng.next() < PRICING[parcel.archetype].never
  return { z: rng.normal(0, 1), never }
}

/** The multiple this owner would take today. Infinity if they will not sell. */
export function reservationMultiple(
  parcel: OwnerFacts, taking: Taking, ctx: NegotiationContext,
): number {
  const { z, never } = ownerDraw(parcel, ctx.seed)
  if (never) return Infinity
  const p = PRICING[parcel.archetype]
  return adjust(p.median * Math.exp(p.spread * z), taking, ctx)
}

/** Normal CDF, good to about four places. */
function phi(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989423 * Math.exp((-x * x) / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return x > 0 ? 1 - p : p
}

function acceptShare(
  archetype: ParcelArchetype, taking: Taking, multiple: number, ctx: NegotiationContext,
): number {
  const p = PRICING[archetype]
  const probe = adjust(p.median, taking, { ...ctx, bestPaid: 0 }) / p.median
  let price = multiple
  if (ctx.bestPaid > multiple) {
    price = Math.max(0, (multiple - GOING_RATE_PULL * ctx.bestPaid) / (1 - GOING_RATE_PULL))
  }
  const base = price / probe
  if (base <= 0) return 0
  return (1 - p.never) * phi(Math.log(base / p.median) / p.spread)
}

export function acceptanceProbability(
  parcel: OwnerFacts, taking: Taking, deal: ParcelDeal, ctx: NegotiationContext,
  multiple = deal.offerMultiple,
): number {
  if (deal.status === 'blocked' || isProtected(parcel.archetype)) return 0
  const at = acceptShare(parcel.archetype, taking, multiple, ctx)
  if (deal.refusedAt <= 0) return at
  const ruledOut = acceptShare(parcel.archetype, taking, deal.refusedAt, ctx)
  if (multiple <= deal.refusedAt || ruledOut >= 1) return 0
  return Math.max(0, (at - ruledOut) / (1 - ruledOut))
}

/** Dollars owed if this offer is accepted. */
export function offerAmount(taking: Taking, deal: ParcelDeal): number {
  return taking.appraisedTotal * deal.offerMultiple
}

/** Resolve one outstanding offer. Mutates the deal. */
export function resolveOffer(
  parcel: OwnerFacts, taking: Taking, deal: ParcelDeal, ctx: NegotiationContext,
): { accepted: boolean; amount: number } {
  if (deal.offerMultiple + 1e-9 >= reservationMultiple(parcel, taking, ctx)) {
    const amount = offerAmount(taking, deal)
    deal.status = 'accepted'
    deal.paid = amount
    return { accepted: true, amount }
  }
  deal.status = 'holdout'
  deal.refusals += 1
  deal.refusedAt = Math.max(deal.refusedAt, deal.offerMultiple)
  return { accepted: false, amount: 0 }
}

/** Quarters condemnation takes, by how hard the owner will fight. */
export function condemnationQuarters(parcel: Pick<Parcel, 'archetype'>, rng: Rng): number {
  const base = parcel.archetype === 'homestead' || parcel.archetype === 'church' ? 3 : 2
  return base + (rng.chance(0.35) ? 1 : 0)
}

/** Legal cost of a condemnation case. */
export function condemnationLegalCost(taking: Taking): number {
  return Math.max(260_000, taking.appraisedTotal * 0.6)
}

/** What a court awards: market value plus consequential damages. */
export function condemnationAward(taking: Taking, rng: Rng): number {
  return taking.appraisedTotal * rng.range(1.2, 2.1)
}

/** Approval lost when a parcel is taken by force. */
export function condemnationApprovalCost(parcel: Pick<Parcel, 'archetype'>): number {
  switch (parcel.archetype) {
    case 'church': return 18
    case 'homestead': return 10
    case 'row-crop': return 6
    case 'public': return 4
    default: return 3
  }
}
