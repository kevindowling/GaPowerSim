/**
 * Aerial imagery and road centrelines — the two layers that make the corridor
 * puzzle legible as a real place rather than a cost surface.
 *
 * Both are optional. The game has always run on vendored terrain and county
 * vectors, and it still does when these files are absent; they layer on top.
 * That matters because neither dataset can be fetched from every environment,
 * and a missing basemap must degrade to "no imagery" rather than a broken map.
 *
 * Like every other dataset here, these are static files produced at build time
 * and committed. Nothing is fetched from a tile server at runtime — the embed
 * makes zero external requests, and a licence that requires per-request
 * attribution to a live host would break that promise.
 */

export const IMAGERY_VERSION = 1
export const ROADS_VERSION = 1

/**
 * One aerial image, already reprojected to the game's Albers space by the
 * fetch script, so the renderer can blit it axis-aligned in world kilometres.
 *
 * Bounds are projected km, not degrees. A lon/lat rectangle is not a rectangle
 * in Albers, so storing degrees here and drawing them as a rect would skew the
 * image against the parcels underneath it. The script measures that skew and
 * refuses to vendor an image where it is visible.
 */
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

/**
 * Road classes, coarse on purpose. The game cares whether a corridor is
 * crossing an interstate or a farm track, not what the speed limit is.
 */
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
  points: [number, number][]
}

// --- hydrology -----------------------------------------------------------

export const HYDROLOGY_VERSION = 1

/**
 * Water is not scenery in this game.
 *
 * It is the sharpest local objection to the Americus project — Sumter is
 * farm country and the fight there is about the aquifer, not the grid. It is
 * a hard constraint on thermal generation, which has to be able to reject
 * heat somewhere. And it is what makes a corridor expensive: crossing a river
 * is a structure and a Section 404 permit, and a wetland crossing is a
 * schedule risk long before it is a cost.
 */
export type WaterKind =
  /** Named river or major stream. */
  | 'river'
  /** Minor stream or creek. */
  | 'stream'
  /** Lake, pond or impoundment. */
  | 'lake'
  /** Reservoir — a lake somebody built, usually for cooling or supply. */
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
