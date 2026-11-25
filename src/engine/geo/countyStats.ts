import type { HexGrid } from './mapTypes.ts'
import { PROTECT } from './mapTypes.ts'
import { HEX_AREA_KM2 } from './hex.ts'

export interface CountyStats {
  areaKm2: number
  landValue: number
  /** Share of the county that is built up, parkland, and open water. */
  builtUp: number
  park: number
  water: number
  terrain: number
}

const cache = new Map<string, CountyStats>()

export function countyStats(grid: HexGrid, fips: string, builtUpByte: number): CountyStats | null {
  const hit = cache.get(fips)
  if (hit) return hit
  const idx = grid.manifest.counties.findIndex((c) => c.fips === fips)
  if (idx < 0) return null
  let n = 0, land = 0, built = 0, park = 0, water = 0
  const terrain: number[] = []
  for (let i = 0; i < grid.county.length; i++) {
    if (grid.county[i] !== idx) continue
    n++
    land += grid.landValue[i]
    if (grid.population[i] >= builtUpByte) built++
    if ((grid.protection[i] & PROTECT.PARK) !== 0) park++
    if ((grid.protection[i] & PROTECT.WATER) !== 0) water++
    terrain[grid.terrain[i]] = (terrain[grid.terrain[i]] ?? 0) + 1
  }
  if (n === 0) return null
  const out: CountyStats = {
    areaKm2: n * HEX_AREA_KM2,
    landValue: land / n,
    builtUp: built / n,
    park: park / n,
    water: water / n,
    terrain: terrain.reduce((best, v, i) => (v > (terrain[best] ?? 0) ? i : best), 0),
  }
  cache.set(fips, out)
  return out
}
