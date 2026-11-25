// Builds the OpenStreetMap layers from a Georgia .osm.pbf extract. Needs GDAL.
//
//   curl -LO https://download.geofabrik.de/north-america/us/georgia-latest.osm.pbf
//   npm run build:gis -- --pbf georgia-latest.osm.pbf
//   npm run build:hexgrid
//
// OpenStreetMap data is ODbL-1.0. Attribution is stored in every output file.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { project } from '../src/engine/geo/projection.ts'
import { SCENARIOS } from '../src/data/scenarios.ts'
import {
  GIS_VERSION, HYDROLOGY_VERSION, ROADS_VERSION,
  type GisFile, type HydrologyFile, type RoadClass, type RoadsFile,
} from '../src/engine/geo/basemapTypes.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ATTRIBUTION = '© OpenStreetMap contributors'
const LICENSE = 'ODbL-1.0'
const SOURCE = 'OpenStreetMap, Geofabrik Georgia extract'

type LonLat = [number, number]
type BBox = [number, number, number, number]
interface Feature {
  properties: Record<string, string | null>
  geometry: { type: string; coordinates: unknown }
}

const CONF = `
closed_ways_are_polygons=aeroway,amenity,boundary,building,craft,geological,historic,landuse,leisure,military,natural,office,place,power,shop,sport,tourism
attribute_name_laundering=yes
[points]
attributes=name,place,amenity
[lines]
attributes=name,highway,waterway,railway,power,voltage,service
[multipolygons]
attributes=name,natural,water,landuse,leisure,boundary,building,power,amenity,protect_class,voltage,operator
[multilinestrings]
attributes=name
[other_relations]
attributes=name
`

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] ?? null : null
}

function query(gpkg: string, layer: string, where: string, box: BBox | null): Feature[] {
  const out = execFileSync('ogr2ogr', [
    '-f', 'GeoJSONSeq', '/vsistdout/', gpkg, layer, '-where', where,
    ...(box ? ['-spat', ...box.map(String)] : []),
  ], { maxBuffer: 1 << 30, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  return out.split('\n').filter(Boolean).map((l) => JSON.parse(l.replace(/^\x1e/, '')) as Feature)
}

function lines(f: Feature): LonLat[][] {
  const g = f.geometry
  if (g.type === 'LineString') return [g.coordinates as LonLat[]]
  if (g.type === 'MultiLineString') return g.coordinates as LonLat[][]
  return []
}

function outerRings(f: Feature): LonLat[][] {
  const g = f.geometry
  if (g.type === 'Polygon') return [(g.coordinates as LonLat[][])[0]]
  if (g.type === 'MultiPolygon') return (g.coordinates as LonLat[][][]).map((p) => p[0])
  return []
}

function simplify(pts: LonLat[], tol: number): LonLat[] {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: LonLat[] = [[0, pts.length - 1]]
  while (stack.length > 0) {
    const [a, b] = stack.pop()!
    const [ax, ay] = pts[a]
    const dx = pts[b][0] - ax
    const dy = pts[b][1] - ay
    const l2 = dx * dx + dy * dy
    let worst = 0
    let at = -1
    for (let i = a + 1; i < b; i++) {
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / l2)) : 0
      const d = Math.hypot(pts[i][0] - ax - t * dx, pts[i][1] - ay - t * dy)
      if (d > worst) { worst = d; at = i }
    }
    if (at >= 0 && worst > tol) { keep[at] = 1; stack.push([a, at], [at, b]) }
  }
  return pts.filter((_, i) => keep[i] === 1)
}

function tidy(pts: LonLat[], tol: number, dp: number): LonLat[] {
  const f = 10 ** dp
  const out: LonLat[] = []
  for (const [x, y] of simplify(pts, tol)) {
    const p: LonLat = [Math.round(x * f) / f, Math.round(y * f) / f]
    const last = out[out.length - 1]
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p)
  }
  return out
}

function ringKm2(ring: LonLat[]): number {
  const p = ring.map(([lon, lat]) => project(lon, lat))
  let a = 0
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    a += p[j][0] * p[i][1] - p[i][0] * p[j][1]
  }
  return Math.abs(a / 2)
}

function centre(ring: LonLat[]): LonLat {
  let x = 0
  let y = 0
  for (const [lon, lat] of ring) { x += lon; y += lat }
  return [Math.round((x / ring.length) * 1e5) / 1e5, Math.round((y / ring.length) * 1e5) / 1e5]
}

function write(path: string, data: unknown): void {
  const full = resolve(ROOT, 'public/data', path)
  mkdirSync(dirname(full), { recursive: true })
  const json = JSON.stringify(data)
  writeFileSync(full, json)
  console.log(`${path.padEnd(24)} ${(json.length / 1024).toFixed(0)} KB`)
}

function maxKv(v: string | null): number {
  const n = (v ?? '').split(';').map(Number).filter(Number.isFinite)
  return n.length > 0 ? Math.max(...n) / 1000 : 0
}

function hydrology(gpkg: string, scope: string, name: string, box: BBox | null): HydrologyFile {
  const state = box === null
  const tol = state ? 0.0012 : 0.00015
  const dp = state ? 4 : 5
  const waterways: HydrologyFile['waterways'] = []
  for (const f of query(gpkg, 'lines',
    state ? "waterway = 'river' AND name IS NOT NULL" : "waterway IN ('river','stream')", box)) {
    for (const l of lines(f)) {
      const p = tidy(l, tol, dp)
      if (p.length < 2) continue
      waterways.push({
        k: f.properties.waterway === 'river' ? 'river' : 'stream',
        ...(f.properties.name ? { n: f.properties.name } : {}),
        p,
      })
    }
  }
  const bodies: HydrologyFile['bodies'] = []
  for (const f of query(gpkg, 'multipolygons',
    state ? "natural = 'water'" : "natural IN ('water','wetland') OR landuse = 'reservoir'", box)) {
    const w = f.properties.water
    if (w === 'wastewater' || w === 'basin') continue
    for (const ring of outerRings(f)) {
      if (ringKm2(ring) < (state ? 0.6 : 0.006)) continue
      const p = tidy(ring, tol, dp)
      if (p.length < 4) continue
      bodies.push({
        k: f.properties.natural === 'wetland' ? 'wetland'
          : w === 'reservoir' || f.properties.landuse === 'reservoir' ? 'reservoir' : 'lake',
        ...(f.properties.name ? { n: f.properties.name } : {}),
        p,
      })
    }
  }
  return {
    version: HYDROLOGY_VERSION, scope, scopeName: name, source: SOURCE,
    attribution: ATTRIBUTION, license: LICENSE, waterways, bodies,
  }
}

const ROAD_CLASS: Record<string, RoadClass> = {
  motorway: 0, motorway_link: 0, trunk: 1, trunk_link: 1, primary: 1, primary_link: 1,
  secondary: 2, secondary_link: 2, tertiary: 2, tertiary_link: 2,
  residential: 3, unclassified: 3, living_street: 3, track: 4,
}

function roads(gpkg: string, fips: string, name: string, box: BBox): RoadsFile {
  const out: RoadsFile['roads'] = []
  for (const f of query(gpkg, 'lines', 'highway IS NOT NULL', box)) {
    const c = ROAD_CLASS[f.properties.highway ?? '']
    if (c === undefined) continue
    for (const l of lines(f)) {
      const p = tidy(l, 0.00008, 5)
      if (p.length > 1) out.push({ c, ...(c <= 3 && f.properties.name ? { n: f.properties.name } : {}), p })
    }
  }
  return {
    version: ROADS_VERSION, countyFips: fips, countyName: name, source: SOURCE,
    attribution: ATTRIBUTION, license: LICENSE, roads: out,
  }
}

const PROTECTED = /national (park|wildlife refuge|seashore|monument|battlefield|historic|recreation)|wilderness|state park|state historic|refuge|mounds/i
const LANDCOVER: Record<string, GisFile['land'][number]['k']> = {
  wood: 'wood', forest: 'wood', scrub: 'wood', farmland: 'farm', meadow: 'farm', grassland: 'farm',
  orchard: 'orchard', residential: 'town', commercial: 'town', retail: 'town',
  industrial: 'industry', quarry: 'industry', cemetery: 'cemetery', religious: 'cemetery',
}

function gis(gpkg: string, scope: string, name: string, box: BBox | null): GisFile {
  const state = box === null
  const tol = state ? 0.0012 : 0.0001
  const dp = state ? 4 : 5

  const power: GisFile['power'] = []
  for (const f of query(gpkg, 'lines', "power IN ('line','minor_line')", box)) {
    const kv = maxKv(f.properties.voltage)
    if (kv < (state ? 115 : 25)) continue
    for (const l of lines(f)) {
      const p = tidy(l, tol, dp)
      if (p.length > 1) power.push({ kv, p })
    }
  }

  const rail: GisFile['rail'] = []
  for (const f of query(gpkg, 'lines',
    state ? "railway = 'rail' AND service IS NULL" : "railway = 'rail'", box)) {
    for (const l of lines(f)) {
      const p = tidy(l, tol, dp)
      if (p.length > 1) rail.push({ p })
    }
  }

  const parks: GisFile['parks'] = []
  for (const f of query(gpkg, 'multipolygons',
    "boundary IN ('national_park','protected_area') OR leisure = 'nature_reserve'", box)) {
    const n = f.properties.name ?? ''
    if (!PROTECTED.test(n) || /management area|WMA/i.test(n)) continue
    for (const ring of outerRings(f)) {
      if (ringKm2(ring) < 0.05) continue
      const p = tidy(ring, state ? 0.0008 : 0.0002, dp)
      if (p.length > 3) parks.push({ n, p })
    }
  }

  const substations: GisFile['substations'] = []
  const land: GisFile['land'] = []
  const buildings: GisFile['buildings'] = []
  if (!state) {
    for (const f of query(gpkg, 'multipolygons', "power = 'substation'", box)) {
      const kv = maxKv(f.properties.voltage)
      const ring = outerRings(f)[0]
      if (!ring || kv < 46) continue
      substations.push({ kv, ...(f.properties.name ? { n: f.properties.name } : {}), at: centre(ring) })
    }
    for (const f of query(gpkg, 'multipolygons', "natural IN ('wood','scrub','grassland') OR landuse IS NOT NULL", box)) {
      const k = LANDCOVER[f.properties.natural ?? ''] ?? LANDCOVER[f.properties.landuse ?? '']
      if (!k) continue
      for (const ring of outerRings(f)) {
        if (k !== 'cemetery' && ringKm2(ring) < 0.01) continue
        const p = tidy(ring, 0.00025, 5)
        if (p.length > 3) land.push({ k, p })
      }
    }
    for (const f of query(gpkg, 'multipolygons', 'building IS NOT NULL', box)) {
      const ring = outerRings(f)[0]
      if (!ring) continue
      const church = f.properties.building === 'church' || f.properties.amenity === 'place_of_worship'
      buildings.push([...centre(ring), church ? 1 : 0])
    }
  }

  return {
    version: GIS_VERSION, scope, scopeName: name, source: SOURCE,
    attribution: ATTRIBUTION, license: LICENSE,
    power, rail, parks, substations, land, buildings,
  }
}

function main(): void {
  const pbf = arg('pbf')
  let gpkg = arg('gpkg')
  if (!pbf && !gpkg) {
    console.error('Usage: npm run build:gis -- --pbf <georgia.osm.pbf>')
    process.exit(1)
  }
  const tmp = mkdtempSync(join(tmpdir(), 'gapowersim-gis-'))
  try {
    if (!gpkg) {
      if (!existsSync(pbf!)) throw new Error(`No such file: ${pbf}`)
      const conf = join(tmp, 'osmconf.ini')
      writeFileSync(conf, CONF)
      gpkg = join(tmp, 'ga.gpkg')
      console.log('Converting extract…')
      execFileSync('ogr2ogr', ['-f', 'GPKG', gpkg, pbf!, 'lines', 'multipolygons', 'points'], {
        env: { ...process.env, OSM_CONFIG_FILE: conf, OGR_INTERLEAVED_READING: 'YES', OSM_MAX_TMPFILE_SIZE: '4000' },
        stdio: 'ignore',
      })
    }

    write('hydrology/state.json', hydrology(gpkg, 'state', 'Georgia', null))
    write('gis/state.json', gis(gpkg, 'state', 'Georgia', null))

    const counties = JSON.parse(readFileSync(resolve(ROOT, 'public/data/counties.json'), 'utf8')) as {
      counties: Array<{ fips: string; name: string }>
    }
    for (const sc of SCENARIOS) {
      const fips = sc.contract.countyFips
      const name = counties.counties.find((c) => c.fips === fips)?.name ?? fips
      write(`hydrology/${fips}.json`, hydrology(gpkg, fips, name, sc.studyArea))
      write(`roads/${fips}.json`, roads(gpkg, fips, name, sc.studyArea))
      write(`gis/${fips}.json`, gis(gpkg, fips, name, sc.studyArea))
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

main()
