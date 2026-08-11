import { describe, it, expect } from 'vitest'
import { cellCost, findRoute, DEFAULT_WEIGHTS } from '../src/engine/geo/routing.ts'
import { PROTECT, PROTECT_BLOCKING, type HexGrid } from '../src/engine/geo/mapTypes.ts'
import { HEX_SIZE_KM } from '../src/engine/geo/hex.ts'

/**
 * Water as a routing constraint.
 *
 * Routing used to treat any protected cell as impassable. That is wrong in the
 * direction that matters: transmission lines cross rivers and wetlands all the
 * time — they just pay for it in spans, permits and schedule. Modelling that as
 * a wall hides the actual decision, which is money and time against going
 * around. Parks and historic sites are the real refusals.
 */

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

describe('water in the cost surface', () => {
  it('makes a water cell far more expensive than dry land, but not impassable', () => {
    const grid = emptyGrid()
    const dry = at(5, 5)
    const wet = at(6, 5)
    grid.protection[wet] = PROTECT.WATER

    const dryCost = cellCost(grid, dry, DEFAULT_WEIGHTS)
    const wetCost = cellCost(grid, wet, DEFAULT_WEIGHTS)

    expect(Number.isFinite(wetCost)).toBe(true)
    expect(wetCost).toBeGreaterThan(dryCost * 4)
  })

  it('prices a wetland below open water — matting is cheaper than a long span', () => {
    const grid = emptyGrid()
    grid.protection[at(5, 5)] = PROTECT.WATER
    grid.protection[at(6, 5)] = PROTECT.WETLAND

    expect(cellCost(grid, at(6, 5), DEFAULT_WEIGHTS))
      .toBeLessThan(cellCost(grid, at(5, 5), DEFAULT_WEIGHTS))
  })

  it('compounds when a cell is both, which a river through a swamp is', () => {
    const grid = emptyGrid()
    grid.protection[at(5, 5)] = PROTECT.WATER
    grid.protection[at(6, 5)] = PROTECT.WATER | PROTECT.WETLAND

    expect(cellCost(grid, at(6, 5), DEFAULT_WEIGHTS))
      .toBeGreaterThan(cellCost(grid, at(5, 5), DEFAULT_WEIGHTS))
  })

  it('refuses parks and historic sites outright', () => {
    const grid = emptyGrid()
    grid.protection[at(5, 5)] = PROTECT.PARK
    grid.protection[at(6, 5)] = PROTECT.HISTORIC

    expect(cellCost(grid, at(5, 5), DEFAULT_WEIGHTS)).toBe(Infinity)
    expect(cellCost(grid, at(6, 5), DEFAULT_WEIGHTS)).toBe(Infinity)
    expect(PROTECT_BLOCKING & PROTECT.WATER).toBe(0)
    expect(PROTECT_BLOCKING & PROTECT.WETLAND).toBe(0)
  })

  it('detours around a lake rather than through it', () => {
    const grid = emptyGrid()
    // A lake blocking the direct line, with clear ground above and below.
    for (let col = 10; col <= 20; col++) {
      for (let row = 8; row <= 12; row++) grid.protection[at(col, row)] = PROTECT.WATER
    }

    const route = findRoute(grid, at(2, 10), at(30, 10), DEFAULT_WEIGHTS)
    expect(route).not.toBeNull()

    const through = route!.cells.filter((c) => (grid.protection[c] & PROTECT.WATER) !== 0).length
    // It goes around: a straight line would sit in water for eleven cells.
    expect(through).toBeLessThan(4)
  })

  it('crosses a river instead of following it forever', () => {
    const grid = emptyGrid()
    // A river spanning the full height of the grid: there is no way around, so
    // the only sane route crosses it, and crosses it once.
    for (let row = 0; row < ROWS; row++) grid.protection[at(15, row)] = PROTECT.WATER

    const route = findRoute(grid, at(2, 10), at(30, 10), DEFAULT_WEIGHTS)
    expect(route).not.toBeNull()

    const crossed = route!.cells.filter((c) => (grid.protection[c] & PROTECT.WATER) !== 0).length
    expect(crossed).toBeGreaterThan(0)
    // A perpendicular crossing touches the channel once or twice, not ten times.
    expect(crossed).toBeLessThanOrEqual(2)
  })

  it('still refuses when a park genuinely walls the route off', () => {
    const grid = emptyGrid()
    for (let row = 0; row < ROWS; row++) grid.protection[at(15, row)] = PROTECT.PARK
    expect(findRoute(grid, at(2, 10), at(30, 10), DEFAULT_WEIGHTS)).toBeNull()
  })
})
