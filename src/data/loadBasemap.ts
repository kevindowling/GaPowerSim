import { project } from '../engine/geo/projection.ts'
import type {
  ImageryManifest, RoadsFile, Road, RoadClass,
  HydrologyFile, Waterway, WaterBody, GisFile, Gis,
} from '../engine/geo/basemapTypes.ts'

export interface Imagery {
  manifest: ImageryManifest
  /** Decoded images, indexed the same as `manifest.tiles`. */
  images: (ImageBitmap | HTMLImageElement)[]
}

export interface CountyRoads {
  countyFips: string
  countyName: string
  attribution: string
  roads: Road[]
}

export interface Hydrology {
  scope: string
  attribution: string
  waterways: Waterway[]
  bodies: WaterBody[]
}

let imageryPromise: Promise<Imagery | null> | null = null
const roadCache = new Map<string, Promise<CountyRoads | null>>()
const hydroCache = new Map<string, Promise<Hydrology | null>>()

async function getJson<T>(path: string): Promise<T | null> {
  const url = new URL(path, document.baseURI).href
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    return null
  }
  if (!res.ok) return null
  try {
    return (await res.json()) as T
  } catch {
    return null
  }
}

export function loadImagery(): Promise<Imagery | null> {
  if (imageryPromise) return imageryPromise

  imageryPromise = (async (): Promise<Imagery | null> => {
    const manifest = await getJson<ImageryManifest>('data/basemap/imagery.json')
    if (!manifest || !manifest.tiles?.length) return null

    const images = await Promise.all(
      manifest.tiles.map(async (t) => {
        const url = new URL(`data/basemap/${t.file}`, document.baseURI).href
        const img = new Image()
        img.src = url
        await img.decode()
        return img
      }),
    ).catch(() => null)

    if (!images) return null
    return { manifest, images }
  })()

  return imageryPromise
}

export function loadRoads(key: string): Promise<CountyRoads | null> {
  const existing = roadCache.get(key)
  if (existing) return existing

  const promise = (async (): Promise<CountyRoads | null> => {
    const file = await getJson<RoadsFile>(`data/roads/${key}.json`)
    if (!file || !file.roads?.length) return null

    const roads: Road[] = file.roads.map((w) => ({
      cls: w.c as RoadClass,
      name: w.n ?? null,
      points: w.p.map(([lon, lat]) => project(lon, lat)),
    }))
    return {
      countyFips: file.countyFips,
      countyName: file.countyName,
      attribution: file.attribution,
      roads,
    }
  })()

  roadCache.set(key, promise)
  return promise
}

export const loadStateRoads = (): Promise<CountyRoads | null> => loadRoads('state')

export const loadCountyRoads = (fips: string): Promise<CountyRoads | null> => loadRoads(fips)

export function loadHydrology(key: string): Promise<Hydrology | null> {
  const existing = hydroCache.get(key)
  if (existing) return existing

  const promise = (async (): Promise<Hydrology | null> => {
    const file = await getJson<HydrologyFile>(`data/hydrology/${key}.json`)
    if (!file) return null
    if (!file.waterways?.length && !file.bodies?.length) return null

    return {
      scope: file.scope,
      attribution: file.attribution,
      waterways: file.waterways.map((w) => ({
        kind: w.k,
        name: w.n ?? null,
        points: w.p.map(([lon, lat]) => project(lon, lat)),
      })),
      bodies: file.bodies.map((b) => ({
        kind: b.k,
        name: b.n ?? null,
        ring: b.p.map(([lon, lat]) => project(lon, lat)),
      })),
    }
  })()

  hydroCache.set(key, promise)
  return promise
}

export const loadStateHydrology = (): Promise<Hydrology | null> => loadHydrology('state')
export const loadCountyHydrology = (fips: string): Promise<Hydrology | null> => loadHydrology(fips)

const gisCache = new Map<string, Promise<Gis | null>>()

export function loadGis(key: string): Promise<Gis | null> {
  const existing = gisCache.get(key)
  if (existing) return existing
  const promise = (async (): Promise<Gis | null> => {
    const file = await getJson<GisFile>(`data/gis/${key}.json`)
    if (!file) return null
    const line = (p: [number, number][]) => p.map(([lon, lat]) => project(lon, lat))
    return {
      scope: file.scope,
      attribution: file.attribution,
      power: file.power.map((l) => ({ kv: l.kv, points: line(l.p) })),
      rail: file.rail.map((l) => ({ points: line(l.p) })),
      parks: file.parks.map((k) => ({ name: k.n, ring: line(k.p) })),
      substations: file.substations.map((s) => {
        const [x, y] = project(s.at[0], s.at[1])
        return { kv: s.kv, name: s.n ?? null, x, y }
      }),
      land: file.land.map((l) => ({ kind: l.k, ring: line(l.p) })),
      buildings: file.buildings.map(([lon, lat]) => project(lon, lat)),
      churches: file.buildings.filter((b) => b[2] === 1).map(([lon, lat]) => project(lon, lat)),
    }
  })()
  gisCache.set(key, promise)
  return promise
}

/** Drop cached basemap data, so a new game re-reads it. */
export function clearBasemapCache(): void {
  imageryPromise = null
  roadCache.clear()
  hydroCache.clear()
  gisCache.clear()
}
