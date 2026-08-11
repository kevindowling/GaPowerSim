/**
 * fetch-hydrology.ts — rivers, lakes and wetlands from OpenStreetMap.
 *
 * Water earns its place in this game three times over.
 *
 * It is the objection. In Sumter County the fight over the Liberty campus is
 * about water before it is about power — this is farm country, the agreement
 * bars the developer from drilling its own wells, and an open-loop cooling
 * system drinks. A map that cannot show the player where the water is cannot
 * show them why the room was full.
 *
 * It is a constraint on generation. Thermal plants have to reject heat
 * somewhere, and the plant catalogue already carries consumptive use in gallons
 * per MWh. Siting a combined-cycle plant away from water should be a problem.
 *
 * It is what makes a corridor expensive. Crossing a river is a long span on
 * tall structures and a Section 404 permit; crossing a wetland is matting, a
 * federal permit and a season of schedule. Routing prices both — see
 * PROTECT in mapTypes.ts — so this data feeds the cost surface, not just the
 * picture.
 *
 * TWO TIERS, matching the roads pipeline:
 *
 *   npm run fetch:hydrology -- --state
 *       Major rivers and large lakes for all of Georgia. Loads at startup.
 *
 *   npm run fetch:hydrology -- --county 13261 --name Sumter
 *       Every creek, pond and swamp in one county. Loaded on demand.
 *
 *   ... --file <path.geojson>
 *       A GeoJSON extract fetched elsewhere, for restricted networks.
 *
 * Output: public/data/hydrology/state.json or <fips>.json, committed.
 *
 * LICENSING. OpenStreetMap is ODbL-1.0 and requires attributing
 * "© OpenStreetMap contributors". The attribution travels in the data file and
 * renders on the map; verify-data fails the build if it is missing.
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HYDROLOGY_VERSION,
  type HydrologyFile, type WaterwayWire, type WaterBodyWire,
} from '../src/engine/geo/basemapTypes.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const OUT_DIR = resolve(ROOT, 'public/data/hydrology')

const OVERPASS = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter'
const ATTRIBUTION = '© OpenStreetMap contributors'
const LICENSE = 'ODbL-1.0'

const COORD_DP = 5
/** ~15 m. Finer than the game draws, coarse enough to shed most vertices. */
const TOL_DEG = 0.00015

/**
 * A pond smaller than this is below a hex cell and cannot affect routing, so
 * vendoring it costs bytes and buys nothing. Degrees squared, very roughly
 * 0.04 km² at Georgia's latitude.
 */
const MIN_BODY_AREA_DEG2 = 3.5e-6

interface Args { county: string; name: string; file: string | null; state: boolean }

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let county = ''
  let name = ''
  let file: string | null = null
  let state = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--county') county = argv[++i] ?? ''
    else if (argv[i] === '--name') name = argv[++i] ?? ''
    else if (argv[i] === '--file') file = argv[++i] ?? null
    else if (argv[i] === '--state') state = true
  }
  if (!state && !/^13\d{3}$/.test(county)) {
    console.error(
      'Usage: fetch:hydrology -- --state           (major rivers and lakes, all of Georgia)\n' +
      '       fetch:hydrology -- --county <13xxx>  (full detail, one county)\n' +
      '       ... [--file <geojson>] [--name <County>]',
    )
    process.exit(1)
  }
  return { county, name, file, state }
}

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
      if (len2 === 0) d = Math.hypot(px - ax, py - ay)
      else {
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

/** Shoelace area in square degrees. Only used to reject specks. */
export function ringArea(ring: [number, number][]): number {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1])
  }
  return Math.abs(a / 2)
}

async function fromOverpass(fips: string, statewide: boolean): Promise<unknown> {
  // Statewide keeps only named rivers and sizeable water bodies; a county pull
  // takes everything. Filtering inside Overpass rather than downloading
  // Georgia's every drainage ditch and discarding it is both faster and politer.
  const query = statewide
    ? `
[out:json][timeout:900];
area["boundary"="administrative"]["admin_level"="4"]["ref:fips"="13"]->.state;
(
  way(area.state)["waterway"="river"];
  way(area.state)["natural"="water"]["water"~"^(lake|reservoir)$"];
  relation(area.state)["natural"="water"]["water"~"^(lake|reservoir)$"];
);
out geom;`
    : `
[out:json][timeout:300];
area["boundary"="administrative"]["admin_level"="6"]["ref:fips"="${fips}"]->.county;
(
  way(area.county)["waterway"~"^(river|stream)$"];
  way(area.county)["natural"~"^(water|wetland)$"];
  relation(area.county)["natural"~"^(water|wetland)$"];
);
out geom;`

  const res = await fetch(OVERPASS, { method: 'POST', body: query })
  if (!res.ok) {
    throw new Error(
      `Overpass returned ${res.status}. If this environment blocks egress, ` +
      `run the "Fetch map data" GitHub workflow instead, or download the data ` +
      `elsewhere and re-run with --file.`,
    )
  }
  return res.json()
}

interface OverpassElement {
  type: string
  tags?: Record<string, string>
  geometry?: { lon: number; lat: number }[]
}

/** Which of our kinds an OSM tag set represents, or null to drop it. */
export function classify(
  tags: Record<string, string>,
): { areal: false; kind: 'river' | 'stream' } | { areal: true; kind: 'lake' | 'reservoir' | 'wetland' } | null {
  const waterway = tags.waterway
  if (waterway === 'river') return { areal: false, kind: 'river' }
  if (waterway === 'stream') return { areal: false, kind: 'stream' }

  if (tags.natural === 'wetland') return { areal: true, kind: 'wetland' }
  if (tags.natural === 'water' || tags.landuse === 'reservoir') {
    const w = tags.water ?? ''
    if (w === 'reservoir' || tags.landuse === 'reservoir') return { areal: true, kind: 'reservoir' }
    // Rivers tagged as areas are still linear features to a router; treating
    // them as lakes would flood the cost surface with a long thin polygon.
    if (w === 'river' || w === 'stream') return null
    return { areal: true, kind: 'lake' }
  }
  return null
}

interface Collected { waterways: WaterwayWire[]; bodies: WaterBodyWire[] }

function collect(
  items: { tags: Record<string, string>; points: [number, number][] }[],
): Collected {
  const waterways: WaterwayWire[] = []
  const bodies: WaterBodyWire[] = []

  for (const item of items) {
    const c = classify(item.tags)
    if (!c) continue
    const pts = round(simplify(item.points, TOL_DEG))
    if (pts.length < 2) continue
    const name = item.tags.name

    if (c.areal) {
      if (pts.length < 4) continue
      if (ringArea(pts) < MIN_BODY_AREA_DEG2) continue
      const body: WaterBodyWire = { k: c.kind, p: pts }
      if (name) body.n = name
      bodies.push(body)
    } else {
      const way: WaterwayWire = { k: c.kind, p: pts }
      if (name) way.n = name
      waterways.push(way)
    }
  }
  return { waterways, bodies }
}

function fromOverpassJson(json: unknown): Collected {
  const elements = (json as { elements?: OverpassElement[] }).elements ?? []
  return collect(elements
    .filter((el) => el.geometry && el.tags)
    .map((el) => ({
      tags: el.tags!,
      points: el.geometry!.map((g) => [g.lon, g.lat] as [number, number]),
    })))
}

interface GeoJsonFeature {
  properties?: Record<string, string>
  geometry?: { type: string; coordinates: unknown }
}

function fromGeoJson(json: unknown): Collected {
  const features = (json as { features?: GeoJsonFeature[] }).features ?? []
  const items: { tags: Record<string, string>; points: [number, number][] }[] = []
  for (const f of features) {
    const tags = f.properties ?? {}
    const g = f.geometry
    if (!g) continue
    if (g.type === 'LineString') {
      items.push({ tags, points: g.coordinates as [number, number][] })
    } else if (g.type === 'MultiLineString') {
      for (const l of g.coordinates as [number, number][][]) items.push({ tags, points: l })
    } else if (g.type === 'Polygon') {
      items.push({ tags, points: (g.coordinates as [number, number][][])[0] })
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates as [number, number][][][]) {
        items.push({ tags, points: poly[0] })
      }
    }
  }
  return collect(items)
}

async function main(): Promise<void> {
  const args = parseArgs()

  let data: Collected
  let source: string
  if (args.file) {
    if (!existsSync(args.file)) {
      console.error(`No such file: ${args.file}`)
      process.exit(1)
    }
    data = fromGeoJson(JSON.parse(readFileSync(args.file, 'utf8')))
    source = `OpenStreetMap via local extract (${args.file.split('/').pop()})`
  } else {
    data = fromOverpassJson(await fromOverpass(args.county, args.state))
    source = `OpenStreetMap via Overpass (${OVERPASS})`
  }

  // The statewide tier carries rivers and open water only. Creeks and swamps
  // are sub-pixel at statewide zoom and belong to the county pull.
  if (args.state) {
    data.waterways = data.waterways.filter((w) => w.k === 'river')
    data.bodies = data.bodies.filter((b) => b.k !== 'wetland')
  }

  if (data.waterways.length === 0 && data.bodies.length === 0) {
    console.error(
      'No water features found. Check the scope, or that the input file carries ' +
      '`waterway` / `natural` tags.',
    )
    process.exit(1)
  }

  // Deterministic order, so a re-pull is a reviewable diff rather than noise.
  data.waterways.sort((a, b) => a.k.localeCompare(b.k) || a.p[0][0] - b.p[0][0] || a.p[0][1] - b.p[0][1])
  data.bodies.sort((a, b) => a.k.localeCompare(b.k) || a.p[0][0] - b.p[0][0] || a.p[0][1] - b.p[0][1])

  const file: HydrologyFile = {
    version: HYDROLOGY_VERSION,
    scope: args.state ? 'state' : args.county,
    scopeName: args.state ? 'Georgia' : (args.name || args.county),
    source,
    attribution: ATTRIBUTION,
    license: LICENSE,
    waterways: data.waterways,
    bodies: data.bodies,
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const path = resolve(OUT_DIR, args.state ? 'state.json' : `${args.county}.json`)
  writeFileSync(path, JSON.stringify(file))

  const bytes = readFileSync(path).length
  const count = (k: string) =>
    data.waterways.filter((w) => w.k === k).length + data.bodies.filter((b) => b.k === k).length
  console.log(
    `${path}\n` +
    `  ${data.waterways.length} watercourse(s), ${data.bodies.length} water bodies\n` +
    `  rivers ${count('river')} · streams ${count('stream')} · lakes ${count('lake')} · ` +
    `reservoirs ${count('reservoir')} · wetlands ${count('wetland')}\n` +
    `  ${(bytes / 1024).toFixed(0)} KB · ${LICENSE} · ${ATTRIBUTION}`,
  )
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
