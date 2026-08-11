/**
 * Transmission line classes.
 *
 * DATA STATUS: engineering-plausible figures for 2026 Georgia — thermal rating,
 * overnight cost per kilometre, right-of-way width — entered from general
 * knowledge of the technology rather than a citable source per field. Verified
 * against public sources in the M6 pass.
 *
 * The important design choice here is the double-circuit 230 kV option. A single
 * circuit carries the Americus load perfectly well and costs a third less. It
 * also means one storm, one broken structure, and the campus goes dark. Buying
 * redundancy is expensive, invisible, and looks like waste right up until the
 * night it isn't — which is exactly the bet the tutorial asks the player to make
 * six beats before the storm arrives.
 */

export type LineClassId = '115' | '230' | '230d' | '500'

export interface LineClass {
  id: LineClassId
  name: string
  kv: number
  /** Thermal capacity in MW. */
  ratingMw: number
  /** Number of independent circuits — 2 survives losing one. */
  circuits: number
  /** Overnight cost per kilometre, dollars, on easy ground. */
  capexPerKm: number
  /** Half the right-of-way width, in km. */
  rowHalfWidthKm: number
  /** Quarters to build, per 25 km of line. */
  buildQuartersPer25Km: number
  blurb: string
  verified: boolean
}

export const LINE_CLASSES: readonly LineClass[] = [
  {
    id: '115',
    name: '115 kV single circuit',
    kv: 115,
    ratingMw: 150,
    circuits: 1,
    capexPerKm: 1_100_000,
    rowHalfWidthKm: 0.015,
    buildQuartersPer25Km: 2,
    blurb: 'Cheap and narrow. Not enough on its own for a campus this size.',
    verified: false,
  },
  {
    id: '230',
    name: '230 kV single circuit',
    kv: 230,
    ratingMw: 400,
    circuits: 1,
    capexPerKm: 1_900_000,
    rowHalfWidthKm: 0.023,
    buildQuartersPer25Km: 3,
    blurb: 'Exactly enough for 400 MW, and exactly one thing that has to not break.',
    verified: false,
  },
  {
    id: '230d',
    name: '230 kV double circuit',
    kv: 230,
    ratingMw: 800,
    circuits: 2,
    capexPerKm: 2_900_000,
    rowHalfWidthKm: 0.028,
    buildQuartersPer25Km: 4,
    blurb: 'Two circuits on shared structures. Costs half again as much and survives losing one.',
    verified: false,
  },
  {
    id: '500',
    name: '500 kV single circuit',
    kv: 500,
    ratingMw: 1_500,
    circuits: 1,
    capexPerKm: 4_200_000,
    rowHalfWidthKm: 0.031,
    buildQuartersPer25Km: 5,
    blurb: 'Bulk transfer, wide right-of-way, and a tower line nobody fails to notice.',
    verified: false,
  },
]

export function lineClass(id: LineClassId): LineClass {
  const c = LINE_CLASSES.find((x) => x.id === id)
  if (!c) throw new Error(`unknown line class: ${id}`)
  return c
}

/** Construction capex for a length of line, before right-of-way. */
export function lineCapex(cls: LineClass, lengthKm: number): number {
  return cls.capexPerKm * lengthKm
}

export function lineBuildQuarters(cls: LineClass, lengthKm: number): number {
  return Math.max(2, Math.ceil((lengthKm / 25) * cls.buildQuartersPer25Km))
}
