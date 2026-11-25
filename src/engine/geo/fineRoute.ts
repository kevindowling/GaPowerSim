import type { HexGrid } from './mapTypes.ts'
import { OUTSIDE_STATE, PROTECT, PROTECT_BLOCKING } from './mapTypes.ts'
import { pointToCell } from './hex.ts'
import type { Point } from './polygon.ts'
import { isProtected, type Parcel, type ParcelArchetype } from '../parcels/types.ts'
import { LATTICE_KM, latticeParcelAt } from '../parcels/lattice.ts'

export type RouteStyle = 'balanced' | 'direct' | 'property' | 'homes'

export const ROUTE_STYLES: ReadonlyArray<{ id: RouteStyle; label: string; blurb: string }> = [
  { id: 'balanced', label: 'Balanced', blurb: 'Weighs length, homes and property lines.' },
  { id: 'direct', label: 'Shortest', blurb: 'Least line to build. Crosses whatever is in the way.' },
  { id: 'property', label: 'Property lines', blurb: 'Follows boundaries, so fewer farms are cut in two.' },
  { id: 'homes', label: 'Avoid homes', blurb: 'Keeps away from houses and churches. Longer.' },
]

interface StyleWeights {
  /** Multiplier on the cost of running along a boundary. */
  boundary: number
  home: number
  church: number
  building: number
  population: number
}

const WEIGHTS: Record<RouteStyle, StyleWeights> = {
  balanced: { boundary: 0.62, home: 2.2, church: 5, building: 4, population: 4 },
  direct: { boundary: 1, home: 0.5, church: 2, building: 2, population: 1.5 },
  property: { boundary: 0.3, home: 1.4, church: 5, building: 4, population: 4 },
  homes: { boundary: 0.8, home: 9, church: 14, building: 14, population: 14 },
}

const CELL_KM = 0.06
/** Clearance kept from protected parcels: the widest half right-of-way and a margin. */
const KEEP_OFF_KM = 0.04
const MAX_CELLS = 420_000
/** Search margins, widened when something large is in the way. */
const MARGINS_KM = [5, 20, 60]

/** Codes stored per raster cell; 0 means no parcel here. */
const CODE: Record<ParcelArchetype, number> = {
  timber: 1, 'row-crop': 2, homestead: 3, church: 4, historic: 5, industrial: 6, public: 7,
}

const TERRAIN_COST: Record<number, number> = {
  1: 1.0, 2: 1.15, 3: 2.2, 4: 1.7, 5: 1.9, 6: 2.6,
}

interface Raster {
  x0: number
  y0: number
  cols: number
  rows: number
  code: Uint8Array
  boundary: Uint8Array
}

const rasters = new WeakMap<readonly Parcel[], Raster>()

/** Burn a cadastre into the fine grid. Done once per county file. */
export function rasterFor(parcels: readonly Parcel[]): Raster | null {
  if (parcels.length === 0) return null
  const hit = rasters.get(parcels)
  if (hit) return hit

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of parcels) {
    for (const [x, y] of p.poly[0]) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  const cols = Math.ceil((maxX - minX) / CELL_KM) + 1
  const rows = Math.ceil((maxY - minY) / CELL_KM) + 1
  const code = new Uint8Array(cols * rows)
  const owner = new Int32Array(cols * rows).fill(-1)

  for (let k = 0; k < parcels.length; k++) {
    const ring = parcels[k].poly[0]
    const c = CODE[parcels[k].archetype]
    let loY = Infinity, hiY = -Infinity
    let sx = 0, sy = 0
    for (const [x, y] of ring) {
      if (y < loY) loY = y
      if (y > hiY) hiY = y
      sx += x
      sy += y
    }
    const r0 = Math.max(0, Math.floor((loY - minY) / CELL_KM))
    const r1 = Math.min(rows - 1, Math.ceil((hiY - minY) / CELL_KM))
    for (let r = r0; r <= r1; r++) {
      const y = minY + (r + 0.5) * CELL_KM
      const xs: number[] = []
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if ((yi > y) !== (yj > y)) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi)
      }
      xs.sort((a, b) => a - b)
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const c0 = Math.max(0, Math.ceil((xs[i] - minX) / CELL_KM - 0.5))
        const c1 = Math.min(cols - 1, Math.floor((xs[i + 1] - minX) / CELL_KM - 0.5))
        for (let col = c0; col <= c1; col++) {
          code[r * cols + col] = c
          owner[r * cols + col] = k
        }
      }
    }
    // Town lots can be smaller than a cell and miss every cell centre.
    const cc = Math.floor((sx / ring.length - minX) / CELL_KM)
    const cr = Math.floor((sy / ring.length - minY) / CELL_KM)
    if (cc >= 0 && cr >= 0 && cc < cols && cr < rows) {
      const idx = cr * cols + cc
      if (c === CODE.church || c === CODE.historic || code[idx] === 0) code[idx] = c
    }
  }

  // Keep the whole right-of-way off land that cannot be bought.
  for (const p of parcels) {
    if (!isProtected(p.archetype)) continue
    let ax = Infinity, ay = Infinity, bx = -Infinity, by = -Infinity
    for (const [x, y] of p.poly[0]) {
      ax = Math.min(ax, x); ay = Math.min(ay, y); bx = Math.max(bx, x); by = Math.max(by, y)
    }
    const c0 = Math.max(0, Math.floor((ax - KEEP_OFF_KM - minX) / CELL_KM))
    const c1 = Math.min(cols - 1, Math.floor((bx + KEEP_OFF_KM - minX) / CELL_KM))
    const r0 = Math.max(0, Math.floor((ay - KEEP_OFF_KM - minY) / CELL_KM))
    const r1 = Math.min(rows - 1, Math.floor((by + KEEP_OFF_KM - minY) / CELL_KM))
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) code[r * cols + c] = CODE[p.archetype]
  }

  const boundary = new Uint8Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const o = owner[i]
      if ((c + 1 < cols && owner[i + 1] !== o) || (r + 1 < rows && owner[i + cols] !== o)) {
        boundary[i] = 1
      }
    }
  }

  const raster = { x0: minX, y0: minY, cols, rows, code, boundary }
  rasters.set(parcels, raster)
  return raster
}

export interface RouteSurface {
  grid: HexGrid
  /** Loaded cadastre for the scenario county; may be empty. */
  parcels: readonly Parcel[]
  /** Building locations, projected km. */
  buildings?: readonly Point[]
  /** Existing transmission lines. Running beside one is cheaper. */
  powerLines?: ReadonlyArray<{ points: readonly Point[] }>
  /** Hex cells the project already owns. */
  owned?: ReadonlySet<number>
}

const OWNED_COST = 0.5

const COLOCATION = 0.7
const powerBins = new WeakMap<object, Set<number>>()

function binsAlongPower(lines: RouteSurface['powerLines']): Set<number> | null {
  if (!lines || lines.length === 0) return null
  let bins = powerBins.get(lines)
  if (!bins) {
    bins = new Set()
    for (const l of lines) {
      for (let i = 1; i < l.points.length; i++) {
        const [ax, ay] = l.points[i - 1]
        const [bx, by] = l.points[i]
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (BIN_KM / 2)))
        for (let s = 0; s <= n; s++) {
          bins.add(binKey(ax + ((bx - ax) * s) / n, ay + ((by - ay) * s) / n))
        }
      }
    }
    powerBins.set(lines, bins)
  }
  return bins
}

const buildingBins = new WeakMap<readonly Point[], Map<number, number>>()
const BIN_KM = 0.12
const binKey = (x: number, y: number): number =>
  Math.floor(x / BIN_KM) * 100_003 + Math.floor(y / BIN_KM)

function buildingsNear(buildings: readonly Point[] | undefined): Map<number, number> | null {
  if (!buildings || buildings.length === 0) return null
  let bins = buildingBins.get(buildings)
  if (!bins) {
    bins = new Map()
    for (const [x, y] of buildings) {
      const k = binKey(x, y)
      bins.set(k, (bins.get(k) ?? 0) + 1)
    }
    buildingBins.set(buildings, bins)
  }
  return bins
}

/** Cheapest path between two points, as a simplified polyline. Null if none. */
export function routeLeg(
  surface: RouteSurface, from: Point, to: Point, style: RouteStyle,
): Point[] | null {
  for (const margin of MARGINS_KM) {
    const line = search(surface, from, to, style, margin)
    if (line) return line
  }
  return null
}

function search(
  surface: RouteSurface, from: Point, to: Point, style: RouteStyle, margin: number,
): Point[] | null {
  const { grid } = surface
  const w = WEIGHTS[style]
  const raster = rasterFor(surface.parcels)
  const bins = buildingsNear(surface.buildings)
  const beside = binsAlongPower(surface.powerLines)

  const minX = Math.min(from[0], to[0]) - margin
  const maxX = Math.max(from[0], to[0]) + margin
  const minY = Math.min(from[1], to[1]) - margin
  const maxY = Math.max(from[1], to[1]) + margin
  const step = Math.max(CELL_KM, Math.sqrt(((maxX - minX) * (maxY - minY)) / MAX_CELLS))
  const cols = Math.ceil((maxX - minX) / step)
  const rows = Math.ceil((maxY - minY) / step)
  const total = cols * rows

  const at = (p: Point): number => {
    const c = Math.min(cols - 1, Math.max(0, Math.floor((p[0] - minX) / step)))
    const r = Math.min(rows - 1, Math.max(0, Math.floor((p[1] - minY) / step)))
    return r * cols + c
  }
  const centre = (i: number): Point => [
    minX + ((i % cols) + 0.5) * step, minY + (Math.floor(i / cols) + 0.5) * step,
  ]

  const cost = new Float32Array(total) // 0 = not computed yet
  const costAt = (i: number): number => {
    if (cost[i] !== 0) return cost[i]
    const [x, y] = centre(i)
    let v = Infinity
    const [hc, hr] = pointToCell(grid.spec, x, y)
    if (hc >= 0 && hr >= 0 && hc < grid.spec.cols && hr < grid.spec.rows) {
      const h = hr * grid.spec.cols + hc
      const prot = grid.protection[h]
      if (grid.county[h] !== OUTSIDE_STATE && (prot & PROTECT_BLOCKING) === 0) {
        v = TERRAIN_COST[grid.terrain[h]] ?? 1
        v += w.population * (grid.population[h] / 255) ** 1.5
        if ((prot & PROTECT.WATER) !== 0) v += 5
        else if ((prot & PROTECT.RIVER) !== 0) v += 0.8
        if ((prot & PROTECT.WETLAND) !== 0) v += 3

        let code = 0
        let edge = false
        if (raster) {
          const c = Math.floor((x - raster.x0) / CELL_KM)
          const r = Math.floor((y - raster.y0) / CELL_KM)
          if (c >= 0 && r >= 0 && c < raster.cols && r < raster.rows) {
            code = raster.code[r * raster.cols + c]
            edge = raster.boundary[r * raster.cols + c] === 1
          }
        }
        if (code === 0) {
          const p = latticeParcelAt(grid, x, y)
          if (p) {
            code = CODE[p.archetype]
            const fx = Math.abs(x / LATTICE_KM - Math.round(x / LATTICE_KM)) * LATTICE_KM
            const fy = Math.abs(y / LATTICE_KM - Math.round(y / LATTICE_KM)) * LATTICE_KM
            edge = Math.min(fx, fy) < step * 0.6
          }
        }
        if (surface.owned?.has(h)) v = OWNED_COST
        else if (code === CODE.historic) v = Infinity
        else {
          if (code === CODE.homestead) v += w.home
          else if (code === CODE.church) v += w.church
          else if (code === CODE.industrial) v += 0.6
          if (bins) v += w.building * Math.min(3, bins.get(binKey(x, y)) ?? 0)
          if (edge) v *= w.boundary
          else if (beside?.has(binKey(x, y))) v *= COLOCATION
        }
      }
    }
    cost[i] = v
    return v
  }

  const start = at(from)
  const goal = at(to)
  if (start === goal) return [from, to]

  const g = new Float32Array(total).fill(Infinity)
  const prev = new Int32Array(total).fill(-1)
  const closed = new Uint8Array(total)
  const gc = goal % cols
  const gr = Math.floor(goal / cols)
  const least = Math.min(0.3, w.boundary)
  const h = (i: number): number => {
    const dx = Math.abs((i % cols) - gc)
    const dy = Math.abs(Math.floor(i / cols) - gr)
    return (Math.max(dx, dy) + 0.4142 * Math.min(dx, dy)) * least
  }

  // Binary heap over (priority, node).
  const hp: number[] = []
  const hn: number[] = []
  const push = (n: number, p: number): void => {
    let i = hn.length
    hn.push(n)
    hp.push(p)
    while (i > 0) {
      const q = (i - 1) >> 1
      if (hp[q] <= p) break
      hp[i] = hp[q]; hn[i] = hn[q]
      i = q
    }
    hp[i] = p; hn[i] = n
  }
  const pop = (): number => {
    const top = hn[0]
    const p = hp.pop()!
    const n = hn.pop()!
    if (hn.length > 0) {
      let i = 0
      for (;;) {
        let k = 2 * i + 1
        if (k >= hn.length) break
        if (k + 1 < hn.length && hp[k + 1] < hp[k]) k++
        if (hp[k] >= p) break
        hp[i] = hp[k]; hn[i] = hn[k]
        i = k
      }
      hp[i] = p; hn[i] = n
    }
    return top
  }

  g[start] = 0
  push(start, h(start))
  let found = false
  while (hn.length > 0) {
    const cur = pop()
    if (closed[cur]) continue
    closed[cur] = 1
    if (cur === goal) { found = true; break }
    const c = cur % cols
    const r = (cur - c) / cols
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue
        const nc = c + dc
        const nr = r + dr
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue
        const n = nr * cols + nc
        if (closed[n]) continue
        const k = n === goal ? 1 : costAt(n)
        if (k === Infinity) continue
        const t = g[cur] + k * (dr !== 0 && dc !== 0 ? 1.4142 : 1)
        if (t < g[n]) {
          g[n] = t
          prev[n] = cur
          push(n, t + h(n))
        }
      }
    }
  }
  if (!found) return null

  const cells: number[] = []
  for (let i = goal; i !== -1; i = prev[i]) cells.push(i)
  cells.reverse()
  const pts = cells.map(centre)
  pts[0] = from
  pts[pts.length - 1] = to

  const clear = (a: Point, b: Point): boolean => {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (step * 0.8))
    for (let i = 1; i < n; i++) {
      const p: Point = [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]
      if (costAt(at(p)) === Infinity) return false
    }
    return true
  }
  const tol = style === 'property' ? step * 0.75 : step * 1.3
  return simplifyLine(pts, tol, clear)
}

/** Douglas-Peucker with a veto on segments that cross refused ground. */
function simplifyLine(
  pts: readonly Point[], tol: number, clear: (a: Point, b: Point) => boolean,
): Point[] {
  const keep = new Uint8Array(pts.length)
  keep[0] = 1
  keep[pts.length - 1] = 1
  const stack: Array<[number, number]> = [[0, pts.length - 1]]
  while (stack.length > 0) {
    const [a, b] = stack.pop()!
    if (b - a < 2) continue
    const [ax, ay] = pts[a]
    const dx = pts[b][0] - ax
    const dy = pts[b][1] - ay
    const len = Math.hypot(dx, dy) || 1e-9
    let worst = -1
    let at = -1
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len
      if (d > worst) { worst = d; at = i }
    }
    if (worst > tol || !clear(pts[a], pts[b])) {
      keep[at] = 1
      stack.push([a, at], [at, b])
    }
  }
  return pts.filter((_, i) => keep[i] === 1)
}

/** Buildings within a distance of a line. */
export function buildingsAlong(
  line: readonly Point[], buildings: readonly Point[] | undefined, withinKm: number,
): number {
  if (!buildings) return 0
  let n = 0
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of line) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  for (const [x, y] of buildings) {
    if (x < minX - withinKm || x > maxX + withinKm || y < minY - withinKm || y > maxY + withinKm) continue
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = line[i - 1]
      const dx = line[i][0] - ax
      const dy = line[i][1] - ay
      const l2 = dx * dx + dy * dy
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0
      if (Math.hypot(x - ax - t * dx, y - ay - t * dy) <= withinKm) { n++; break }
    }
  }
  return n
}
