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
