import type { Parcel, ParcelFile } from '../engine/parcels/types.ts'
import { inflateParcel } from '../engine/parcels/types.ts'
import { ownerNameFor } from '../engine/parcels/owners.ts'

export interface CountyParcels {
  countyFips: string
  countyName: string
  synthetic: boolean
  note: string
  source: string
  parcels: Parcel[]
}

const cache = new Map<string, Promise<CountyParcels>>()

export function loadCountyParcels(fips: string): Promise<CountyParcels> {
  const existing = cache.get(fips)
  if (existing) return existing

  const promise = (async (): Promise<CountyParcels> => {
    const url = new URL(`data/parcels/${fips}.json`, document.baseURI).href
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(
        `No parcel data for county ${fips} (${res.status}). ` +
        `Run \`npm run build:parcels\`, or fetch the real cadastre with ` +
        `\`npm run fetch:parcels -- --county ${fips}\`.`,
      )
    }
    const file = (await res.json()) as ParcelFile
    return {
      countyFips: file.countyFips,
      countyName: file.countyName,
      synthetic: file.synthetic,
      note: file.note,
      source: file.source,
      parcels: file.parcels.map((w) => inflateParcel(w, file.countyFips, ownerNameFor)),
    }
  })()

  cache.set(fips, promise)
  return promise
}

/** Drop cached parcels, so a new game re-reads them. */
export function clearParcelCache(): void {
  cache.clear()
}
