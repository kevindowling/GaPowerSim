import type { GameState } from '../types.ts'
import type { HexGrid } from '../geo/mapTypes.ts'
import { cellCorners, neighbors, pointToCell, HEX_AREA_KM2 } from '../geo/hex.ts'
import { corridorBuffer, intersect, multiPolyArea, subtract, type MultiPoly, type Point } from '../geo/polygon.ts'
import { plantType } from '../../data/plants.ts'
import { lineClass } from '../../data/transmission.ts'
import { latticeParcel } from '../parcels/lattice.ts'
import { footprintCells } from './siting.ts'

/** Share of a cell a plant has to cover before the cell counts as bought. */
const OWNED_SHARE = 0.6
const ACRES_PER_CELL = HEX_AREA_KM2 * 247.105

const onMap = (p: GameState['plants'][number]): boolean => p.typeId !== 'nuclear-uprate'

/** Cells the project owns outright. */
export function ownedCells(state: GameState, grid: HexGrid): Set<number> {
  const used = new Map<number, number>()
  for (const p of state.plants.filter(onMap)) {
    const a = plantType(p.typeId).acres
    const cells = footprintCells(grid, p.cell, a)
    for (const c of cells) used.set(c, (used.get(c) ?? 0) + a / cells.length)
  }
  return new Set([...used].filter(([, a]) => a / ACRES_PER_CELL >= OWNED_SHARE).map(([c]) => c))
}

/** The part of a right-of-way that still has to be bought. */
export function withoutOwned(
  buffer: MultiPoly, line: readonly Point[], owned: ReadonlySet<number>, grid: HexGrid,
): MultiPoly {
  if (owned.size === 0) return buffer
  const { cols, rows } = grid.spec
  const near = new Set<number>()
  const nb: number[] = new Array(12)
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1]
    const [bx, by] = line[i]
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.3))
    for (let s = 0; s <= steps; s++) {
      const [c, r] = pointToCell(grid.spec, ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps)
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue
      near.add(r * cols + c)
      const n = neighbors(grid.spec, c, r, nb)
      for (let k = 0; k < n; k++) near.add(nb[k * 2 + 1] * cols + nb[k * 2])
    }
  }
  let rest = buffer
  for (const cell of near) {
    if (!owned.has(cell)) continue
    const row = Math.floor(cell / cols)
    const flat = cellCorners(grid.spec, cell - row * cols, row)
    const ring: Point[] = []
    for (let i = 0; i < 6; i++) ring.push([flat[i * 2], flat[i * 2 + 1]])
    ring.push([...ring[0]])
    rest = subtract(rest, [[ring]])
  }
  return rest
}

/** Work out which plant sites touch. Mutates. */
export function refreshSiteLinks(state: GameState, grid: HexGrid): void {
  const { cols } = grid.spec
  const sites = new Map<number, Set<number>>()
  for (const p of state.plants.filter(onMap)) {
    const own = sites.get(p.cell) ?? new Set<number>()
    for (const c of footprintCells(grid, p.cell, plantType(p.typeId).acres)) own.add(c)
    sites.set(p.cell, own)
  }
  const nb: number[] = new Array(12)
  const touch = (a: Set<number>, b: Set<number>): boolean => {
    for (const c of a) {
      if (b.has(c)) return true
      const row = Math.floor(c / cols)
      const n = neighbors(grid.spec, c - row * cols, row, nb)
      for (let k = 0; k < n; k++) if (b.has(nb[k * 2 + 1] * cols + nb[k * 2])) return true
    }
    return false
  }
  const list = [...sites]
  const links: Array<[number, number]> = []
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (touch(list[i][1], list[j][1])) links.push([list[i][0], list[j][0]])
    }
  }
  state.siteLinks = links
}

/** Drop unsettled deals on land the project has since bought. Mutates. */
export function dropOwnedDeals(state: GameState, grid: HexGrid): void {
  const owned = ownedCells(state, grid)
  if (owned.size === 0) return
  for (const c of state.corridors) {
    if (c.status !== 'acquiring') continue
    const rest = withoutOwned(
      corridorBuffer(c.centerline, lineClass(c.classId).rowHalfWidthKm), c.centerline, owned, grid)
    for (const [id, deal] of Object.entries(c.deals)) {
      if (deal.status === 'accepted' || deal.status === 'condemned' || deal.status === 'condemning') continue
      const m = /^lat-(-?\d+)-(-?\d+)$/.exec(id)
      const parcel = m ? latticeParcel(grid, Number(m[1]), Number(m[2])) : null
      if (!parcel) continue
      if (multiPolyArea(intersect([parcel.poly], rest)) < 1e-6) {
        delete c.deals[id]
        delete c.takings[id]
        delete c.parcels[id]
      }
    }
  }
}
