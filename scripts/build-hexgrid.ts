/**
 * build-hexgrid.ts — the routing cost surface.
 *
 * Rasterises Georgia into ~1 km² hex cells and bakes one byte-per-cell attribute
 * layer per thing the router cares about. Output is a flat binary blob plus a
 * JSON manifest, both vendored into public/data/ and loaded once at startup.
 *
 *   county     Uint8   index into the manifest's county list; 255 = outside Georgia
 *   terrain    Uint8   physiographic province (see TERRAIN)
 *   population Uint8   log-scaled population density bucket
 *   landValue  Uint16  approximate $/acre, drives right-of-way cost
 *   protection Uint8   bitflags for parks, wetlands, historic sites
 *
 * DATA STATUS: `county` and `terrain` are derived from real geography — Census
 * county boundaries and Georgia's actual physiographic provinces, including the
 * real Fall Line trace through Columbus–Macon–Augusta. `population` and
 * `landValue` are modelled from the (still unverified) city list in
 * src/data/cities.ts. `protection` is ALL ZERO: parks, wetlands and historic-site
 * data needs a source we could not reach, and filling it is an M6 task.
 *
 * Run: npm run build:hexgrid
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { project } from '../src/engine/geo/projection.ts'
import {
  HEX_WIDTH_KM, HEX_ROW_KM, HEX_AREA_KM2, HEX_SIZE_KM,
  cellCenter, type GridSpec,
} from '../src/engine/geo/hex.ts'
import { CITIES } from '../src/data/cities.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

/** Physiographic provinces of Georgia. */
export const TERRAIN = {
  OUTSIDE: 0,
  COASTAL_PLAIN: 1,
  PIEDMONT: 2,
  BLUE_RIDGE: 3,
  VALLEY_AND_RIDGE: 4,
  APPALACHIAN_PLATEAU: 5,
  COASTAL_MARSH: 6,
} as const

/**
 * Counties lying in Georgia's mountain provinces. The Piedmont/Coastal Plain
 * split is handled separately by the Fall Line, because that boundary cuts
 * through counties rather than following them.
 */
const BLUE_RIDGE_COUNTIES = new Set([
  '13111', '13291', '13281', '13241', '13123', '13187',
  '13311', '13137', '13085', '13227', '13213', '13257',
])
const VALLEY_AND_RIDGE_COUNTIES = new Set([
  '13295', '13047', '13313', '13055', '13129', '13115', '13015',
])
const APPALACHIAN_PLATEAU_COUNTIES = new Set(['13083'])
const COASTAL_COUNTIES = new Set(['13051', '13029', '13179', '13191', '13127', '13039'])

/**
 * The Fall Line: the real geological boundary where the hard rock of the
 * Piedmont meets the sediments of the Coastal Plain. It runs through Columbus,
 * Macon and Augusta — which is exactly why those cities are there, since it is
 * the head of navigation on each river. South of it, the land is flat, sandy and
 * cheap to build across; north of it, rolling and rockier.
 */
const FALL_LINE_LONLAT: ReadonlyArray<readonly [number, number]> = [
  [-84.988, 32.461], // Columbus
  [-83.632, 32.841], // Macon
  [-82.010, 33.471], // Augusta
]

interface CountyRec {
  fips: string
  name: string
  polygons: number[][][]
  centroid: [number, number]
  areaKm2: number
}

/** Even-odd point-in-ring test on a flat coordinate array. */
function pointInRing(x: number, y: number, ring: number[]): boolean {
  let inside = false
  const n = ring.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2]
    const yi = ring[i * 2 + 1]
    const xj = ring[j * 2]
    const yj = ring[j * 2 + 1]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/** Inside the polygon's exterior ring and not inside any of its holes. */
function pointInPolygon(x: number, y: number, rings: number[][]): boolean {
  if (rings.length === 0 || !pointInRing(x, y, rings[0])) return false
  for (let h = 1; h < rings.length; h++) {
    if (pointInRing(x, y, rings[h])) return false
  }
  return true
}

function ringBBox(rings: number[][]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const r = rings[0]
  for (let i = 0; i < r.length; i += 2) {
    if (r[i] < minX) minX = r[i]
    if (r[i] > maxX) maxX = r[i]
    if (r[i + 1] < minY) minY = r[i + 1]
    if (r[i + 1] > maxY) maxY = r[i + 1]
  }
  return [minX, minY, maxX, maxY]
}

/** Projected y of the Fall Line at a given projected x, extrapolating past the ends. */
function makeFallLine(): (x: number) => number {
  const pts = FALL_LINE_LONLAT.map(([lon, lat]) => project(lon, lat))
  return (x: number): number => {
    // Find the bracketing segment, or use an end segment to extrapolate.
    let i = 0
    for (; i < pts.length - 2; i++) {
      if (x < pts[i + 1][0]) break
    }
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[i + 1]
    const t = (x - x0) / (x1 - x0)
    return y0 + t * (y1 - y0)
  }
}

function main(): void {
  const countiesPath = resolve(ROOT, 'public/data/counties.json')
  const geo = JSON.parse(readFileSync(countiesPath, 'utf8')) as {
    bbox: [number, number, number, number]
    counties: CountyRec[]
  }

  const [minX, minY, maxX, maxY] = geo.bbox
  // One cell of padding so edge geometry is never clipped by the grid boundary.
  const spec: GridSpec = {
    originX: minX - HEX_WIDTH_KM,
    originY: minY - HEX_ROW_KM,
    cols: Math.ceil((maxX - minX) / HEX_WIDTH_KM) + 2,
    rows: Math.ceil((maxY - minY) / HEX_ROW_KM) + 2,
  }
  const total = spec.cols * spec.rows

  const county = new Uint8Array(total).fill(255)
  const terrain = new Uint8Array(total)
  const population = new Uint8Array(total)
  const landValue = new Uint16Array(total)
  const protection = new Uint8Array(total)

  // --- county assignment -------------------------------------------------
  // Only cells inside a county's bounding box are tested, which keeps this
  // to a few million point-in-polygon checks rather than 159 × every cell.
  const counties = geo.counties
  for (let ci = 0; ci < counties.length; ci++) {
    for (const rings of counties[ci].polygons) {
      const [bx0, by0, bx1, by1] = ringBBox(rings)
      const rowStart = Math.max(0, Math.floor((by0 - spec.originY) / HEX_ROW_KM) - 1)
      const rowEnd = Math.min(spec.rows - 1, Math.ceil((by1 - spec.originY) / HEX_ROW_KM) + 1)
      const colStart = Math.max(0, Math.floor((bx0 - spec.originX) / HEX_WIDTH_KM) - 2)
      const colEnd = Math.min(spec.cols - 1, Math.ceil((bx1 - spec.originX) / HEX_WIDTH_KM) + 1)

      for (let row = rowStart; row <= rowEnd; row++) {
        for (let col = colStart; col <= colEnd; col++) {
          const idx = row * spec.cols + col
          if (county[idx] !== 255) continue
          const [cx, cy] = cellCenter(spec, col, row)
          if (pointInPolygon(cx, cy, rings)) county[idx] = ci
        }
      }
    }
  }

  // --- terrain -----------------------------------------------------------
  // The tidal marsh band follows the coastline rather than a line of longitude:
  // for each grid row, find how far east Georgia reaches, and treat cells within
  // MARSH_DEPTH_KM of that as marsh. Georgia's coast angles south-west, so a
  // longitude cutoff would slice straight across it and look obviously wrong.
  const MARSH_DEPTH_KM = 14
  const rowMaxX = new Float64Array(spec.rows).fill(-Infinity)
  for (let row = 0; row < spec.rows; row++) {
    for (let col = spec.cols - 1; col >= 0; col--) {
      if (county[row * spec.cols + col] !== 255) {
        rowMaxX[row] = cellCenter(spec, col, row)[0]
        break
      }
    }
  }

  const fallLineY = makeFallLine()
  let inState = 0
  for (let row = 0; row < spec.rows; row++) {
    for (let col = 0; col < spec.cols; col++) {
      const idx = row * spec.cols + col
      const ci = county[idx]
      if (ci === 255) continue
      inState++

      const fips = counties[ci].fips
      const [cx, cy] = cellCenter(spec, col, row)

      if (APPALACHIAN_PLATEAU_COUNTIES.has(fips)) {
        terrain[idx] = TERRAIN.APPALACHIAN_PLATEAU
      } else if (BLUE_RIDGE_COUNTIES.has(fips)) {
        terrain[idx] = TERRAIN.BLUE_RIDGE
      } else if (VALLEY_AND_RIDGE_COUNTIES.has(fips)) {
        terrain[idx] = TERRAIN.VALLEY_AND_RIDGE
      } else if (COASTAL_COUNTIES.has(fips) && cx > rowMaxX[row] - MARSH_DEPTH_KM) {
        terrain[idx] = TERRAIN.COASTAL_MARSH
      } else {
        terrain[idx] = cy < fallLineY(cx) ? TERRAIN.COASTAL_PLAIN : TERRAIN.PIEDMONT
      }
    }
  }

  // --- population density ------------------------------------------------
  // Each city contributes an exponentially decaying field; bigger places reach
  // further, which approximates a metro's suburban falloff well enough to make
  // routing avoid populated ground.
  const cityPts = CITIES.map((c) => {
    const [x, y] = project(c.lon, c.lat)
    return { x, y, pop: c.population, decay: 2.5 + 5.5 * Math.log10(Math.max(c.population, 100)) }
  })

  const raw = new Float32Array(total)
  let maxRaw = 0
  for (let row = 0; row < spec.rows; row++) {
    for (let col = 0; col < spec.cols; col++) {
      const idx = row * spec.cols + col
      if (county[idx] === 255) continue
      const [cx, cy] = cellCenter(spec, col, row)
      let acc = 0
      for (const c of cityPts) {
        const d = Math.hypot(cx - c.x, cy - c.y)
        if (d > c.decay * 4) continue
        acc += (c.pop / (HEX_AREA_KM2 * 1000)) * Math.exp(-d / c.decay)
      }
      raw[idx] = acc
      if (acc > maxRaw) maxRaw = acc
    }
  }
  // Log scale: the useful signal is "is anyone here at all", not Atlanta's peak.
  const logMax = Math.log1p(maxRaw)
  for (let i = 0; i < total; i++) {
    if (county[i] === 255) continue
    population[i] = Math.min(255, Math.round((Math.log1p(raw[i]) / logMax) * 255))
  }

  // --- land value --------------------------------------------------------
  // Rough $/acre. Rural southwest Georgia farmland sits in the low thousands;
  // metro-fringe land runs an order of magnitude higher. Terrain nudges it:
  // mountains are cheap but expensive to build across, marsh is near-unbuildable.
  const TERRAIN_LAND_FACTOR: Record<number, number> = {
    [TERRAIN.COASTAL_PLAIN]: 1.0,
    [TERRAIN.PIEDMONT]: 1.35,
    [TERRAIN.BLUE_RIDGE]: 1.1,
    [TERRAIN.VALLEY_AND_RIDGE]: 1.0,
    [TERRAIN.APPALACHIAN_PLATEAU]: 0.8,
    [TERRAIN.COASTAL_MARSH]: 0.6,
  }
  for (let i = 0; i < total; i++) {
    if (county[i] === 255) continue
    const popNorm = population[i] / 255
    const base = 2_600 + 48_000 * popNorm ** 2.2
    landValue[i] = Math.min(65_535, Math.round(base * (TERRAIN_LAND_FACTOR[terrain[i]] ?? 1)))
  }

  // --- pack --------------------------------------------------------------
  const layers = [
    { name: 'county', type: 'Uint8', array: county as unknown as ArrayBufferView },
    { name: 'terrain', type: 'Uint8', array: terrain as unknown as ArrayBufferView },
    { name: 'population', type: 'Uint8', array: population as unknown as ArrayBufferView },
    { name: 'landValue', type: 'Uint16', array: landValue as unknown as ArrayBufferView },
    { name: 'protection', type: 'Uint8', array: protection as unknown as ArrayBufferView },
  ]

  let offset = 0
  const meta = layers.map((l) => {
    const rec = { name: l.name, type: l.type, offset, byteLength: l.array.byteLength }
    offset += l.array.byteLength
    return rec
  })

  const blob = new Uint8Array(offset)
  for (let i = 0; i < layers.length; i++) {
    const a = layers[i].array
    blob.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), meta[i].offset)
  }

  const dir = resolve(ROOT, 'public/data')
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, 'hexgrid.bin'), blob)
  writeFileSync(
    resolve(dir, 'hexgrid.json'),
    JSON.stringify({
      version: 1,
      generatedBy: 'scripts/build-hexgrid.ts',
      hexSizeKm: HEX_SIZE_KM,
      hexAreaKm2: Math.round(HEX_AREA_KM2 * 1e4) / 1e4,
      spec,
      cellCount: total,
      inStateCells: inState,
      layers: meta,
      counties: counties.map((c) => ({ fips: c.fips, name: c.name })),
      terrainEnum: TERRAIN,
      dataGaps: ['protection layer is all zero — parks/wetlands/historic sites pending M6'],
    }),
  )

  console.log(`grid:     ${spec.cols} x ${spec.rows} = ${total.toLocaleString()} cells`)
  console.log(`in-state: ${inState.toLocaleString()} cells (~${Math.round(inState * HEX_AREA_KM2).toLocaleString()} km²)`)
  console.log(`binary:   ${(blob.byteLength / 1024).toFixed(0)} KiB across ${layers.length} layers`)
}

main()
