/**
 * Acquiring the right-of-way, and what happens when someone says no.
 *
 * There are exactly three ways past a landowner who does not want a
 * transmission line across their land, and the game's central tension is that
 * all three cost something the player would rather not spend:
 *
 *   1. Pay more. Fast and clean, burns budget — and sets a comparable that every
 *      remaining holdout on the corridor hears about.
 *   2. Condemn. Acquisition is guaranteed, but it costs quarters of delay, legal
 *      fees, a heavy hit to county approval, and a news cycle that HARDENS every
 *      remaining holdout on the corridor. Condemnation is never a one-parcel
 *      decision, and that is the point.
 *   3. Reroute. No outrage, but a longer, costlier path across worse ground.
 */

import type { Rng } from '../rng.ts'
import {
  ARCHETYPE_BASE_ACCEPTANCE, isProtected, type Parcel,
} from './types.ts'
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
  /** How many offers have been refused. */
  refusals: number
  /** Quarters left in condemnation proceedings. */
  condemnationQuarters: number
  /** What has actually been paid out. */
  paid: number
}

export function newDeal(parcel: Parcel): ParcelDeal {
  return {
    parcelId: parcel.id,
    status: isProtected(parcel.archetype) ? 'blocked' : 'pending',
    offerMultiple: 1,
    refusals: 0,
    condemnationQuarters: 0,
    paid: 0,
  }
}

/** How much each prior condemnation on this corridor hardens everyone else. */
export const CONTAGION_PER_CONDEMNATION = 0.13

/**
 * Probability this owner accepts the current offer.
 *
 * Money helps, but it is not the only term, and for some owners it is not the
 * dominant one — which is what makes a homestead genuinely different from a
 * timber LLC rather than just more expensive.
 */
export function acceptanceProbability(
  parcel: Parcel,
  taking: Taking,
  deal: ParcelDeal,
  countyApproval: number,
  condemnationsOnCorridor: number,
): number {
  if (deal.status === 'blocked') return 0

  let p = ARCHETYPE_BASE_ACCEPTANCE[parcel.archetype]

  // Money. Diminishing returns: the second doubling buys less than the first.
  const over = Math.max(0, deal.offerMultiple - 1)
  p += 0.42 * Math.sqrt(over) + 0.10 * over

  // A county that is broadly onside makes neighbours easier to deal with.
  p += (countyApproval - 50) / 220

  // Being cut in half is a different proposition from losing a strip of edge.
  if (taking.severed) p -= 0.14
  p -= Math.min(0.16, taking.severanceFactor * 0.3)

  // Word gets around. Every condemnation makes the next owner dig in.
  p -= CONTAGION_PER_CONDEMNATION * condemnationsOnCorridor

  // Somebody who has already refused twice is not warming up.
  p -= 0.07 * deal.refusals

  // The floor scales with the archetype rather than being a flat 2%. A flat
  // floor collapses "a family that will never sell" and "a church with a
  // cemetery behind it" into the same number once the penalties bite, which
  // erases exactly the distinction the mechanic is built on.
  const floor = 0.01 + 0.03 * ARCHETYPE_BASE_ACCEPTANCE[parcel.archetype]
  return Math.max(floor, Math.min(0.97, p))
}

/** Dollars owed if this offer is accepted. */
export function offerAmount(taking: Taking, deal: ParcelDeal): number {
  return taking.appraisedTotal * deal.offerMultiple
}

/**
 * Resolve one outstanding offer. Mutates the deal.
 * Returns what happened, for the quarter's log.
 */
export function resolveOffer(
  parcel: Parcel,
  taking: Taking,
  deal: ParcelDeal,
  countyApproval: number,
  condemnationsOnCorridor: number,
  rng: Rng,
): { accepted: boolean; amount: number } {
  const p = acceptanceProbability(parcel, taking, deal, countyApproval, condemnationsOnCorridor)
  if (rng.chance(p)) {
    const amount = offerAmount(taking, deal)
    deal.status = 'accepted'
    deal.paid = amount
    return { accepted: true, amount }
  }
  deal.status = 'holdout'
  deal.refusals += 1
  return { accepted: false, amount: 0 }
}

// --- condemnation --------------------------------------------------------

/** Quarters condemnation proceedings take, by how hard the owner will fight. */
export function condemnationQuarters(parcel: Parcel, rng: Rng): number {
  const base = parcel.archetype === 'homestead' || parcel.archetype === 'church' ? 3 : 2
  return base + (rng.chance(0.35) ? 1 : 0)
}

/** Legal cost of taking a parcel by condemnation. */
export function condemnationLegalCost(taking: Taking): number {
  // A floor plus a share of the award — small takings are dominated by the
  // fixed cost of running a case at all.
  return Math.max(140_000, taking.appraisedTotal * 0.38)
}

/**
 * What a court awards. Condemnation does not save money on the land itself:
 * juries in Georgia award fair market value plus consequential damages, and
 * they are not generous to a utility that could have paid.
 */
export function condemnationAward(taking: Taking, rng: Rng): number {
  return taking.appraisedTotal * rng.range(1.05, 1.4)
}

/** County approval lost when a parcel is taken by force. */
export function condemnationApprovalCost(parcel: Parcel): number {
  switch (parcel.archetype) {
    case 'church': return 22
    case 'homestead': return 16
    case 'row-crop': return 11
    case 'public': return 6
    default: return 5
  }
}
