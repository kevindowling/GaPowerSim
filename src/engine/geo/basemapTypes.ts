export const IMAGERY_VERSION = 1
export const ROADS_VERSION = 1

export interface ImageryTile {
  /** File name within `public/data/basemap/`. */
  file: string
  /** Projected bounds in km: [minX, minY, maxX, maxY]. */
  bounds: [number, number, number, number]
  widthPx: number
  heightPx: number
  /** Ground resolution in metres per pixel, for choosing a zoom threshold. */
  metresPerPixel: number
}

export interface ImageryManifest {
  version: number
  /** Human-readable provenance, shown in the UI. */
  source: string
  /** Attribution text the UI is required to display. */
  attribution: string
  /** Licence identifier, e.g. 'public-domain' or 'ODbL-1.0'. */
  license: string
  /** Year the imagery was flown, when known. */
  capturedYear: number | null
  tiles: ImageryTile[]
}

export type RoadClass = 0 | 1 | 2 | 3 | 4

export const ROAD_CLASS_NAMES: Record<RoadClass, string> = {
  0: 'Interstate',
  1: 'Highway',
  2: 'Secondary road',
  3: 'Local street',
  4: 'Track',
}

/** A road centreline. Coordinates are lon/lat pairs; the loader projects them. */
export interface RoadWire {
  c: RoadClass
  n?: string
  p: [number, number][]
}

export interface RoadsFile {
  version: number
  countyFips: string
  countyName: string
  source: string
  attribution: string
  license: string
  roads: RoadWire[]
}

/** A road in projected world kilometres, ready to draw. */
export interface Road {
  cls: RoadClass
  name: string | null
  points: [number, number][]
}

export const HYDROLOGY_VERSION = 1

export type WaterKind =
  /** Named river or major stream. */
  | 'river'
  /** Minor stream or creek. */
  | 'stream'
  /** Lake, pond or impoundment. */
  | 'lake'
  | 'reservoir'
  /** Swamp, marsh or bog. Passable, permit-triggering, and slow. */
  | 'wetland'

/** A linear watercourse. Coordinates are lon/lat; the loader projects them. */
export interface WaterwayWire {
  k: 'river' | 'stream'
  /** Name where OSM has one, for labelling a crossing in the takings report. */
  n?: string
  p: [number, number][]
}

/** An areal water feature: outer ring only, holes are not worth the bytes. */
export interface WaterBodyWire {
  k: 'lake' | 'reservoir' | 'wetland'
  n?: string
  p: [number, number][]
}

export interface HydrologyFile {
  version: number
  /** 'state' for the statewide tier, or a county FIPS. */
  scope: string
  scopeName: string
  source: string
  attribution: string
  license: string
  waterways: WaterwayWire[]
  bodies: WaterBodyWire[]
}

/** Projected, ready to draw. */
export interface Waterway {
  kind: 'river' | 'stream'
  name: string | null
  points: [number, number][]
}

export interface WaterBody {
  kind: 'lake' | 'reservoir' | 'wetland'
  name: string | null
  ring: [number, number][]
}

export const GIS_VERSION = 1

export type LandKind = 'wood' | 'farm' | 'orchard' | 'town' | 'industry' | 'cemetery'

export interface GisFile {
  version: number
  scope: string
  scopeName: string
  source: string
  attribution: string
  license: string
  power: Array<{ kv: number; p: [number, number][] }>
  rail: Array<{ p: [number, number][] }>
  parks: Array<{ n: string; p: [number, number][] }>
  substations: Array<{ kv: number; n?: string; at: [number, number] }>
  land: Array<{ k: LandKind; p: [number, number][] }>
  /** lon, lat, 1 if a church. */
  buildings: Array<[number, number, number]>
}

/** Projected, ready to draw and route against. */
export interface Gis {
  scope: string
  attribution: string
  power: Array<{ kv: number; points: [number, number][] }>
  rail: Array<{ points: [number, number][] }>
  parks: Array<{ name: string; ring: [number, number][] }>
  substations: Array<{ kv: number; name: string | null; x: number; y: number }>
  land: Array<{ kind: LandKind; ring: [number, number][] }>
  buildings: [number, number][]
  churches: [number, number][]
}
