// PRIVACY: owner names are generated. Real owners are never stored or shown.

import type { Poly } from '../geo/polygon.ts'

export type ParcelArchetype =
  | 'timber'
  | 'row-crop'
  | 'homestead'
  | 'church'     // church, and sometimes the cemetery behind it
  | 'historic'
  | 'industrial'
  | 'public'     // county, state or federal land

export interface Parcel {
  id: string
  countyFips: string
  /** Exterior ring then holes, in projected km. */
  poly: Poly
  acres: number
  archetype: ParcelArchetype
  owner: string
  /** Assessed land value, dollars per acre. */
  assessedPerAcre: number
}

export interface ParcelWire {
  id: string
  /** Ring 0 is the exterior; any others are holes. Flat coordinates in km. */
  rings: number[][]
  acres: number
  archetype: ParcelArchetype
  assessedPerAcre: number
}

export interface ParcelFile {
  version: number
  countyFips: string
  countyName: string
  /** Where the geometry came from. */
  source: string
  sourceUrl: string | null
  generatedAt: string
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

/** How much a severed remainder hurts this kind of owner, as a multiplier. */
export const ARCHETYPE_SEVERANCE_SENSITIVITY: Record<ParcelArchetype, number> = {
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
