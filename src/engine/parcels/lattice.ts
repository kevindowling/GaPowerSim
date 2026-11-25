import type { HexGrid } from '../geo/mapTypes.ts'
import { OUTSIDE_STATE } from '../geo/mapTypes.ts'
import { pointToCell } from '../geo/hex.ts'
import { km2ToAcres, type Point } from '../geo/polygon.ts'
import { Rng, deriveSeed } from '../rng.ts'
import { ownerNameFor } from './owners.ts'
import type { Parcel, ParcelArchetype } from './types.ts'

export const LATTICE_KM = 0.8
const LATTICE_ACRES = km2ToAcres(LATTICE_KM * LATTICE_KM)

function cellAt(grid: HexGrid, x: number, y: number): number {
  const [col, row] = pointToCell(grid.spec, x, y)
  if (col < 0 || row < 0 || col >= grid.spec.cols || row >= grid.spec.rows) return -1
  return row * grid.spec.cols + col
}

const cache = new Map<string, Parcel | null>()

/** The stand-in parcel at lattice position (i, j), or null outside Georgia. */
export function latticeParcel(grid: HexGrid, i: number, j: number): Parcel | null {
  const id = `lat-${i}-${j}`
  const hit = cache.get(id)
  if (hit !== undefined) return hit

  const x0 = i * LATTICE_KM
  const y0 = j * LATTICE_KM
  const cell = cellAt(grid, x0 + LATTICE_KM / 2, y0 + LATTICE_KM / 2)
  let parcel: Parcel | null = null
  if (cell >= 0 && grid.county[cell] !== OUTSIDE_STATE) {
    const rng = new Rng(deriveSeed(0x1a77, id))
    const density = grid.population[cell] / 255
    const roll = rng.next()
    const archetype: ParcelArchetype = roll < 0.12 + density
      ? 'homestead'
      : roll < 0.14 + density ? 'public'
        : rng.chance(0.55) ? 'row-crop' : 'timber'
    parcel = {
      id,
      countyFips: grid.manifest.counties[grid.county[cell]]?.fips ?? '',
      poly: [[
        [x0, y0], [x0 + LATTICE_KM, y0], [x0 + LATTICE_KM, y0 + LATTICE_KM],
        [x0, y0 + LATTICE_KM], [x0, y0],
      ]],
      acres: LATTICE_ACRES,
      archetype,
      owner: ownerNameFor(archetype, id),
      assessedPerAcre: Math.round(grid.landValue[cell] * rng.range(0.85, 1.2) * (1 + density)),
    }
  }
  cache.set(id, parcel)
  return parcel
}

export function latticeParcelAt(grid: HexGrid, x: number, y: number): Parcel | null {
  return latticeParcel(grid, Math.floor(x / LATTICE_KM), Math.floor(y / LATTICE_KM))
}

/** Stand-in parcels along a line, skipping counties that have a real cadastre. */
export function latticeAlong(
  grid: HexGrid, line: readonly Point[], covered: ReadonlySet<string>,
): Parcel[] {
  const found = new Map<string, Parcel>()
  for (let k = 1; k < line.length; k++) {
    const [ax, ay] = line[k - 1]
    const [bx, by] = line[k]
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.2))
    for (let s = 0; s <= steps; s++) {
      const x = ax + ((bx - ax) * s) / steps
      const y = ay + ((by - ay) * s) / steps
      for (const dx of [-0.05, 0.05]) {
        for (const dy of [-0.05, 0.05]) {
          const p = latticeParcelAt(grid, x + dx, y + dy)
          if (p && !covered.has(p.countyFips)) found.set(p.id, p)
        }
      }
    }
  }
  return [...found.values()]
}
