/**
 * Land parcels — the substrate the eminent-domain mechanic runs on.
 *
 * A parcel record carries real boundary geometry, real acreage and a real
 * assessed value. It does NOT carry a real owner name. Georgia parcel ownership
 * is public record, but naming identifiable private individuals at their home
 * address inside a public web game about seizing their property is a different
 * act from mapping their lot, and the routing puzzle loses nothing by generating
 * the names. Owner-identifying fields are stripped at ingest in
 * scripts/fetch-parcels.ts and never reach this file.
 */

import type { Poly } from '../geo/polygon.ts'

/**
 * How an owner behaves when a transmission line is proposed across their land.
 * This is the single most important field for gameplay, and it is inferred from
 * parcel size, land use and proximity to buildings rather than from anything
 * about a real person.
 */
export type ParcelArchetype =
  | 'timber'     // absentee corporate timberland — a cheque is a cheque
  | 'row-crop'   // working farm — will deal, but a line through the middle is a real problem
  | 'homestead'  // family home and land — often not for sale at any price
  | 'church'     // church, and sometimes the cemetery behind it
  | 'historic'   // protected site — cannot be taken at all
  | 'industrial'
  | 'public'     // county, state or federal land

export interface Parcel {
  id: string
  countyFips: string
  /** Exterior ring then holes, in projected km. */
  poly: Poly
  acres: number
  archetype: ParcelArchetype
  /** SYNTHESIZED. Never a real person. See the note at the top of this file. */
  owner: string
  /** Assessed land value, dollars per acre. */
  assessedPerAcre: number
}

/**
 * On-disk form of a parcel.
 *
 * Rings are stored as flat [x0,y0,x1,y1,…] arrays rather than arrays of pairs.
 * A rural county runs to tens of thousands of parcels, and the flat form cuts
 * both the file size and the JSON parse time roughly in half. The loader
 * inflates these into `Parcel` once, at load.
 */
export interface ParcelWire {
  id: string
  /** Ring 0 is the exterior; any others are holes. Flat coordinates in km. */
  rings: number[][]
  acres: number
  archetype: ParcelArchetype
  assessedPerAcre: number
  /**
   * Owner names are NOT stored. They are generated at load from the parcel id,
   * which keeps them stable across sessions while keeping a five-figure
   * cadastre's worth of invented names out of the shipped file.
   */
}

export interface ParcelFile {
  version: number
  countyFips: string
  countyName: string
  /** Where the geometry came from. */
  source: string
  sourceUrl: string | null
  generatedAt: string
  /**
   * TRUE when the geometry is procedurally generated rather than surveyed.
   * The game surfaces this to the player: a synthetic cadastre is a stand-in,
   * and must never be presented as a real map of who owns what.
   */
  synthetic: boolean
  note: string
  parcels: ParcelWire[]
}

/** Inflate the on-disk form into the shape the engine works with. */
export function inflateParcel(
  w: ParcelWire, countyFips: string, nameOwner: (archetype: ParcelArchetype, id: string) => string,
): Parcel {
  return {
    id: w.id,
    countyFips,
    poly: w.rings.map((flat) => {
      const ring: Array<[number, number]> = []
      for (let i = 0; i < flat.length; i += 2) ring.push([flat[i], flat[i + 1]])
      // Close the ring if the writer trimmed the duplicate final point.
      const first = ring[0]
      const last = ring[ring.length - 1]
      if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push([...first])
      return ring
    }),
    acres: w.acres,
    archetype: w.archetype,
    owner: nameOwner(w.archetype, w.id),
    assessedPerAcre: w.assessedPerAcre,
  }
}

/** Baseline willingness to sell, before money and politics. */
export const ARCHETYPE_BASE_ACCEPTANCE: Record<ParcelArchetype, number> = {
  timber: 0.78,
  industrial: 0.62,
  public: 0.55,
  'row-crop': 0.42,
  homestead: 0.18,
  church: 0.05,
  historic: 0,
}

/** How much a severed remainder hurts this kind of owner, as a multiplier. */
export const ARCHETYPE_SEVERANCE_SENSITIVITY: Record<ParcelArchetype, number> = {
  // Split a working farm and equipment can no longer cross it. That is the
  // classic severance case and it is expensive.
  'row-crop': 1.5,
  homestead: 1.35,
  church: 1.2,
  timber: 0.7,
  industrial: 1.0,
  public: 0.8,
  historic: 1.0,
}

/** Land that cannot be condemned at any price. */
export function isProtected(archetype: ParcelArchetype): boolean {
  return archetype === 'historic'
}

export const ARCHETYPE_LABEL: Record<ParcelArchetype, string> = {
  timber: 'Timber company',
  'row-crop': 'Working farm',
  homestead: 'Family homestead',
  church: 'Church',
  historic: 'Historic site',
  industrial: 'Industrial',
  public: 'Public land',
}
