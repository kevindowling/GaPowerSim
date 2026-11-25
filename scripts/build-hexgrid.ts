import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { project } from '../src/engine/geo/projection.ts'
import {
  HEX_WIDTH_KM, HEX_ROW_KM, HEX_AREA_KM2, HEX_SIZE_KM,
  cellCenter, pointToCell, type GridSpec,
} from '../src/engine/geo/hex.ts'
import { PROTECT } from '../src/engine/geo/mapTypes.ts'
import type { GisFile } from '../src/engine/geo/basemapTypes.ts'
import type { HydrologyFile } from '../src/engine/geo/basemapTypes.ts'
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

const BLUE_RIDGE_COUNTIES = new Set([
  '13111', '13291', '13281', '13241', '13123', '13187',
  '13311', '13137', '13085', '13227', '13213', '13257',
])
const VALLEY_AND_RIDGE_COUNTIES = new Set([
  '13295', '13047', '13313', '13055', '13129', '13115', '13015',
])
const APPALACHIAN_PLATEAU_COUNTIES = new Set(['13083'])
const COASTAL_COUNTIES = new Set(['13051', '13029', '13179', '13191', '13127', '13039'])

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

/** Share of a cell that has to be water before it counts as open water. */
const WATER_SHARE = 0.35
const WETLAND_SHARE = 0.5
const PARK_SHARE = 0.3
const SAMPLE_KM = 0.2

/** Burn vendored water and parks into the protection layer. */
function rasterizeProtection(
  spec: GridSpec, county: Uint8Array, protection: Uint8Array,
): { waterCells: number; wetlandCells: number; parkCells: number; gaps: string[]; note: string } {
  const cellAt = (x: number, y: number): number => {
    const [col, row] = pointToCell(spec, x, y)
    if (col < 0 || col >= spec.cols || row < 0 || row >= spec.rows) return -1
    const cell = row * spec.cols + col
    return county[cell] === 255 ? -1 : cell
  }

  const fill = (area: Float32Array, lonlat: [number, number][]): void => {
    const ring = lonlat.map(([lon, lat]) => project(lon, lat))
    const flat = ring.flat()
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const [x, y] of ring) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x)
      minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    }
    const x0 = Math.floor(minX / SAMPLE_KM) * SAMPLE_KM
    const y0 = Math.floor(minY / SAMPLE_KM) * SAMPLE_KM
    for (let y = y0; y <= maxY; y += SAMPLE_KM) {
      for (let x = x0; x <= maxX; x += SAMPLE_KM) {
        if (!pointInRing(x, y, flat)) continue
        const c = cellAt(x, y)
        if (c >= 0) area[c] += SAMPLE_KM * SAMPLE_KM
      }
    }
  }

  const water = new Float32Array(protection.length)
  const wetland = new Float32Array(protection.length)
  const park = new Float32Array(protection.length)
  const dir = resolve(ROOT, 'public/data/hydrology')
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : []

  for (const f of files) {
    const file = JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as HydrologyFile
    for (const way of file.waterways) {
      if (way.k !== 'river') continue
      for (let i = 1; i < way.p.length; i++) {
        const [ax, ay] = project(way.p[i - 1][0], way.p[i - 1][1])
        const [bx, by] = project(way.p[i][0], way.p[i][1])
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (HEX_SIZE_KM / 2)))
        for (let s = 0; s <= steps; s++) {
          const c = cellAt(ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps)
          if (c >= 0) protection[c] |= PROTECT.RIVER
        }
      }
    }
    // Lakes are in both the state and county files; only count them once.
    for (const body of file.bodies) {
      if (body.k === 'wetland') fill(wetland, body.p)
      else if (f === 'state.json') fill(water, body.p)
    }
  }

  const gisPath = resolve(ROOT, 'public/data/gis/state.json')
  const hasGis = existsSync(gisPath)
  if (hasGis) {
    const gis = JSON.parse(readFileSync(gisPath, 'utf8')) as GisFile
    for (const p of gis.parks) fill(park, p.p)
  }

  let waterCells = 0, wetlandCells = 0, parkCells = 0
  for (let i = 0; i < protection.length; i++) {
    if (water[i] >= WATER_SHARE) { protection[i] |= PROTECT.WATER; waterCells++ }
    if (wetland[i] >= WETLAND_SHARE) { protection[i] |= PROTECT.WETLAND; wetlandCells++ }
    if (park[i] >= PARK_SHARE) { protection[i] |= PROTECT.PARK; parkCells++ }
  }

  const gaps: string[] = []
  if (!files.includes('state.json')) gaps.push('hydrology: statewide rivers and lakes missing (npm run build:gis)')
  if (!hasGis) gaps.push('parks: statewide protected areas missing (npm run build:gis)')
  return { waterCells, wetlandCells, parkCells, gaps, note: files.join(', ') || 'none' }
}

function main(): void {
  const countiesPath = resolve(ROOT, 'public/data/counties.json')
  const geo = JSON.parse(readFileSync(countiesPath, 'utf8')) as {
    bbox: [number, number, number, number]
    counties: CountyRec[]
  }

  const [minX, minY, maxX, maxY] = geo.bbox
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

  const TYPICAL_URBAN_DENSITY = 900 // people/km² inside a place's own footprint
  const cityPts = CITIES.map((c) => {
    const [x, y] = project(c.lon, c.lat)
    const radius = Math.max(1.5, Math.sqrt(c.population / (Math.PI * TYPICAL_URBAN_DENSITY)))
    return {
      x, y, radius,
      // ∫ A·e^(−d/r) dA = A·2πr², so this amplitude conserves total population.
      amplitude: c.population / (2 * Math.PI * radius * radius),
    }
  })

  const density = new Float32Array(total) // people per km²
  for (let row = 0; row < spec.rows; row++) {
    for (let col = 0; col < spec.cols; col++) {
      const idx = row * spec.cols + col
      if (county[idx] === 255) continue
      const [cx, cy] = cellCenter(spec, col, row)
      let acc = 0
      for (const c of cityPts) {
        const d = Math.hypot(cx - c.x, cy - c.y)
        if (d > c.radius * 6) continue
        acc += c.amplitude * Math.exp(-d / c.radius)
      }
      density[idx] = acc
    }
  }

  const HALF_SATURATION = 120 // people/km² that maps to the middle of the range
  for (let i = 0; i < total; i++) {
    if (county[i] === 255) continue
    const d = density[i]
    population[i] = Math.round((d / (d + HALF_SATURATION)) * 255)
  }

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

  const hydro = rasterizeProtection(spec, county, protection)

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
      dataGaps: hydro.gaps,
    }),
  )

  console.log(`water:    ${hydro.waterCells.toLocaleString()} cells, ` +
    `${hydro.wetlandCells.toLocaleString()} wetland, ${hydro.parkCells.toLocaleString()} park (${hydro.note})`)
  console.log(`grid:     ${spec.cols} x ${spec.rows} = ${total.toLocaleString()} cells`)
  console.log(`in-state: ${inState.toLocaleString()} cells (~${Math.round(inState * HEX_AREA_KM2).toLocaleString()} km²)`)
  console.log(`binary:   ${(blob.byteLength / 1024).toFixed(0)} KiB across ${layers.length} layers`)
}

main()
