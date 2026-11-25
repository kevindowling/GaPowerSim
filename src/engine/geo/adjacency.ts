import type { CountiesFile } from './mapTypes.ts'

/** Counties that share a border with one. */
export function adjacentCounties(file: CountiesFile, fips: string): string[] {
  const corners = (polys: readonly (readonly ArrayLike<number>[])[]): Set<string> => {
    const out = new Set<string>()
    for (const rings of polys) {
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i += 2) out.add(`${ring[i]},${ring[i + 1]}`)
      }
    }
    return out
  }
  const home = file.counties.find((c) => c.fips === fips)
  if (!home) return []
  const mine = corners(home.polygons as never)
  return file.counties.filter((c) => {
    if (c.fips === fips) return false
    let shared = 0
    for (const p of corners(c.polygons as never)) if (mine.has(p)) shared++
    return shared >= 1
  }).map((c) => c.fips)
}
