// DATA STATUS: plausible 2026 figures, not yet checked against a source.

export type LineClassId = '115' | '230' | '230d' | '500'

export interface LineClass {
  id: LineClassId
  shortName: string
  name: string
  kv: number
  /** Thermal capacity in MW. */
  ratingMw: number
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
    shortName: '115 kV line',
    name: '115 kV single circuit',
    kv: 115,
    ratingMw: 150,
    circuits: 1,
    capexPerKm: 1_100_000,
    rowHalfWidthKm: 0.015,
    buildQuartersPer25Km: 2,
    blurb: 'Too small for the whole campus. Useful as a second path.',
    verified: false,
  },
  {
    id: '230',
    shortName: '230 kV line',
    name: '230 kV single circuit',
    kv: 230,
    ratingMw: 400,
    circuits: 1,
    capexPerKm: 1_900_000,
    rowHalfWidthKm: 0.023,
    buildQuartersPer25Km: 3,
    blurb: 'Carries 400 MW. A single fault takes all of it out.',
    verified: false,
  },
  {
    id: '230d',
    shortName: '230 kV double',
    name: '230 kV double circuit',
    kv: 230,
    ratingMw: 800,
    circuits: 2,
    capexPerKm: 2_900_000,
    rowHalfWidthKm: 0.028,
    buildQuartersPer25Km: 4,
    blurb: 'Two circuits on one set of towers. Losing one leaves 400 MW.',
    verified: false,
  },
  {
    id: '500',
    shortName: '500 kV line',
    name: '500 kV single circuit',
    kv: 500,
    ratingMw: 1_500,
    circuits: 1,
    capexPerKm: 4_200_000,
    rowHalfWidthKm: 0.031,
    buildQuartersPer25Km: 5,
    blurb: 'Far more than this contract needs. Widest right-of-way.',
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
