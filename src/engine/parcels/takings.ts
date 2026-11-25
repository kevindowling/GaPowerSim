import {
  corridorBuffer, intersect, subtract, multiPolyArea, polyArea, bbox, bboxOverlaps,
  km2ToAcres, centerlineLength, type Point, type MultiPoly,
} from '../geo/polygon.ts'
import {
  ARCHETYPE_SEVERANCE_SENSITIVITY, type Parcel, type ParcelArchetype,
} from './types.ts'

/** A remainder piece smaller than this is effectively unusable. */
const UNECONOMIC_REMNANT_ACRES = 4

const SEVERED_MIN_ACRES = 2
const SEVERED_MIN_SHARE = 0.04

/** Survey, title, closing and crop damage: what any easement costs at minimum. */
const MINIMUM_PAYMENT: Record<ParcelArchetype, number> = {
  timber: 35_000, 'row-crop': 70_000, homestead: 210_000, church: 340_000,
  historic: 0, industrial: 130_000, public: 40_000,
}

/** A line beside a house lowers what the house is worth. */
const PROXIMITY_PREMIUM: Record<ParcelArchetype, number> = {
  timber: 1, 'row-crop': 1.15, homestead: 2.4, church: 2.4,
  historic: 1, industrial: 1.3, public: 1,
}

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

function severanceFactorFor(
  pieces: number[], parcel: Parcel, uneconomicAcres: number,
): number {
  const sensitivity = ARCHETYPE_SEVERANCE_SENSITIVITY[parcel.archetype]

  if (!isSevered(pieces)) {
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

function isSevered(pieceAcres: readonly number[]): boolean {
  if (pieceAcres.length < 2) return false
  const sorted = [...pieceAcres].sort((a, b) => b - a)
  const total = sorted.reduce((n, a) => n + a, 0)
  return sorted[1] >= SEVERED_MIN_ACRES && sorted[1] / total >= SEVERED_MIN_SHARE
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

  const severed = isSevered(pieceAcres)
  const landPayment = takenAcres * parcel.assessedPerAcre * PROXIMITY_PREMIUM[parcel.archetype]
  const severancePayment = remainderAcres * parcel.assessedPerAcre * severanceFactor
    + uneconomicRemnantAcres * parcel.assessedPerAcre * 0.6

  return {
    parcelId: parcel.id,
    takenAcres,
    remainderAcres,
    remainderPieces: pieceAcres.length,
    uneconomicRemnantAcres,
    severanceFactor,
    landPayment,
    severancePayment,
    appraisedTotal: Math.max(MINIMUM_PAYMENT[parcel.archetype], landPayment + severancePayment),
    severed,
  }
}

const boxes = new WeakMap<Parcel, [number, number, number, number]>()

/** A parcel's bounding box, computed once. */
export function parcelBox(parcel: Parcel): [number, number, number, number] {
  let b = boxes.get(parcel)
  if (!b) {
    b = bbox([parcel.poly])
    boxes.set(parcel, b)
  }
  return b
}

export function computeTakings(
  centerline: Point[], halfWidthKm: number, parcels: readonly Parcel[],
  trim?: (buffer: MultiPoly) => MultiPoly,
): CorridorTakings {
  const whole = corridorBuffer(centerline, halfWidthKm)
  const buffer = trim ? trim(whole) : whole
  const empty: CorridorTakings = {
    takings: [], totalAcres: 0, totalAppraised: 0,
    parcelsAffected: 0, parcelsSevered: 0,
    lengthKm: centerlineLength(centerline), buffer,
  }
  if (buffer.length === 0) return empty

  const bufferBox = bbox(buffer)
  const segments = centerline.slice(1).map(([x, y], i) => {
    const [px, py] = centerline[i]
    return [
      Math.min(x, px) - halfWidthKm, Math.min(y, py) - halfWidthKm,
      Math.max(x, px) + halfWidthKm, Math.max(y, py) + halfWidthKm,
    ] as [number, number, number, number]
  })
  const takings: Taking[] = []

  for (const parcel of parcels) {
    const box = parcelBox(parcel)
    if (!bboxOverlaps(bufferBox, box)) continue
    if (!segments.some((s) => bboxOverlaps(s, box))) continue
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
