/**
 * build-geo.ts — Georgia county geometry → projected, simplified, vendored JSON.
 *
 * Source: the `us-atlas` npm package, which is Census TIGER/cartographic boundary
 * data published as TopoJSON. We take it from npm rather than fetching census.gov
 * directly so the build is reproducible and works without network egress to
 * government hosts.
 *
 * Output: public/data/counties.json — committed to the repo. The game loads this
 * static file; it never fetches geodata at runtime.
 *
 * Run: npm run build:geo
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { feature } from 'topojson-client'
import type { FeatureCollection, Geometry } from 'geojson'
import { project } from '../src/engine/geo/projection.ts'
import { simplifyFlat, roundFlat, ringArea } from '../src/engine/geo/simplify.ts'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

/** Georgia's state FIPS code. */
const GA_FIPS = '13'

/**
 * Simplification tolerance in kilometres. 0.15 km keeps county outlines visually
 * faithful at the deepest zoom the strategic map uses while cutting the vertex
 * count by roughly an order of magnitude.
 */
const TOLERANCE_KM = 0.15

/** Coordinate decimals to keep. 2 decimals of a kilometre = 10 m precision. */
const DECIMALS = 2

type Ring = number[]
type PolygonRings = Ring[]

interface CountyOut {
  fips: string
  name: string
  polygons: PolygonRings[]
  centroid: [number, number]
  areaKm2: number
}

/** Project a GeoJSON ring (array of [lon,lat]) into a flat km array. */
function projectRing(ring: number[][]): number[] {
  const out = new Array<number>(ring.length * 2)
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = project(ring[i][0], ring[i][1])
    out[i * 2] = x
    out[i * 2 + 1] = y
  }
  return out
}

/** Normalise Polygon/MultiPolygon into a list of polygons, each a list of rings. */
function toPolygons(geom: Geometry): number[][][][] {
  if (geom.type === 'Polygon') return [geom.coordinates as number[][][]]
  if (geom.type === 'MultiPolygon') return geom.coordinates as number[][][][]
  return []
}

function processGeometry(geom: Geometry): { polygons: PolygonRings[]; areaKm2: number; centroid: [number, number] } {
  const polygons: PolygonRings[] = []
  let areaKm2 = 0
  let cxAcc = 0
  let cyAcc = 0
  let weightAcc = 0

  for (const poly of toPolygons(geom)) {
    const rings: PolygonRings = []
    for (let r = 0; r < poly.length; r++) {
      let flat = projectRing(poly[r])
      flat = simplifyFlat(flat, TOLERANCE_KM)
      // A ring that simplifies below a triangle no longer encloses anything.
      if (flat.length < 8) continue
      roundFlat(flat, DECIMALS)
      rings.push(flat)

      const a = ringArea(flat)
      // Ring 0 is the exterior; the rest are holes and subtract.
      areaKm2 += r === 0 ? Math.abs(a) : -Math.abs(a)

      if (r === 0) {
        // Area-weighted centroid across exterior rings, so a county with coastal
        // islands still reports a label point on its mainland.
        const w = Math.abs(a)
        let sx = 0
        let sy = 0
        const n = flat.length / 2
        for (let i = 0; i < n; i++) {
          sx += flat[i * 2]
          sy += flat[i * 2 + 1]
        }
        cxAcc += (sx / n) * w
        cyAcc += (sy / n) * w
        weightAcc += w
      }
    }
    if (rings.length > 0) polygons.push(rings)
  }

  const centroid: [number, number] = weightAcc > 0
    ? [Math.round((cxAcc / weightAcc) * 100) / 100, Math.round((cyAcc / weightAcc) * 100) / 100]
    : [0, 0]

  return { polygons, areaKm2: Math.round(areaKm2 * 10) / 10, centroid }
}

function main(): void {
  const topo = require('us-atlas/counties-10m.json')
  const counties = feature(topo, topo.objects.counties) as unknown as FeatureCollection

  const out: CountyOut[] = []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const f of counties.features) {
    const fips = String(f.id).padStart(5, '0')
    if (!fips.startsWith(GA_FIPS)) continue

    const { polygons, areaKm2, centroid } = processGeometry(f.geometry)
    if (polygons.length === 0) continue

    for (const poly of polygons) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length; i += 2) {
          if (ring[i] < minX) minX = ring[i]
          if (ring[i] > maxX) maxX = ring[i]
          if (ring[i + 1] < minY) minY = ring[i + 1]
          if (ring[i + 1] > maxY) maxY = ring[i + 1]
        }
      }
    }

    out.push({
      fips,
      name: String((f.properties as { name?: string } | null)?.name ?? 'Unknown'),
      polygons,
      centroid,
      areaKm2,
    })
  }

  out.sort((a, b) => a.fips.localeCompare(b.fips))

  const payload = {
    version: 1,
    source: 'us-atlas@3 (US Census Bureau cartographic boundaries, 1:10m), via npm',
    projection: 'Albers Equal Area Conic tuned for Georgia; units = kilometres, +x east, +y north',
    generatedBy: 'scripts/build-geo.ts',
    toleranceKm: TOLERANCE_KM,
    bbox: [
      Math.round(minX * 100) / 100,
      Math.round(minY * 100) / 100,
      Math.round(maxX * 100) / 100,
      Math.round(maxY * 100) / 100,
    ],
    counties: out,
  }

  const dir = resolve(ROOT, 'public/data')
  mkdirSync(dir, { recursive: true })
  const path = resolve(dir, 'counties.json')
  writeFileSync(path, JSON.stringify(payload))

  const vertices = out.reduce(
    (n, c) => n + c.polygons.reduce((m, p) => m + p.reduce((k, r) => k + r.length / 2, 0), 0),
    0,
  )
  const bytes = JSON.stringify(payload).length
  console.log(`counties: ${out.length}`)
  console.log(`vertices: ${vertices}`)
  console.log(`bbox km:  x [${payload.bbox[0]}, ${payload.bbox[2]}]  y [${payload.bbox[1]}, ${payload.bbox[3]}]`)
  console.log(`extent:   ${Math.round(maxX - minX)} km wide x ${Math.round(maxY - minY)} km tall`)
  console.log(`wrote:    ${path} (${(bytes / 1024).toFixed(0)} KiB)`)
}

main()
