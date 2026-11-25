// OpenStreetMap data is ODbL-1.0. Output files carry the attribution.

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { overpassQuery } from './lib/overpass.ts'
import { ROADS_VERSION, type RoadClass, type RoadWire, type RoadsFile } from '../src/engine/geo/basemapTypes.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const OUT_DIR = resolve(ROOT, 'public/data/roads')

/** Override to pin a single mirror; otherwise the client tries several. */
const OVERPASS_URL = process.env.OVERPASS_URL ?? null
const ATTRIBUTION = '© OpenStreetMap contributors'
const LICENSE = 'ODbL-1.0'

const COORD_DP = 5

function classify(highway: string): RoadClass | null {
  switch (highway) {
    case 'motorway': case 'motorway_link': return 0
    case 'trunk': case 'trunk_link': case 'primary': case 'primary_link': return 1
    case 'secondary': case 'secondary_link': case 'tertiary': case 'tertiary_link': return 2
    case 'residential': case 'unclassified': case 'living_street': return 3
    case 'track': case 'service': return 4
    default: return null
  }
}

interface Args { county: string; file: string | null; name: string; state: boolean }

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let county = ''
  let file: string | null = null
  let name = ''
  let state = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--county') county = argv[++i] ?? ''
    else if (argv[i] === '--file') file = argv[++i] ?? null
    else if (argv[i] === '--name') name = argv[++i] ?? ''
    else if (argv[i] === '--state') state = true
  }
  if (!state && !/^13\d{3}$/.test(county)) {
    console.error(
      'Usage: fetch:roads -- --state              (interstates and highways, all of Georgia)\n' +
      '       fetch:roads -- --county <13xxx>     (full detail, one county)\n' +
      '       ... [--file <geojson>] [--name <County>]',
    )
    process.exit(1)
  }
  return { county, file, name, state }
}

const STATE_CLASSES: ReadonlySet<RoadClass> = new Set<RoadClass>([0, 1])

function simplify(points: [number, number][], tolDeg: number): [number, number][] {
  if (points.length < 3) return points
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1

  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [lo, hi] = stack.pop()!
    let worst = 0
    let idx = -1
    const [ax, ay] = points[lo]
    const [bx, by] = points[hi]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy

    for (let i = lo + 1; i < hi; i++) {
      const [px, py] = points[i]
      let d: number
      if (len2 === 0) {
        d = Math.hypot(px - ax, py - ay)
      } else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
        d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
      }
      if (d > worst) { worst = d; idx = i }
    }
    if (idx >= 0 && worst > tolDeg) {
      keep[idx] = 1
      stack.push([lo, idx], [idx, hi])
    }
  }
  return points.filter((_, i) => keep[i] === 1)
}

function round(points: [number, number][]): [number, number][] {
  const f = 10 ** COORD_DP
  const out: [number, number][] = []
  for (const [lon, lat] of points) {
    const p: [number, number] = [Math.round(lon * f) / f, Math.round(lat * f) / f]
    const last = out[out.length - 1]
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p)
  }
  return out
}

async function fromOverpass(fips: string, statewide: boolean): Promise<unknown> {
  const query = statewide
    ? `
[out:json][timeout:900];
area["boundary"="administrative"]["admin_level"="4"]["ISO3166-2"="US-GA"]->.state;
way(area.state)["highway"~"^(motorway|trunk|primary)(_link)?$"];
out geom;`
    : `
[out:json][timeout:300];
area["boundary"="administrative"]["admin_level"="6"]["nist:fips_code"="${fips}"]->.county;
way(area.county)["highway"];
out geom;`
  return overpassQuery(query, {
    endpoints: OVERPASS_URL ? [OVERPASS_URL] : undefined,
    log: (m) => console.error(m),
  })
}

interface OverpassElement {
  type: string
  tags?: Record<string, string>
  geometry?: { lon: number; lat: number }[]
}

function fromOverpassJson(json: unknown): RoadWire[] {
  const elements = (json as { elements?: OverpassElement[] }).elements ?? []
  const out: RoadWire[] = []
  for (const el of elements) {
    if (el.type !== 'way' || !el.geometry) continue
    const cls = classify(el.tags?.highway ?? '')
    if (cls === null) continue
    const pts = el.geometry.map((g) => [g.lon, g.lat] as [number, number])
    out.push({ c: cls, p: pts })
  }
  return out
}

interface GeoJsonFeature {
  properties?: Record<string, unknown>
  geometry?: { type: string; coordinates: unknown }
}

function fromGeoJson(json: unknown): RoadWire[] {
  const features = (json as { features?: GeoJsonFeature[] }).features ?? []
  const out: RoadWire[] = []
  for (const f of features) {
    const highway = String(f.properties?.highway ?? f.properties?.fclass ?? '')
    const cls = classify(highway)
    if (cls === null) continue
    const g = f.geometry
    if (!g) continue
    if (g.type === 'LineString') {
      out.push({ c: cls, p: g.coordinates as [number, number][] })
    } else if (g.type === 'MultiLineString') {
      for (const line of g.coordinates as [number, number][][]) out.push({ c: cls, p: line })
    }
  }
  return out
}

async function main(): Promise<void> {
  const args = parseArgs()

  let wires: RoadWire[]
  let source: string
  if (args.file) {
    if (!existsSync(args.file)) {
      console.error(`No such file: ${args.file}`)
      process.exit(1)
    }
    wires = fromGeoJson(JSON.parse(readFileSync(args.file, 'utf8')))
    source = `OpenStreetMap via local extract (${args.file.split('/').pop()})`
  } else {
    wires = fromOverpassJson(await fromOverpass(args.county, args.state))
    source = `OpenStreetMap via Overpass${OVERPASS_URL ? ` (${OVERPASS_URL})` : ''}`
  }

  if (args.state) wires = wires.filter((w) => STATE_CLASSES.has(w.c))

  if (wires.length === 0) {
    console.error(
      'No road features found. Check the county FIPS, or that the input file ' +
      'carries `highway` (or `fclass`) tags on LineString features.',
    )
    process.exit(1)
  }

  // ~15 m at Georgia's latitude.
  const TOL_DEG = 0.00015
  let rawPoints = 0
  let keptPoints = 0
  const roads: RoadWire[] = []
  for (const w of wires) {
    rawPoints += w.p.length
    const p = round(simplify(w.p, TOL_DEG))
    if (p.length < 2) continue
    keptPoints += p.length
    roads.push({ c: w.c, p })
  }

  roads.sort((a, b) => (a.c - b.c) || (a.p[0][0] - b.p[0][0]) || (a.p[0][1] - b.p[0][1]))

  const file: RoadsFile = {
    version: ROADS_VERSION,
    countyFips: args.state ? 'state' : args.county,
    countyName: args.state ? 'Georgia' : (args.name || args.county),
    source,
    attribution: ATTRIBUTION,
    license: LICENSE,
    roads,
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const path = resolve(OUT_DIR, args.state ? 'state.json' : `${args.county}.json`)
  writeFileSync(path, JSON.stringify(file))

  const bytes = readFileSync(path).length
  const byClass = [0, 1, 2, 3, 4].map(
    (c) => `${c}:${roads.filter((r) => r.c === c).length}`).join(' ')
  console.log(
    `${path}\n` +
    `  ${roads.length.toLocaleString()} roads (${byClass})\n` +
    `  ${keptPoints.toLocaleString()} points, down from ${rawPoints.toLocaleString()} ` +
    `(${(100 - (keptPoints / rawPoints) * 100).toFixed(0)}% simplified)\n` +
    `  ${(bytes / 1024).toFixed(0)} KB · ${LICENSE} · ${ATTRIBUTION}`,
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
