import { describe, it, expect } from 'vitest'
import { routeLeg } from '../src/engine/geo/fineRoute.ts'
import { stitchRings } from '../scripts/fetch-hydrology.ts'
import type { Point } from '../src/engine/geo/polygon.ts'
import { PROTECT, type HexGrid } from '../src/engine/geo/mapTypes.ts'
import { HEX_SIZE_KM, cellCenter, pointToCell } from '../src/engine/geo/hex.ts'

const COLS = 40
const ROWS = 21

/** A flat, empty, uniformly rural grid. Tests add the interesting bits. */
function emptyGrid(): HexGrid {
  const total = COLS * ROWS
  const county = new Uint8Array(total) // 0 = in-state everywhere
  const terrain = new Uint8Array(total).fill(1) // coastal plain
  const population = new Uint8Array(total)
  const landValue = new Uint16Array(total).fill(3000)
  const protection = new Uint8Array(total)
  return {
    manifest: {
      version: 1, hexSizeKm: HEX_SIZE_KM, hexAreaKm2: 1,
      spec: { originX: 0, originY: 0, cols: COLS, rows: ROWS },
      cellCount: total, inStateCells: total, layers: [],
      counties: [{ fips: '13261', name: 'Sumter' }],
      terrainEnum: {}, dataGaps: [],
    },
    spec: { originX: 0, originY: 0, cols: COLS, rows: ROWS },
    county, terrain, population, landValue, protection,
  }
}

const at = (col: number, row: number): number => row * COLS + col
const point = (g: HexGrid, col: number, row: number): Point => cellCenter(g.spec, col, row)

function cellsOn(g: HexGrid, line: Point[]): number[] {
  const out = new Set<number>()
  for (let i = 1; i < line.length; i++) {
    for (let s = 0; s <= 200; s++) {
      const x = line[i - 1][0] + ((line[i][0] - line[i - 1][0]) * s) / 200
      const y = line[i - 1][1] + ((line[i][1] - line[i - 1][1]) * s) / 200
      const [c, r] = pointToCell(g.spec, x, y)
      out.add(at(c, r))
    }
  }
  return [...out]
}

const route = (g: HexGrid): Point[] | null =>
  routeLeg({ grid: g, parcels: [] }, point(g, 2, 10), point(g, 30, 10), 'direct')

describe('routing over water', () => {
  it('goes around a lake', () => {
    const g = emptyGrid()
    for (let c = 10; c <= 20; c++) for (let r = 8; r <= 12; r++) g.protection[at(c, r)] = PROTECT.WATER
    const wet = cellsOn(g, route(g)!).filter((c) => (g.protection[c] & PROTECT.WATER) !== 0)
    expect(wet.length).toBeLessThan(4)
  })

  it('crosses a river once', () => {
    const g = emptyGrid()
    for (let r = 0; r < ROWS; r++) g.protection[at(15, r)] = PROTECT.RIVER
    const wet = cellsOn(g, route(g)!).filter((c) => (g.protection[c] & PROTECT.RIVER) !== 0)
    expect(wet.length).toBeGreaterThan(0)
    expect(wet.length).toBeLessThanOrEqual(2)
  })

  it('finds no route through a wall of parkland', () => {
    const g = emptyGrid()
    for (let r = 0; r < ROWS; r++) for (const c of [15, 16]) g.protection[at(c, r)] = PROTECT.PARK
    expect(route(g)).toBeNull()
  })
})

describe('reading lakes from OpenStreetMap', () => {
  it('joins a shoreline split across ways, in any direction', () => {
    const rings = stitchRings([
      [[0, 0], [1, 0]],
      [[1, 1], [1, 0]],
      [[1, 1], [0, 1], [0, 0]],
    ])
    expect(rings).toHaveLength(1)
    expect(rings[0][0]).toEqual(rings[0][rings[0].length - 1])
    expect(rings[0].length).toBe(5)
  })
})
