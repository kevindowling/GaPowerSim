/**
 * What a corridor actually takes.
 *
 * This is where real parcel geometry earns its place. A transmission line does
 * not buy whole properties — it buys a strip across them, and the compensation
 * owed is the value of the strip PLUS the damage done to whatever is left. That
 * second part, severance damage, is what makes the *shape* of a route matter
 * and not just its length:
 *
 *   - A corridor that clips the corner of a field takes some acres and leaves a
 *     working farm behind. Cheap.
 *   - The same length of corridor straight through the middle of that field
 *     takes the same acres but leaves two pieces that equipment cannot cross.
 *     Far more expensive, and far more likely to produce a holdout.
 *
 * Because that difference falls out of the geometry rather than a lookup table,
 * hugging a property line is a real strategy that the real map rewards.
 */

import {
  corridorBuffer, intersect, subtract, multiPolyArea, polyArea, bbox, bboxOverlaps,
  km2ToAcres, centerlineLength, type Point, type MultiPoly,
} from '../geo/polygon.ts'
import {
  ARCHETYPE_SEVERANCE_SENSITIVITY, type Parcel,
} from './types.ts'

/** A remainder piece smaller than this is effectively unusable. */
const UNECONOMIC_REMNANT_ACRES = 4

export interface Taking {
  parcelId: string
  /** Acres inside the right-of-way. */
  takenAcres: number
  /** Acres left outside it. */
  remainderAcres: number
  /** How many separate pieces the remainder is in. Two or more means severed. */
  remainderPieces: number
  /** Acres left in pieces too small to be worth farming. */
  uneconomicRemnantAcres: number
  /** Fraction of remainder value lost to the taking, 0–1. */
  severanceFactor: number
  /** Payment for the land inside the right-of-way. */
  landPayment: number
  /** Payment for the damage to what is left. */
  severancePayment: number
  /** What a fair appraisal says this parcel is owed, before any negotiation. */
  appraisedTotal: number
  /** True if the corridor cut the parcel into pieces. */
  severed: boolean
}

export interface CorridorTakings {
  takings: Taking[]
  /** Right-of-way acres across every affected parcel. */
  totalAcres: number
  /** Sum of appraised compensation, before offers or condemnation. */
  totalAppraised: number
  parcelsAffected: number
  parcelsSevered: number
  lengthKm: number
  /** The swept right-of-way, for rendering. */
  buffer: MultiPoly
}

/**
 * How badly a severed remainder is damaged.
 *
 * An even split is the worst case — two half-parcels are worth much less than
 * one whole one. A sliver off the edge barely registers.
 */
function severanceFactorFor(
  pieces: number[], parcel: Parcel, uneconomicAcres: number,
): number {
  const sensitivity = ARCHETYPE_SEVERANCE_SENSITIVITY[parcel.archetype]

  if (pieces.length <= 1) {
    // Not severed: a strip off one side, with modest damage to access and
    // the loss of whatever could have been built in the right-of-way.
    return Math.min(0.12, 0.03 * sensitivity)
  }

  const sorted = [...pieces].sort((a, b) => b - a)
  const largest = sorted[0]
  const secondLargest = sorted[1] ?? 0
  // 0 for a token sliver, 1 for a dead-even split.
  const balance = largest > 0 ? (2 * secondLargest) / (largest + secondLargest) : 0

  let factor = 0.10 + 0.20 * balance
  if (pieces.length > 2) factor += 0.05 * Math.min(3, pieces.length - 2)
  if (uneconomicAcres > 0) factor += 0.08

  return Math.min(0.75, factor * sensitivity)
}

/** Compute the taking on one parcel from an already-built right-of-way. */
export function takingFor(parcel: Parcel, buffer: MultiPoly): Taking | null {
  const parcelMp: MultiPoly = [parcel.poly]
  const inside = intersect(parcelMp, buffer)
  const takenKm2 = multiPolyArea(inside)
  if (takenKm2 <= 1e-9) return null

  const outside = subtract(parcelMp, buffer)
  const pieceAcres = outside.map((poly) => km2ToAcres(polyArea(poly))).filter((a) => a > 1e-6)
  const remainderAcres = pieceAcres.reduce((s, a) => s + a, 0)
  const uneconomicRemnantAcres = pieceAcres
    .filter((a) => a < UNECONOMIC_REMNANT_ACRES)
    .reduce((s, a) => s + a, 0)

  const takenAcres = km2ToAcres(takenKm2)
  const severanceFactor = severanceFactorFor(pieceAcres, parcel, uneconomicRemnantAcres)

  const landPayment = takenAcres * parcel.assessedPerAcre
  const severancePayment = remainderAcres * parcel.assessedPerAcre * severanceFactor

  return {
    parcelId: parcel.id,
    takenAcres,
    remainderAcres,
    remainderPieces: pieceAcres.length,
    uneconomicRemnantAcres,
    severanceFactor,
    landPayment,
    severancePayment,
    appraisedTotal: landPayment + severancePayment,
    severed: pieceAcres.length >= 2,
  }
}

/**
 * Run a corridor across a set of parcels and price it.
 *
 * Only parcels whose bounding box overlaps the corridor's are tested, which
 * keeps this cheap enough to run live while the player drags a route around.
 */
export function computeTakings(
  centerline: Point[], halfWidthKm: number, parcels: readonly Parcel[],
): CorridorTakings {
  const buffer = corridorBuffer(centerline, halfWidthKm)
  const empty: CorridorTakings = {
    takings: [], totalAcres: 0, totalAppraised: 0,
    parcelsAffected: 0, parcelsSevered: 0,
    lengthKm: centerlineLength(centerline), buffer,
  }
  if (buffer.length === 0) return empty

  const bufferBox = bbox(buffer)
  const takings: Taking[] = []

  for (const parcel of parcels) {
    if (!bboxOverlaps(bufferBox, bbox([parcel.poly]))) continue
    const t = takingFor(parcel, buffer)
    if (t) takings.push(t)
  }

  return {
    takings,
    totalAcres: takings.reduce((s, t) => s + t.takenAcres, 0),
    totalAppraised: takings.reduce((s, t) => s + t.appraisedTotal, 0),
    parcelsAffected: takings.length,
    parcelsSevered: takings.filter((t) => t.severed).length,
    lengthKm: centerlineLength(centerline),
    buffer,
  }
}

/** Right-of-way half-width in km for a voltage class. */
export const ROW_HALF_WIDTH_KM: Record<number, number> = {
  // Typical total right-of-way widths: 115 kV ~30 m, 230 kV ~46 m, 500 kV ~61 m.
  115: 0.015,
  230: 0.023,
  500: 0.031,
}
