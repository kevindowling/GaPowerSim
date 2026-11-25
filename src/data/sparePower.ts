import { quarterInYear, yearOf, type QuarterIndex } from '../engine/time.ts'

// Georgia Power's own forecast against its reserve target, from Public Service
// Commission staff testimony of 12 Nov 2025 (dockets 56298 and 56310, exhibits
// STF-NHW-4 and 5). MW. Capacity includes the 9,885 MW approved in December 2025.

export interface SpareYear {
  /** Winter 2027 is December 2026 to February 2027. */
  year: number
  winter: number
  summer: number
}

export const SPARE: readonly SpareYear[] = [
  { year: 2027, winter: 1739, summer: 936 },
  { year: 2028, winter: 406, summer: -450 },
  { year: 2029, winter: -119, summer: -1764 },
  { year: 2030, winter: -73, summer: -291 },
  { year: 2031, winter: 752, summer: 568 },
  { year: 2032, winter: -66, summer: 200 },
]

export const SPARE_SOURCES = [
  {
    label: 'Georgia PSC staff testimony, 12 Nov 2025, dockets 56298 and 56310',
    url: 'https://services.psc.ga.gov/api/v1/External/Public/Get/Document/DownloadFile/224506/105769',
  },
] as const

/**
 * Winter surplus before any new data center: PSC staff's contracts-only load
 * with every approved plant, derived from the same exhibits. MW.
 */
export const POOL: ReadonlyArray<{ year: number; mw: number }> = [
  { year: 2027, mw: 2733 }, { year: 2028, mw: 2902 }, { year: 2029, mw: 3815 },
  { year: 2030, mw: 5089 }, { year: 2031, mw: 6831 }, { year: 2032, mw: 6489 },
]

/** Spare power there is to share out in a quarter. */
export function poolAt(q: QuarterIndex): number {
  const year = yearOf(q) + (quarterInYear(q) === 4 ? 1 : 0)
  const row = POOL.find((p) => p.year === Math.max(POOL[0].year, year))
  return (row ?? POOL[POOL.length - 1]).mw
}

/** Georgia Power's large-load report for the third quarter of 2026, filed 16 Nov 2026. MW. */
export const LARGE_LOAD = { asking: 89_900, committed: 16_100, customers: 32, underway: 10_600 }

/** What is spare in a quarter: the winter or the summer peak it falls in. */
export function spareAt(q: QuarterIndex): { mw: number; season: string } {
  const quarter = quarterInYear(q)
  const year = yearOf(q) + (quarter === 4 ? 1 : 0)
  const row = SPARE.find((s) => s.year === Math.max(SPARE[0].year, year)) ?? SPARE[SPARE.length - 1]
  const winter = quarter === 4 || quarter === 1
  return winter || year < SPARE[0].year
    ? { mw: row.winter, season: `winter ${row.year - 1}/${String(row.year).slice(2)}` }
    : { mw: row.summer, season: `summer ${row.year}` }
}
