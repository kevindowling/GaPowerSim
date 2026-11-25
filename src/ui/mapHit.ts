import type { GameState } from '../engine/types.ts'
import type { HexGrid } from '../engine/geo/mapTypes.ts'
import { cellPoint, footprintCells } from '../engine/turn/siting.ts'
import { distanceToCenterline } from '../engine/realtime/reliability.ts'
import { activeCustomers, openOffers } from '../engine/customers.ts'
import { lineClass, type LineClassId } from '../data/transmission.ts'
import { plantType } from '../data/plants.ts'
import type { Substation } from '../data/substations.ts'
import type { DataCenter } from '../data/dataCenters.ts'
import { dcRadius, gearPoint } from '../render/mapRenderer.ts'
import { lineGear } from '../engine/turn/reach.ts'

export type Selection =
  | { kind: 'site'; cell: number }
  | { kind: 'campus' }
  | { kind: 'substation' }
  | { kind: 'line'; id: string }
  | { kind: 'county'; fips: string }
  | { kind: 'dc'; id: string }
  | { kind: 'gsub'; id: string }
  | { kind: 'nsub'; id: string }
  /** The transformer where a line meets a data center. */
  | { kind: 'gear'; id: string; kv: number }
  | { kind: 'xline'; index: number }

export interface MapLine { kv: number; points: readonly [number, number][]; box: [number, number, number, number] }
export interface MapThings { substations: readonly Substation[]; lines: readonly MapLine[] }

export function withBox(l: { kv: number; points: readonly [number, number][] }): MapLine {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of l.points) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  return { kv: l.kv, points: l.points, box: [minX, minY, maxX, maxY] }
}

/** Scale from which existing lines of a voltage can be clicked. */
export const lineFrom = (kv: number): number => (kv >= 500 ? 2.5 : kv >= 230 ? 4 : kv >= 115 ? 7 : 12)
/** Scale from which a substation is drawn and can be clicked. */
export const subFrom = (kv: number): number => (kv >= 500 ? 1.2 : kv >= 230 ? 3 : 7)

const MARKER_PX = 18
const LINE_PX = 8

const NOTHING: MapThings = { substations: [], lines: [] }

/** Whether a mapped substation is the one the game already draws. */
export function isMain(game: GameState, grid: HexGrid, s: { x: number; y: number }): boolean {
  const [x, y] = cellPoint(grid, game.system.substationCell)
  return Math.hypot(s.x - x, s.y - y) <= 0.8
}

/** The transformer mark at a point on a line being planned. */
export function planGearAt(
  game: GameState, plan: { from: { id: string }; to: { id: string }; classId: LineClassId; centerline: ReadonlyArray<readonly [number, number]> },
  x: number, y: number, pxPerKm: number,
): { id: string; kv: number; at: [number, number] } | null {
  for (const t of lineGear(game, { fromNode: plan.from.id, toNode: plan.to.id, classId: plan.classId })) {
    const at = gearPoint(plan.centerline, t.atStart, pxPerKm)
    if (Math.hypot(at[0] - x, at[1] - y) <= MARKER_PX / pxPerKm) return { id: t.id, kv: lineClass(plan.classId).kv, at }
  }
  return null
}

/** What the player owns at a point on the map. */
export function mapHit(
  game: GameState, grid: HexGrid, x: number, y: number, cell: number, pxPerKm: number,
  centers: readonly DataCenter[] = [], things: MapThings = NOTHING,
): Selection | null {
  const reach = MARKER_PX / pxPerKm
  const spots: Array<{ at: [number, number]; sel: Selection }> = [
    { at: cellPoint(grid, game.contract.siteCell), sel: { kind: 'campus' } },
    { at: cellPoint(grid, game.system.substationCell), sel: { kind: 'substation' } },
    ...[...activeCustomers(game), ...openOffers(game)].map((c) => ({ at: [c.x, c.y] as [number, number], sel: { kind: 'dc' as const, id: c.id } })),
    ...game.corridors.flatMap((c) => lineGear(game, c).map((t) => ({
      at: gearPoint(c.centerline, t.atStart, pxPerKm),
      sel: { kind: 'gear' as const, id: t.id, kv: lineClass(c.classId).kv },
    }))),
    ...(game.builtSubs ?? []).map((b) => ({ at: [b.x, b.y] as [number, number], sel: { kind: 'nsub' as const, id: b.id } })),
    ...game.plants.map((p) => ({
      at: cellPoint(grid, p.cell), sel: { kind: 'site' as const, cell: p.cell },
    })),
  ]
  let best: Selection | null = null
  let least = reach
  for (const s of spots) {
    const d = Math.hypot(s.at[0] - x, s.at[1] - y)
    if (d <= least) { best = s.sel; least = d }
  }
  if (best) return best

  let sub: Substation | null = null
  let nearSub = 10 / pxPerKm
  for (const s of things.substations) {
    if (pxPerKm < subFrom(s.kv)) continue
    const d = Math.hypot(s.x - x, s.y - y)
    if (d <= nearSub) { sub = s; nearSub = d }
  }
  if (sub && !isMain(game, grid, sub)) return { kind: 'gsub', id: sub.id }

  for (const c of game.corridors) {
    if (distanceToCenterline(x, y, c.centerline) <= LINE_PX / pxPerKm) return { kind: 'line', id: c.id }
  }
  let dc: DataCenter | null = null
  let near = Infinity
  for (const d of centers) {
    const gap = Math.hypot(d.x - x, d.y - y)
    if (gap * pxPerKm <= dcRadius(d.mw) + 4 && gap < near) { dc = d; near = gap }
  }
  if (dc) return { kind: 'dc', id: dc.id }
  let line = -1
  let gap = 6 / pxPerKm
  things.lines.forEach((l, i) => {
    const [x0, y0, x1, y1] = l.box
    if (pxPerKm < lineFrom(l.kv) || x < x0 - gap || x > x1 + gap || y < y0 - gap || y > y1 + gap) return
    const d = distanceToCenterline(x, y, l.points)
    if (d <= gap) { line = i; gap = d }
  })
  if (line >= 0) return { kind: 'xline', index: line }
  for (const p of game.plants) {
    if (p.typeId !== 'nuclear-uprate' && footprintCells(grid, p.cell, plantType(p.typeId).acres).includes(cell)) {
      return { kind: 'site', cell: p.cell }
    }
  }
  return null
}

/** The county at a cell, or null outside Georgia. */
export function countyAt(grid: HexGrid, cell: number): string | null {
  if (cell < 0 || cell >= grid.county.length) return null
  return grid.manifest.counties[grid.county[cell]]?.fips ?? null
}

/** Where to draw the ring, or null if it is gone. */
export function selectionPoint(game: GameState, grid: HexGrid, s: Selection): [number, number] | null {
  switch (s.kind) {
    case 'campus': return cellPoint(grid, game.contract.siteCell)
    case 'substation': return cellPoint(grid, game.system.substationCell)
    case 'site': return game.plants.some((p) => p.cell === s.cell) ? cellPoint(grid, s.cell) : null
    case 'dc': {
      const c = [...activeCustomers(game), ...openOffers(game)].find((x) => x.id === s.id)
      return c ? [c.x, c.y] : null
    }
    case 'line':
    case 'county':
    case 'nsub': {
      const b = game.builtSubs?.find((x) => s.kind === 'nsub' && x.id === s.id)
      return b ? [b.x, b.y] : null
    }
    case 'gear':
    case 'gsub':
    case 'xline': return null
  }
}
