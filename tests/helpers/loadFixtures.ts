/**
 * Loads the real vendored map data from disk for engine tests.
 *
 * Tests run against the actual Georgia data rather than a toy fixture, so a
 * broken data build fails the unit suite too — and siting assertions are about
 * real counties in real places.
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CountiesFile, HexGrid, HexGridManifest } from '../../src/engine/geo/mapTypes.ts'
import { project } from '../../src/engine/geo/projection.ts'
import { pointToCell } from '../../src/engine/geo/hex.ts'

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/data')

let cached: { counties: CountiesFile; grid: HexGrid } | null = null

export function fixtures(): { counties: CountiesFile; grid: HexGrid } {
  if (cached) return cached

  const counties = JSON.parse(readFileSync(resolve(DATA, 'counties.json'), 'utf8')) as CountiesFile
  const manifest = JSON.parse(readFileSync(resolve(DATA, 'hexgrid.json'), 'utf8')) as HexGridManifest
  const bin = readFileSync(resolve(DATA, 'hexgrid.bin'))
  // Copy into a standalone ArrayBuffer; Node may hand back a pooled view.
  const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer

  const layer = (name: string) => {
    const m = manifest.layers.find((l) => l.name === name)!
    return m.type === 'Uint16'
      ? new Uint16Array(buf, m.offset, m.byteLength / 2)
      : new Uint8Array(buf, m.offset, m.byteLength)
  }

  const grid: HexGrid = {
    manifest,
    spec: manifest.spec,
    county: layer('county') as Uint8Array,
    terrain: layer('terrain') as Uint8Array,
    population: layer('population') as Uint8Array,
    landValue: layer('landValue') as Uint16Array,
    protection: layer('protection') as Uint8Array,
  }

  cached = { counties, grid }
  return cached
}

/**
 * Grid cell index for a longitude/latitude, or -1 if the point falls off the
 * grid. The bounds check matters: without it an out-of-range column silently
 * wraps into the next row and returns a cell somewhere else entirely.
 */
export function cellAtLonLat(lon: number, lat: number): number {
  const { grid } = fixtures()
  const [x, y] = project(lon, lat)
  const [col, row] = pointToCell(grid.spec, x, y)
  if (col < 0 || row < 0 || col >= grid.spec.cols || row >= grid.spec.rows) return -1
  return row * grid.spec.cols + col
}
