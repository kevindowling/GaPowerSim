/**
 * Loading the optional basemap layers.
 *
 * Both loaders resolve to `null` when the data has not been vendored, rather
 * than throwing. That is the normal state of a fresh checkout: the imagery and
 * road pipelines need network access that not every environment has, so the
 * game must be fully playable without them and simply not offer the layers.
 *
 * Like the parcels, these load lazily — a player who never zooms into a
 * corridor never pays for a county's road network.
 */

import { project } from '../engine/geo/projection.ts'
import type {
  ImageryManifest, RoadsFile, Road, RoadClass,
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

let imageryPromise: Promise<Imagery | null> | null = null
const roadCache = new Map<string, Promise<CountyRoads | null>>()

async function getJson<T>(path: string): Promise<T | null> {
  const url = new URL(path, document.baseURI).href
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    // Offline or blocked: treat exactly like absent, because to the player it is.
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

    // A manifest that lists images we cannot decode is worse than no manifest:
    // the layer would appear in the UI and then draw nothing.
    if (!images) return null
    return { manifest, images }
  })()

  return imageryPromise
}

/**
 * Roads come in two tiers and both go through here.
 *
 * `'state'` is interstates and highways for all of Georgia, small enough to
 * load at startup — the game is statewide, and Sumter is only the tutorial.
 * A county FIPS is the full local network, loaded when the player works there.
 */
export function loadRoads(key: string): Promise<CountyRoads | null> {
  const existing = roadCache.get(key)
  if (existing) return existing

  const promise = (async (): Promise<CountyRoads | null> => {
    const file = await getJson<RoadsFile>(`data/roads/${key}.json`)
    if (!file || !file.roads?.length) return null

    const roads: Road[] = file.roads.map((w) => ({
      cls: w.c as RoadClass,
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

/** Interstates and highways for the whole state. */
export const loadStateRoads = (): Promise<CountyRoads | null> => loadRoads('state')

/** Full local road network for one county. */
export const loadCountyRoads = (fips: string): Promise<CountyRoads | null> => loadRoads(fips)

/** Drop cached basemap data, so a new game re-reads it. */
export function clearBasemapCache(): void {
  imageryPromise = null
  roadCache.clear()
}
