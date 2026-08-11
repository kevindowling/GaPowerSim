/**
 * Least-cost corridor routing over the hex surface.
 *
 * The router deliberately produces the route a utility would actually propose:
 * short, flat, and across the cheapest ground it can find. Because cheap ground
 * in Georgia means farmland rather than subdivisions, the suggested route
 * reliably runs through the people with the least ability to stop it. That is
 * not a bug in the cost function — it is the thing the game is about, and the
 * player is free to pay more for a route that goes somewhere else.
 */

import { neighbors, cellDistance, HEX_WIDTH_KM, type GridSpec } from './hex.ts'
import { OUTSIDE_STATE, PROTECT, PROTECT_BLOCKING, type HexGrid } from './mapTypes.ts'

/** Relative difficulty of building across each physiographic province. */
const TERRAIN_COST: Record<number, number> = {
  0: Infinity, // outside Georgia
  1: 1.0,      // coastal plain — flat, easy
  2: 1.25,     // piedmont — rolling
  3: 2.4,      // blue ridge — mountains
  4: 1.9,      // valley and ridge
  5: 2.1,      // appalachian plateau
  6: 2.8,      // coastal marsh — wetland permitting and long spans
}

export interface RouteWeights {
  /** How hard the route works to avoid people. */
  population: number
  /** How much expensive land pushes the route away. */
  landValue: number
  /** Cost of a single cell of straight-line distance, in arbitrary units. */
  distance: number
  /** Penalty for a cell of open water — a long span on tall structures. */
  water: number
  /** Penalty for a cell of wetland — matting, a federal permit, and a season. */
  wetland: number
}

/**
 * Water is priced above people per cell but below a populated crossing overall,
 * because a river is a few cells wide and a town is many. The intended
 * behaviour: the router will detour several kilometres to find a narrow
 * crossing, and will still cross rather than run a line through a subdivision.
 */
export const DEFAULT_WEIGHTS: RouteWeights = {
  population: 7,
  landValue: 2.5,
  distance: 1,
  water: 9,
  wetland: 6,
}

/** Per-cell traversal cost. Infinity means impassable. */
export function cellCost(grid: HexGrid, cell: number, w: RouteWeights): number {
  if (grid.county[cell] === OUTSIDE_STATE) return Infinity

  const terrain = TERRAIN_COST[grid.terrain[cell]] ?? 1
  if (!Number.isFinite(terrain)) return Infinity

  const protection = grid.protection[cell]

  // Parks, wilderness and historic sites are refusals. A route does not price
  // its way through these; it goes around them or it does not get built.
  if ((protection & PROTECT_BLOCKING) !== 0) return Infinity

  const density = grid.population[cell] / 255
  const value = Math.min(1, grid.landValue[cell] / 50_000)

  // Water and wetland are crossable and expensive, which is the honest model:
  // a river crossing is a long span on tall structures, and a wetland crossing
  // is matting, a Section 404 permit, and a season of schedule. Priced high
  // enough that the router prefers to go around a few kilometres, low enough
  // that a crossing wins when going around is genuinely worse.
  let wet = 0
  if ((protection & PROTECT.WATER) !== 0) wet += w.water
  if ((protection & PROTECT.WETLAND) !== 0) wet += w.wetland

  return w.distance * terrain
    + w.population * density ** 1.5
    + w.landValue * value ** 1.3
    + wet
}

/** Minimal binary heap keyed by float priority. */
class Heap {
  private items: number[] = []
  private prio: number[] = []

  get size(): number { return this.items.length }

  push(item: number, priority: number): void {
    this.items.push(item)
    this.prio.push(priority)
    let i = this.items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.prio[parent] <= this.prio[i]) break
      this.swap(i, parent)
      i = parent
    }
  }

  pop(): number {
    const top = this.items[0]
    const lastItem = this.items.pop()!
    const lastPrio = this.prio.pop()!
    if (this.items.length > 0) {
      this.items[0] = lastItem
      this.prio[0] = lastPrio
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let smallest = i
        if (l < this.items.length && this.prio[l] < this.prio[smallest]) smallest = l
        if (r < this.items.length && this.prio[r] < this.prio[smallest]) smallest = r
        if (smallest === i) break
        this.swap(i, smallest)
        i = smallest
      }
    }
    return top
  }

  private swap(a: number, b: number): void {
    ;[this.items[a], this.items[b]] = [this.items[b], this.items[a]]
    ;[this.prio[a], this.prio[b]] = [this.prio[b], this.prio[a]]
  }
}

export interface RouteResult {
  /** Cell indices from start to goal inclusive. */
  cells: number[]
  /** Sum of traversal costs. */
  cost: number
  /** Straight-line-equivalent length in km. */
  lengthKm: number
}

/**
 * A* from one cell to another.
 *
 * The heuristic is hex distance times the cheapest possible per-cell cost, which
 * never overestimates — so the route returned is genuinely the least-cost one
 * under these weights, not merely a good one.
 */
export function findRoute(
  grid: HexGrid, start: number, goal: number, weights: RouteWeights = DEFAULT_WEIGHTS,
): RouteResult | null {
  const spec: GridSpec = grid.spec
  const total = spec.cols * spec.rows
  if (start < 0 || goal < 0 || start >= total || goal >= total) return null
  if (!Number.isFinite(cellCost(grid, goal, weights))) return null
  if (start === goal) return { cells: [start], cost: 0, lengthKm: 0 }

  const gScore = new Float64Array(total).fill(Infinity)
  const cameFrom = new Int32Array(total).fill(-1)
  const closed = new Uint8Array(total)

  const goalRow = Math.floor(goal / spec.cols)
  const goalCol = goal - goalRow * spec.cols
  // Cheapest a cell can possibly be, so the heuristic stays admissible.
  const minCellCost = weights.distance * 1.0

  const heuristic = (cell: number): number => {
    const row = Math.floor(cell / spec.cols)
    return cellDistance(cell - row * spec.cols, row, goalCol, goalRow) * minCellCost
  }

  gScore[start] = 0
  const open = new Heap()
  open.push(start, heuristic(start))

  const nb: number[] = new Array(12)

  while (open.size > 0) {
    const current = open.pop()
    if (closed[current]) continue
    closed[current] = 1

    if (current === goal) {
      const cells: number[] = []
      for (let c = goal; c !== -1; c = cameFrom[c]) cells.push(c)
      cells.reverse()
      return {
        cells,
        cost: gScore[goal],
        // Cells are ~1 km apart centre to centre.
        lengthKm: (cells.length - 1) * HEX_WIDTH_KM,
      }
    }

    const row = Math.floor(current / spec.cols)
    const n = neighbors(spec, current - row * spec.cols, row, nb)
    for (let i = 0; i < n; i++) {
      const nCell = nb[i * 2 + 1] * spec.cols + nb[i * 2]
      if (closed[nCell]) continue
      const step = cellCost(grid, nCell, weights)
      if (!Number.isFinite(step)) continue

      const tentative = gScore[current] + step
      if (tentative < gScore[nCell]) {
        gScore[nCell] = tentative
        cameFrom[nCell] = current
        open.push(nCell, tentative + heuristic(nCell))
      }
    }
  }

  return null
}

/**
 * Reduce a hex path to a polyline, dropping points that sit on a straight run.
 * Transmission structures go where the line changes direction, so the simplified
 * vertex list is a reasonable stand-in for where the angle towers are.
 */
export function pathToCenterline(
  cells: readonly number[], toWorld: (cell: number) => [number, number],
): Array<[number, number]> {
  if (cells.length === 0) return []
  const pts = cells.map(toWorld)
  if (pts.length <= 2) return pts

  const out: Array<[number, number]> = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = out[out.length - 1]
    const [bx, by] = pts[i]
    const [cx, cy] = pts[i + 1]
    // Cross product of the two segment directions; near zero means collinear.
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx)
    if (Math.abs(cross) > 1e-6) out.push(pts[i])
  }
  out.push(pts[pts.length - 1])
  return out
}
