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

/** A state drawn for context. Rings are flat projected km. */
export interface StateShape { abbr: string; name: string; rings: number[][] }

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
  /** States round Georgia. Empty if the file is missing. */
  states?: StateShape[]
}

/** Sentinel stored in the county layer for cells outside Georgia. */
export const OUTSIDE_STATE = 255

export const PROTECT = {
  /** Open water: river channel, lake, reservoir. Crossable, at a price. */
  WATER: 1 << 0,
  /** Swamp, marsh, bog. Crossable; triggers a federal permit. */
  WETLAND: 1 << 1,
  /** State or national park, wildlife refuge, wilderness. Refused. */
  PARK: 1 << 2,
  /** Listed historic site or cemetery. Refused. */
  HISTORIC: 1 << 3,
  /** A river runs through the cell. Crossable; useful as cooling water. */
  RIVER: 1 << 4,
} as const

export const PROTECT_BLOCKING = PROTECT.PARK | PROTECT.HISTORIC
