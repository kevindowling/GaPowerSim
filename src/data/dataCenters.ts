import { project } from '../engine/geo/projection.ts'

export interface DataCenter {
  id: string
  name: string
  developer: string | null
  county: string | null
  state: string
  x: number
  y: number
  /** How exact the location is. */
  precision: string
  mw: number | null
  mwNote: string | null
  utility: string | null
  status: string
  target: string | null
  asOf: string | null
  /** Where its location came from. */
  where?: { url: string; title: string } | null
  sources: Array<{ url: string; title: string; date: string | null }>
}

export const STOPPED = new Set(['withdrawn', 'denied', 'on hold'])

export const isActive = (d: DataCenter): boolean => !STOPPED.has(d.status)
export const inGeorgia = (d: DataCenter): boolean => d.state === 'GA' || d.state === 'Georgia'
export const byGeorgiaPower = (d: DataCenter): boolean => (d.utility ?? '').includes('Georgia Power')

/** Alabama Power and Mississippi Power have the same parent as Georgia Power. */
export const bySister = (d: DataCenter): boolean => /Alabama Power|Mississippi Power/.test(d.utility ?? '')

export const utilityNamed = (d: DataCenter): boolean => Boolean(d.utility) && d.utility !== 'unknown'

/** Georgia sites not named as another utility's, and the sister utilities' sites in Alabama and Mississippi. */
export const inServiceArea = (d: DataCenter): boolean => (inGeorgia(d)
  ? byGeorgiaPower(d) || !utilityNamed(d)
  : bySister(d))

type Wire = Omit<DataCenter, 'x' | 'y'> & { lat: number | null; lon: number | null }

/** Reported data centers. An empty list if the file is missing. */
export async function loadDataCenters(): Promise<DataCenter[]> {
  try {
    const res = await fetch(new URL('data/datacenters.json', document.baseURI).href)
    if (!res.ok) return []
    const list = (await res.json()) as Wire[]
    return list.flatMap((d) => {
      if (d.lat === null || d.lon === null) return []
      const [x, y] = project(d.lon, d.lat)
      return [{ ...d, x, y }]
    })
  } catch {
    return []
  }
}
