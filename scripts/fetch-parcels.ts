// PRIVACY: owner-identifying fields are dropped at ingest and never written.

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { project } from '../src/engine/geo/projection.ts'
import { polyArea, km2ToAcres, type Poly, type Ring } from '../src/engine/geo/polygon.ts'
import type { ParcelWire, ParcelFile } from '../src/engine/parcels/types.ts'
import { classifyParcel } from './lib/parcelIdentity.ts'
import { Rng, deriveSeed } from '../src/engine/rng.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

interface CountySource {
  fips: string
  name: string
  kind: 'arcgis' | 'qpublic' | 'file'
  featureService: string | null
  /** Human-facing page where the endpoint can be found. */
  portal: string
  /** Attribute names to try for assessed value, in order of preference. */
  valueFields: string[]
  /** Attribute names to try for acreage. */
  acreFields: string[]
  /** Attribute names to try for land-use classification. */
  useFields: string[]
}

const COUNTIES: CountySource[] = [
  {
    fips: '13261',
    name: 'Sumter',
    kind: 'arcgis',
    featureService: null,
    portal: 'https://sumter-county-open-data-sumtercountygis.hub.arcgis.com/',
    valueFields: ['LANDVALUE', 'LAND_VALUE', 'ASSESSED', 'APPRVALUE'],
    acreFields: ['ACRES', 'GIS_ACRES', 'CALCACRES', 'DEED_ACRES'],
    useFields: ['LANDUSE', 'LAND_USE', 'PROPCLASS', 'CLASS'],
  },
]

const PII_FIELDS = [
  'OWNER', 'OWNER1', 'OWNER2', 'OWNERNAME', 'OWNER_NAME', 'OWN_NAME',
  'TAXPAYER', 'MAILADDR', 'MAIL_ADDR', 'MAILING', 'MAILADD1', 'MAILADD2',
  'ADDR', 'ADDRESS', 'SITEADDR', 'SITE_ADDR', 'PHYSADDR', 'PHONE', 'EMAIL',
]

interface RawFeature {
  geometry: { type: string; coordinates: unknown }
  properties: Record<string, unknown>
}

interface ParcelSource {
  fetchAll(source: CountySource, filePath?: string): Promise<RawFeature[]>
}

/** ArcGIS FeatureServer, paged via resultOffset until the server stops. */
const arcgisSource: ParcelSource = {
  async fetchAll(source) {
    if (!source.featureService) {
      throw new Error(
        `No FeatureServer endpoint recorded for ${source.name} County.\n` +
        `  Find it at: ${source.portal}\n` +
        `  Then set featureService in scripts/fetch-parcels.ts and re-run.`,
      )
    }

    const out: RawFeature[] = []
    const pageSize = 1000
    for (let offset = 0; ; offset += pageSize) {
      const url = new URL(source.featureService)
      url.searchParams.set('where', '1=1')
      url.searchParams.set('outFields', '*')
      url.searchParams.set('outSR', '4326')
      url.searchParams.set('f', 'geojson')
      url.searchParams.set('resultOffset', String(offset))
      url.searchParams.set('resultRecordCount', String(pageSize))

      const res = await fetch(url)
      if (!res.ok) throw new Error(`${url.host} returned ${res.status} ${res.statusText}`)
      const page = (await res.json()) as { features?: RawFeature[] }
      const features = page.features ?? []
      out.push(...features)
      process.stdout.write(`\r  fetched ${out.length} parcels…`)
      if (features.length < pageSize) break
    }
    process.stdout.write('\n')
    return out
  },
}

const fileSource: ParcelSource = {
  async fetchAll(source, explicitPath) {
    const path = explicitPath
      ? resolve(process.cwd(), explicitPath)
      : resolve(ROOT, `data-src/${source.fips}.geojson`)
    if (!existsSync(path)) {
      throw new Error(
        `No GeoJSON at ${path}.\n` +
        `  Download the parcel layer from ${source.portal} (Download → GeoJSON)\n` +
        `  then re-run with:  npm run fetch:parcels -- --county ${source.fips} --file <path>`,
      )
    }
    const doc = JSON.parse(readFileSync(path, 'utf8')) as { features?: RawFeature[] }
    return doc.features ?? []
  },
}

function sourceFor(kind: CountySource['kind']): ParcelSource {
  switch (kind) {
    case 'arcgis': return arcgisSource
    case 'file': return fileSource
    case 'qpublic':
      throw new Error(
        'qPublic has no public bulk endpoint. Request a shapefile from the county ' +
        'GIS office, convert it to GeoJSON, and pass it with --file <path>.',
      )
  }
}

/** Project a lon/lat ring into km and close it. */
function projectRing(ring: number[][]): Ring {
  const out: Ring = ring.map(([lon, lat]) => project(lon, lat))
  const first = out[0]
  const last = out[out.length - 1]
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) out.push([...first])
  return out
}

function toPolys(geom: RawFeature['geometry']): Poly[] {
  if (geom.type === 'Polygon') {
    return [(geom.coordinates as number[][][]).map(projectRing)]
  }
  if (geom.type === 'MultiPolygon') {
    return (geom.coordinates as number[][][][]).map((poly) => poly.map(projectRing))
  }
  return []
}

function firstNumber(props: Record<string, unknown>, fields: string[]): number | null {
  for (const f of fields) {
    for (const key of Object.keys(props)) {
      if (key.toUpperCase() !== f) continue
      const v = Number(props[key])
      if (Number.isFinite(v) && v > 0) return v
    }
  }
  return null
}

function firstString(props: Record<string, unknown>, fields: string[]): string | null {
  for (const f of fields) {
    for (const key of Object.keys(props)) {
      if (key.toUpperCase() !== f) continue
      const v = props[key]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
  }
  return null
}

/** Confirm no owner-identifying field survived into the output. */
function assertNoPii(parcels: ParcelWire[]): void {
  const serialized = JSON.stringify(parcels).toUpperCase()
  for (const field of PII_FIELDS) {
    if (serialized.includes(`"${field}"`)) {
      throw new Error(`PII field "${field}" leaked into the output: refusing to write.`)
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const fipsArg = args[args.indexOf('--county') + 1]
  const dryRun = args.includes('--dry-run')
  const fileIdx = args.indexOf('--file')
  const filePath = fileIdx >= 0 ? args[fileIdx + 1] : undefined

  if (!fipsArg || fipsArg.startsWith('--')) {
    console.error('usage: npm run fetch:parcels -- --county <fips> [--file <geojson>] [--dry-run]')
    console.error(`known counties: ${COUNTIES.map((c) => `${c.fips} (${c.name})`).join(', ')}`)
    process.exit(1)
  }

  const source = COUNTIES.find((c) => c.fips === fipsArg)
  if (!source) {
    console.error(`No adapter for FIPS ${fipsArg}. Add one to COUNTIES in this file.`)
    process.exit(1)
  }

  const kind = filePath ? 'file' : source.kind
  console.log(`Fetching parcels for ${source.name} County (${source.fips}) via ${kind}…`)
  const raw = await sourceFor(kind).fetchAll(source, filePath)
  console.log(`  ${raw.length} features from source`)

  const rng = new Rng(deriveSeed(0x9a5ce1, source.fips))
  const parcels: ParcelWire[] = []

  for (let i = 0; i < raw.length; i++) {
    const f = raw[i]
    if (!f.geometry) continue

    for (const poly of toPolys(f.geometry)) {
      const areaKm2 = polyArea(poly)
      if (areaKm2 <= 0) continue
      const acres = km2ToAcres(areaKm2)
      // Sub-tenth-acre slivers are usually right-of-way remnants, not property.
      if (acres < 0.1) continue

      const assessedTotal = firstNumber(f.properties, source.valueFields)
      const statedAcres = firstNumber(f.properties, source.acreFields) ?? acres
      const landUse = firstString(f.properties, source.useFields)

      const archetype = classifyParcel({ acres, landUse, rng })
      // Flat rings, 10 m precision, closing point trimmed.
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

      parcels.push({
        id: `${source.fips}-${parcels.length + 1}`,
        rings,
        acres: Math.round(acres * 10) / 10,
        archetype,
        assessedPerAcre: assessedTotal
          ? Math.round(assessedTotal / Math.max(statedAcres, 0.1))
          : 0,
      })
    }
  }

  assertNoPii(parcels)

  const file: ParcelFile = {
    version: 1,
    countyFips: source.fips,
    countyName: source.name,
    source: `${source.name} County GIS (${source.kind})`,
    sourceUrl: source.featureService ?? source.portal,
    generatedAt: new Date().toISOString().slice(0, 10),
    synthetic: false,
    note: 'Real surveyed boundaries and assessed values. Owner names are synthesized; ' +
      'owner-identifying fields are dropped at ingest and never stored.',
    parcels,
  }

  console.log(`  ${parcels.length} parcels kept`)
  if (dryRun) {
    console.log('  --dry-run: nothing written')
    return
  }

  const dir = resolve(ROOT, 'public/data/parcels')
  mkdirSync(dir, { recursive: true })
  const path = resolve(dir, `${source.fips}.json`)
  writeFileSync(path, JSON.stringify(file))
  console.log(`  wrote ${path}`)
}

main().catch((e: unknown) => {
  console.error(`\n${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
