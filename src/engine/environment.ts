import { EMISSIONS } from '../data/emissions.ts'
import { plantType, type PlantKind } from '../data/plants.ts'

/** A year of one unit at its expected use. */
export interface YearlyOutput {
  mwh: number
  /** Short tons. */
  noxTons: number
  pmTons: number
  so2Tons: number
  co2Tons: number
  /** Average draw on a river, cubic feet a second. Null if unknown. */
  waterCfs: number | null
  waterGallons: number | null
}

const HOURS = 8760
/** Gallons a day in one cubic foot a second. */
const GAL_PER_DAY_PER_CFS = 646_317

export function yearlyOutput(kind: PlantKind): YearlyOutput {
  const t = plantType(kind)
  const e = EMISSIONS[kind]
  const mwh = t.nameplateMw * t.capacityFactor * HOURS
  const tons = (lb: number): number => (lb * mwh) / 2000
  return {
    mwh, noxTons: tons(e.nox), pmTons: tons(e.pm25), so2Tons: tons(e.so2), co2Tons: tons(e.co2),
    waterCfs: e.water === null ? null : (t.nameplateMw * t.capacityFactor * e.water * 24) / GAL_PER_DAY_PER_CFS,
    waterGallons: e.water === null ? null : e.water * mwh,
  }
}

/** Distance at which particles are reported. Closer than this the estimate does not hold. */
export const NEAR_KM = 2

/**
 * Annual average rise in fine particles at a distance, µg/m³. An estimate of
 * the whole area round a plant, good to about a factor of two within 50 km.
 */
export function particleRise(o: YearlyOutput, km: number): number {
  const r = Math.max(NEAR_KM, km) * 1000
  const direct = ((28_747 * o.pmTons) / (2 * Math.PI * r * 6000)) * Math.exp(-r / 500_000)
  return direct + o.noxTons * 2.7e-6 + o.so2Tons * 1.11e-5
}

/** Coefficients fitted to EPA's modeled plants nearest each region. */
const OZONE_FIT: Record<string, [number, number]> = {
  '13261': [0.01014, 0.807],
  '13175': [0.0254, 0.761],
}

/** Highest rise in ozone on one day, ppb. Good to about a factor of two. */
export function ozoneRise(o: YearlyOutput, regionFips: string): number {
  const [a, b] = OZONE_FIT[regionFips] ?? OZONE_FIT['13261']
  // The fit starts at 500 tons.
  return o.noxTons >= 500 ? a * o.noxTons ** b : (a * 500 ** b * o.noxTons) / 500
}

export interface Stream {
  name: string
  status: 'good' | 'impaired' | 'notAssessed'
  causes: string[]
  paths: Array<Array<[number, number]>>
}

/** Closest assessed stream, and how far it is. */
export function nearestStream(streams: readonly Stream[], x: number, y: number, limitKm: number): { stream: Stream; km: number } | null {
  let best: { stream: Stream; km: number } | null = null
  let least = limitKm
  for (const s of streams) {
    for (const p of s.paths) {
      for (let i = 1; i < p.length; i++) {
        const [ax, ay] = p[i - 1]
        const dx = p[i][0] - ax
        const dy = p[i][1] - ay
        const len = dx * dx + dy * dy
        const t = len > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0
        const d = Math.hypot(x - ax - dx * t, y - ay - dy * t)
        if (d < least) { least = d; best = { stream: s, km: d } }
      }
    }
  }
  return best
}
