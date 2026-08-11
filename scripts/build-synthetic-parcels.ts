/**
 * build-synthetic-parcels.ts — a stand-in cadastre.
 *
 * WHY THIS EXISTS: the eminent-domain mechanic is built to run on real surveyed
 * parcel boundaries fetched by scripts/fetch-parcels.ts. That fetch needs egress
 * to county ArcGIS/qPublic servers, which the sandbox this was developed in
 * blocks. Rather than leave the central mechanic unbuilt and untested, this
 * generates a cadastre with the SAME SCHEMA and realistic structure, flagged
 * `synthetic: true` so the game can tell the player it is a stand-in.
 *
 * When real parcels are fetched for a county, they overwrite this file and every
 * downstream system — routing, takings, severance, negotiation, condemnation —
 * keeps working unchanged, because none of it knows or cares where the geometry
 * came from.
 *
 * The structure is not arbitrary. Georgia was surveyed into square land lots,
 * so rural parcels here really are largely rectangular and axis-aligned, and
 * they subdivide into smaller lots as you approach a town. Recursive splitting
 * with a density-driven stopping rule reproduces that pattern closely enough to
 * make routing decisions meaningful.
 *
 * Run: npm run build:parcels
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Rng, deriveSeed } from '../src/engine/rng.ts'
import {
  intersect, polyArea, km2ToAcres, centroid, type Poly, type MultiPoly,
} from '../src/engine/geo/polygon.ts'
import { HEX_WIDTH_KM, HEX_ROW_KM } from '../src/engine/geo/hex.ts'
import type { CountiesFile, HexGridManifest } from '../src/engine/geo/mapTypes.ts'
import type { ParcelWire, ParcelFile } from '../src/engine/parcels/types.ts'
import { classifyParcel } from './lib/parcelIdentity.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Counties to generate. Sumter is the Americus scenario's playfield. */
const TARGET_COUNTIES = ['13261']

/**
 * Typical parcel size by how built-up the ground is. Rural southwest Georgia
 * runs to large planted-pine and row-crop tracts; in town it is house lots.
 */
function targetAcres(density: number, rng: Rng): number {
  if (density < 0.04) return rng.range(90, 260)  // open country
  if (density < 0.12) return rng.range(35, 110)  // scattered farms
  if (density < 0.30) return rng.range(6, 40)    // rural fringe
  if (density < 0.55) return rng.range(1.2, 8)   // edge of town
  return rng.range(0.25, 2)                      // in town
}

type Rect = { x0: number; y0: number; x1: number; y1: number }

function rectToPoly(r: Rect): Poly {
  return [[
    [r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1], [r.x0, r.y0],
  ]]
}

function rectAcres(r: Rect): number {
  return km2ToAcres((r.x1 - r.x0) * (r.y1 - r.y0))
}

interface Grid {
  manifest: HexGridManifest
  population: Uint8Array
  landValue: Uint16Array
  county: Uint8Array
}

function loadGrid(): Grid {
  const manifest = JSON.parse(
    readFileSync(resolve(ROOT, 'public/data/hexgrid.json'), 'utf8'),
  ) as HexGridManifest
  const bin = readFileSync(resolve(ROOT, 'public/data/hexgrid.bin'))
  const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer
  const layer = (name: string) => manifest.layers.find((l) => l.name === name)!
  return {
    manifest,
    population: new Uint8Array(buf, layer('population').offset, layer('population').byteLength),
    landValue: new Uint16Array(buf, layer('landValue').offset, layer('landValue').byteLength / 2),
    county: new Uint8Array(buf, layer('county').offset, layer('county').byteLength),
  }
}

/** Sample the hex layers at a world point. */
function sampleAt(grid: Grid, x: number, y: number): { density: number; landValue: number } {
  const spec = grid.manifest.spec
  const row = Math.round((y - spec.originY) / HEX_ROW_KM)
  if (row < 0 || row >= spec.rows) return { density: 0, landValue: 2600 }
  const col = Math.round((x - spec.originX) / HEX_WIDTH_KM - 0.5 * (row & 1))
  if (col < 0 || col >= spec.cols) return { density: 0, landValue: 2600 }
  const idx = row * spec.cols + col
  return { density: grid.population[idx] / 255, landValue: grid.landValue[idx] || 2600 }
}

/**
 * Mean density across a rectangle rather than at its centre.
 *
 * Sampling the centroid makes a whole square-mile block inherit whatever is
 * under its midpoint: one block whose centre lands on the edge of Americus gets
 * subdivided into house lots across all 640 acres of it, most of which is
 * farmland. Averaging over the rectangle keeps the town/country boundary where
 * it actually is.
 */
function meanDensity(grid: Grid, r: Rect): number {
  let sum = 0
  let n = 0
  for (const fx of [0.15, 0.5, 0.85]) {
    for (const fy of [0.15, 0.5, 0.85]) {
      sum += sampleAt(grid, r.x0 + (r.x1 - r.x0) * fx, r.y0 + (r.y1 - r.y0) * fy).density
      n++
    }
  }
  return sum / n
}

/**
 * Split a rectangle down until each piece is about the right size for where it
 * sits. Splitting the longer side keeps parcels from degenerating into slivers;
 * jittering the split point keeps the result from looking like graph paper.
 */
function subdivide(rect: Rect, grid: Grid, rng: Rng, out: Rect[], depth = 0): void {
  const target = targetAcres(meanDensity(grid, rect), rng)

  if (rectAcres(rect) <= target || depth > 12) {
    out.push(rect)
    return
  }

  const w = rect.x1 - rect.x0
  const h = rect.y1 - rect.y0
  const t = rng.range(0.38, 0.62)

  if (w >= h) {
    const xm = rect.x0 + w * t
    subdivide({ ...rect, x1: xm }, grid, rng, out, depth + 1)
    subdivide({ ...rect, x0: xm }, grid, rng, out, depth + 1)
  } else {
    const ym = rect.y0 + h * t
    subdivide({ ...rect, y1: ym }, grid, rng, out, depth + 1)
    subdivide({ ...rect, y0: ym }, grid, rng, out, depth + 1)
  }
}

function main(): void {
  const counties = JSON.parse(
    readFileSync(resolve(ROOT, 'public/data/counties.json'), 'utf8'),
  ) as CountiesFile
  const grid = loadGrid()

  for (const fips of TARGET_COUNTIES) {
    const county = counties.counties.find((c) => c.fips === fips)
    if (!county) throw new Error(`county ${fips} not found`)

    const rng = new Rng(deriveSeed(0x5eed1a, fips))

    // County outline as a clip polygon.
    const clip: MultiPoly = county.polygons.map((poly) =>
      poly.map((ring) => {
        const pts: Array<[number, number]> = []
        for (let i = 0; i < ring.length; i += 2) pts.push([ring[i], ring[i + 1]])
        if (pts.length > 0) pts.push([...pts[0]])
        return pts
      }),
    )

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const poly of county.polygons) {
      for (let i = 0; i < poly[0].length; i += 2) {
        minX = Math.min(minX, poly[0][i]); maxX = Math.max(maxX, poly[0][i])
        minY = Math.min(minY, poly[0][i + 1]); maxY = Math.max(maxY, poly[0][i + 1])
      }
    }

    // Start from roughly one-square-mile blocks, echoing the original survey.
    const BLOCK_KM = 1.609
    const rects: Rect[] = []
    for (let x = minX; x < maxX; x += BLOCK_KM) {
      for (let y = minY; y < maxY; y += BLOCK_KM) {
        subdivide(
          { x0: x, y0: y, x1: Math.min(x + BLOCK_KM, maxX), y1: Math.min(y + BLOCK_KM, maxY) },
          grid, rng, rects,
        )
      }
    }

    const parcels: ParcelWire[] = []
    for (const rect of rects) {
      // Clip to the county so the cadastre stops at the county line.
      const clipped = intersect([rectToPoly(rect)], clip)
      for (const poly of clipped) {
        if (km2ToAcres(polyArea(poly)) < 0.1) continue

        // Flat rings rounded to 10 m, with the duplicate closing point dropped —
        // the loader closes rings on the way back in.
        const rings: number[][] = poly.map((ring) => {
          const flat: number[] = []
          const n = ring.length > 1
            && ring[0][0] === ring[ring.length - 1][0]
            && ring[0][1] === ring[ring.length - 1][1]
            ? ring.length - 1
            : ring.length
          for (let i = 0; i < n; i++) {
            flat.push(Math.round(ring[i][0] * 100) / 100, Math.round(ring[i][1] * 100) / 100)
          }
          return flat
        })

        // Acreage is measured from the ROUNDED geometry, not the pre-rounded
        // shape, so the stored acres and the stored polygon agree. Compensation
        // is computed from acreage, and a file that disagrees with itself would
        // quietly misprice every taking.
        const roundedPoly: Poly = rings.map((flat) => {
          const ring: Array<[number, number]> = []
          for (let i = 0; i < flat.length; i += 2) ring.push([flat[i], flat[i + 1]])
          if (ring.length > 0) ring.push([...ring[0]])
          return ring
        })
        const acres = km2ToAcres(polyArea(roundedPoly))
        if (acres < 0.1) continue

        const [cx, cy] = centroid(roundedPoly)
        const { density, landValue } = sampleAt(grid, cx, cy)
        const archetype = classifyParcel({ acres, landUse: null, rng })

        parcels.push({
          id: `${fips}-${parcels.length + 1}`,
          rings,
          acres: Math.round(acres * 10) / 10,
          archetype,
          // Small lots carry more value per acre than open farmland, and the
          // hex land-value layer already encodes most of that gradient.
          assessedPerAcre: Math.round(
            landValue * (acres < 5 ? rng.range(1.6, 2.6) : rng.range(0.85, 1.2)) * (1 + density),
          ),
        })
      }
    }

    const file: ParcelFile = {
      version: 1,
      countyFips: fips,
      countyName: county.name,
      source: 'Procedurally generated stand-in (scripts/build-synthetic-parcels.ts)',
      sourceUrl: null,
      generatedAt: '2026-01-01',
      synthetic: true,
      note:
        'NOT REAL PARCEL DATA. Boundaries, acreages, values and owners here are ' +
        'generated. Structure mimics Georgia\'s square land-lot survey and its ' +
        'subdivision pattern near towns, so routing decisions behave realistically, ' +
        'but nothing here reflects who actually owns anything. Replace by running ' +
        'scripts/fetch-parcels.ts from a network that can reach county GIS servers.',
      parcels,
    }

    const dir = resolve(ROOT, 'public/data/parcels')
    mkdirSync(dir, { recursive: true })
    const path = resolve(dir, `${fips}.json`)
    const json = JSON.stringify(file)
    writeFileSync(path, json)

    const totalAcres = parcels.reduce((s, p) => s + p.acres, 0)
    const byType = parcels.reduce<Record<string, number>>((m, p) => {
      m[p.archetype] = (m[p.archetype] ?? 0) + 1
      return m
    }, {})
    console.log(`${county.name} County (${fips})`)
    console.log(`  parcels:  ${parcels.length.toLocaleString()}`)
    console.log(`  acreage:  ${Math.round(totalAcres).toLocaleString()} acres ` +
      `(median ${Math.round(parcels.map((p) => p.acres).sort((a, b) => a - b)[parcels.length >> 1])} ac)`)
    console.log(`  mix:      ${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(', ')}`)
    console.log(`  wrote:    ${path} (${(json.length / 1024).toFixed(0)} KiB)`)
  }
}

main()
