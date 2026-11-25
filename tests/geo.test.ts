import { describe, it, expect } from 'vitest'
import { project, unproject } from '../src/engine/geo/projection.ts'
import { simplifyFlat, ringArea } from '../src/engine/geo/simplify.ts'
import {
  HEX_AREA_KM2, HEX_SIZE_KM, cellCenter, pointToCell, cellDistance,
  offsetToAxial, axialToOffset, neighbors, type GridSpec,
} from '../src/engine/geo/hex.ts'

const SPEC: GridSpec = { originX: -200, originY: -240, cols: 414, rows: 556 }

describe('projection', () => {
  it('round-trips lon/lat through projected km', () => {
    // Points spanning Georgia's corners plus the Americus scenario area.
    const points: Array<[number, number]> = [
      [-85.6, 34.98], // north-west corner
      [-80.84, 32.03], // Savannah coast
      [-84.99, 30.36], // south-west corner
      [-84.233, 32.072], // Americus
      [-83.5, 32.5], // projection origin
    ]
    for (const [lon, lat] of points) {
      const [x, y] = project(lon, lat)
      const [lon2, lat2] = unproject(x, y)
      expect(lon2).toBeCloseTo(lon, 6)
      expect(lat2).toBeCloseTo(lat, 6)
    }
  })

  it('puts the origin at the origin', () => {
    const [x, y] = project(-83.5, 32.5)
    expect(x).toBeCloseTo(0, 6)
    expect(y).toBeCloseTo(0, 6)
  })

  it('orients +x east and +y north', () => {
    const [xEast] = project(-82.5, 32.5)
    const [xWest] = project(-84.5, 32.5)
    expect(xEast).toBeGreaterThan(xWest)

    const [, yNorth] = project(-83.5, 33.5)
    const [, ySouth] = project(-83.5, 31.5)
    expect(yNorth).toBeGreaterThan(ySouth)
  })

  it('preserves true area, which is what parcel acreage depends on', () => {
    const R = 6371.0088
    const DEG = Math.PI / 180
    const STEP = 0.05 // densify edges so straight segments approximate the curve

    /** Area of a lon/lat box as projected, in km². */
    const projectedArea = (lon0: number, lat0: number, lon1: number, lat1: number): number => {
      const ring: number[] = []
      const push = (lon: number, lat: number) => {
        const [x, y] = project(lon, lat)
        ring.push(x, y)
      }
      for (let lon = lon0; lon < lon1; lon += STEP) push(lon, lat0)
      for (let lat = lat0; lat < lat1; lat += STEP) push(lon1, lat)
      for (let lon = lon1; lon > lon0; lon -= STEP) push(lon, lat1)
      for (let lat = lat1; lat > lat0; lat -= STEP) push(lon0, lat)
      return Math.abs(ringArea(ring))
    }

    /** Exact area of the same box on a sphere: R²·Δλ·(sin φ₁ − sin φ₀). */
    const sphericalArea = (lon0: number, lat0: number, lon1: number, lat1: number): number =>
      R * R * (lon1 - lon0) * DEG * (Math.sin(lat1 * DEG) - Math.sin(lat0 * DEG))

    for (const [lon0, lat0] of [[-85, 30.5], [-83.5, 32.5], [-82, 34.5]] as const) {
      const [lon1, lat1] = [lon0 + 0.5, lat0 + 0.5]
      const projected = projectedArea(lon0, lat0, lon1, lat1)
      const truth = sphericalArea(lon0, lat0, lon1, lat1)
      expect(Math.abs(projected - truth) / truth).toBeLessThan(0.001)
    }
  })
})

describe('hex grid', () => {
  it('has cells of very nearly one square kilometre', () => {
    expect(HEX_AREA_KM2).toBeCloseTo(1, 3)
  })

  it('round-trips offset and axial coordinates', () => {
    for (let row = 0; row < 40; row++) {
      for (let col = 0; col < 40; col++) {
        const [q, r] = offsetToAxial(col, row)
        expect(axialToOffset(q, r)).toEqual([col, row])
      }
    }
  })

  it('maps a cell centre back to that cell', () => {
    for (const [col, row] of [[0, 0], [1, 1], [13, 7], [200, 301], [413, 555]] as const) {
      const [x, y] = cellCenter(SPEC, col, row)
      expect(pointToCell(SPEC, x, y)).toEqual([col, row])
    }
  })

  it('gives every interior cell six neighbours, each one step away', () => {
    const out: number[] = []
    const n = neighbors(SPEC, 100, 100, out)
    expect(n).toBe(6)
    const seen = new Set<string>()
    for (let i = 0; i < n; i++) {
      const c = out[i * 2]
      const r = out[i * 2 + 1]
      expect(cellDistance(100, 100, c, r)).toBe(1)
      seen.add(`${c},${r}`)
    }
    expect(seen.size).toBe(6)
  })

  it('clips neighbours at the grid edge', () => {
    const out: number[] = []
    expect(neighbors(SPEC, 0, 0, out)).toBeLessThan(6)
  })

  it('measures distance as a straight count of steps', () => {
    expect(cellDistance(10, 10, 10, 10)).toBe(0)
    expect(cellDistance(10, 10, 13, 10)).toBe(3)
    // Neighbouring cells are one cell apart regardless of row parity.
    expect(cellDistance(10, 10, 10, 11)).toBe(1)
    expect(cellDistance(10, 11, 10, 12)).toBe(1)
  })

  it('spaces cell centres by roughly the hex size', () => {
    const [x0, y0] = cellCenter(SPEC, 10, 10)
    const [x1, y1] = cellCenter(SPEC, 11, 10)
    expect(Math.hypot(x1 - x0, y1 - y0)).toBeCloseTo(Math.sqrt(3) * HEX_SIZE_KM, 6)
  })
})

describe('simplification', () => {
  it('drops collinear points and keeps the endpoints', () => {
    const line = [0, 0, 1, 0, 2, 0, 3, 0, 4, 0]
    expect(simplifyFlat(line, 0.01)).toEqual([0, 0, 4, 0])
  })

  it('keeps a point that deviates beyond the tolerance', () => {
    const line = [0, 0, 1, 0.5, 2, 0]
    expect(simplifyFlat(line, 0.1)).toEqual([0, 0, 1, 0.5, 2, 0])
    expect(simplifyFlat(line, 1.0)).toEqual([0, 0, 2, 0])
  })

  it('leaves degenerate input alone', () => {
    expect(simplifyFlat([0, 0], 1)).toEqual([0, 0])
    expect(simplifyFlat([], 1)).toEqual([])
  })

  it('computes signed ring area', () => {
    // A unit square, counter-clockwise.
    const square = [0, 0, 1, 0, 1, 1, 0, 1]
    expect(ringArea(square)).toBeCloseTo(1, 9)
    // Reversed winding flips the sign.
    const cw = [0, 1, 1, 1, 1, 0, 0, 0]
    expect(ringArea(cw)).toBeCloseTo(-1, 9)
  })
})
