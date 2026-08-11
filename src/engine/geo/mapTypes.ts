/**
 * Shapes of the vendored map data in public/data/. Pure types — the loader that
 * actually fetches them lives in src/data/loadMapData.ts, so the engine stays
 * free of I/O.
 */

import type { GridSpec } from './hex.ts'

export interface CountyGeo {
  fips: string
  name: string
  /** polygon → ring → flat [x0,y0,x1,y1,…] in projected km. Ring 0 is the exterior. */
  polygons: number[][][]
  centroid: [number, number]
  areaKm2: number
}

export interface CountiesFile {
  version: number
  source: string
  projection: string
  bbox: [number, number, number, number]
  counties: CountyGeo[]
}

export interface LayerMeta {
  name: string
  type: 'Uint8' | 'Uint16'
  offset: number
  byteLength: number
}

export interface HexGridManifest {
  version: number
  hexSizeKm: number
  hexAreaKm2: number
  spec: GridSpec
  cellCount: number
  inStateCells: number
  layers: LayerMeta[]
  counties: Array<{ fips: string; name: string }>
  terrainEnum: Record<string, number>
  dataGaps: string[]
}

/** The hex cost surface, as typed views over one loaded buffer. */
export interface HexGrid {
  manifest: HexGridManifest
  spec: GridSpec
  county: Uint8Array
  terrain: Uint8Array
  population: Uint8Array
  landValue: Uint16Array
  protection: Uint8Array
}

export interface MapData {
  counties: CountiesFile
  grid: HexGrid
}

/** Sentinel stored in the county layer for cells outside Georgia. */
export const OUTSIDE_STATE = 255


/**
 * Bitflags in the `protection` layer.
 *
 * These are graded, not binary. Routing used to treat any non-zero protection
 * as impassable, which is wrong in the direction that matters: a transmission
 * line absolutely can cross a wetland — thousands do — it just costs a Section
 * 404 permit, a longer schedule, and a construction method that is far more
 * expensive than driving poles into a field. Treating it as a wall would hide
 * the real tradeoff, which is money and time against going around.
 *
 * What genuinely blocks a route is different: a national park, a wilderness
 * area, a historic site. Those are refusals, not line items.
 */
export const PROTECT = {
  /** Open water: river channel, lake, reservoir. Crossable, at a price. */
  WATER: 1 << 0,
  /** Swamp, marsh, bog. Crossable; triggers a federal permit. */
  WETLAND: 1 << 1,
  /** State or national park, wildlife refuge, wilderness. Refused. */
  PARK: 1 << 2,
  /** Listed historic site or cemetery. Refused. */
  HISTORIC: 1 << 3,
} as const

/** Flags that make a cell genuinely unroutable, rather than merely expensive. */
export const PROTECT_BLOCKING = PROTECT.PARK | PROTECT.HISTORIC
