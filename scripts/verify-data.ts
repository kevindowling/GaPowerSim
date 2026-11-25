import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CITIES } from '../src/data/cities.ts'
import { SCENARIOS } from '../src/data/scenarios.ts'
import type { CountiesFile, HexGridManifest } from '../src/engine/geo/mapTypes.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA = resolve(ROOT, 'public/data')

/** Flip to true during M6, once every record carries a verified source. */
const STRICT = false

/** Georgia's land area per the Census, km². The rasteriser should land near this. */
const GA_LAND_AREA_KM2 = 153_910
const AREA_TOLERANCE = 0.03

const problems: string[] = []
const warnings: string[] = []

function check(condition: boolean, message: string): void {
  if (!condition) problems.push(message)
}

const STATE_TIER_BUDGET_MB = 6
const COUNTY_TIER_BUDGET_MB = 25

function reportTier(
  kind: string, file: string, count: number, unit: string, bytes: number,
): void {
  const mb = bytes / 1024 / 1024
  const statewide = file === 'state.json'
  const budget = statewide ? STATE_TIER_BUDGET_MB : COUNTY_TIER_BUDGET_MB
  const label = statewide ? 'statewide' : `county ${file.replace('.json', '')}`
  console.log(`  ${kind}/${label}: ${count.toLocaleString()} ${unit}, ${mb.toFixed(1)} MB`)

  if (mb > budget) {
    const msg = `${kind}/${file} is ${mb.toFixed(1)} MB, over the ${budget} MB budget` +
      (statewide ? ' for a file loaded on first paint' : '')
    if (statewide) problems.push(msg)
    else warnings.push(msg)
  }
}

/** "statewide + 1 county" reads better than "2 file(s)". */
function describeTiers(files: string[]): string {
  const counties = files.filter((f) => f !== 'state.json').length
  const parts: string[] = []
  if (files.includes('state.json')) parts.push('statewide')
  if (counties > 0) parts.push(`${counties} county file${counties === 1 ? '' : 's'}`)
  return parts.join(' + ') || 'none'
}

function requireFile(name: string): string {
  const path = resolve(DATA, name)
  if (!existsSync(path)) {
    problems.push(`missing ${name}: run \`npm run data\``)
    return ''
  }
  return path
}

const countiesPath = requireFile('counties.json')
if (countiesPath) {
  const counties = JSON.parse(readFileSync(countiesPath, 'utf8')) as CountiesFile
  check(counties.version === 1, 'counties.json: unexpected version')
  check(
    counties.counties.length === 159,
    `counties.json: expected Georgia's 159 counties, got ${counties.counties.length}`,
  )

  const seen = new Set<string>()
  for (const c of counties.counties) {
    check(/^13\d{3}$/.test(c.fips), `counties.json: ${c.fips} is not a Georgia FIPS code`)
    check(!seen.has(c.fips), `counties.json: duplicate FIPS ${c.fips}`)
    seen.add(c.fips)
    check(c.polygons.length > 0, `counties.json: ${c.name} has no geometry`)
    check(c.areaKm2 > 0, `counties.json: ${c.name} has non-positive area`)
    for (const poly of c.polygons) {
      for (const ring of poly) {
        check(
          ring.length >= 8 && ring.length % 2 === 0,
          `counties.json: ${c.name} has a malformed ring (${ring.length} coords)`,
        )
        check(
          ring.every(Number.isFinite),
          `counties.json: ${c.name} has a non-finite coordinate`,
        )
      }
    }
  }

  const totalArea = counties.counties.reduce((s, c) => s + c.areaKm2, 0)
  const drift = Math.abs(totalArea - GA_LAND_AREA_KM2) / GA_LAND_AREA_KM2
  check(
    drift < AREA_TOLERANCE,
    `counties.json: total area ${Math.round(totalArea).toLocaleString()} km² drifts ` +
      `${(drift * 100).toFixed(1)}% from Georgia's ${GA_LAND_AREA_KM2.toLocaleString()} km² ` +
      `the projection or simplification is wrong`,
  )
  console.log(`counties.json  159 counties, ${Math.round(totalArea).toLocaleString()} km² total ` +
    `(${(drift * 100).toFixed(1)}% from Census)`)
}

const manifestPath = requireFile('hexgrid.json')
const binPath = requireFile('hexgrid.bin')
if (manifestPath && binPath) {
  const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as HexGridManifest
  const bin = readFileSync(binPath)

  check(m.spec.cols > 0 && m.spec.rows > 0, 'hexgrid.json: empty grid spec')
  check(
    m.cellCount === m.spec.cols * m.spec.rows,
    'hexgrid.json: cellCount disagrees with cols × rows',
  )
  check(m.counties.length === 159, 'hexgrid.json: county list is not 159 long')

  let expectedBytes = 0
  for (const layer of m.layers) {
    const width = layer.type === 'Uint16' ? 2 : 1
    check(
      layer.byteLength === m.cellCount * width,
      `hexgrid.json: layer "${layer.name}" is ${layer.byteLength} bytes, expected ${m.cellCount * width}`,
    )
    check(layer.offset === expectedBytes, `hexgrid.json: layer "${layer.name}" offset is not contiguous`)
    expectedBytes += layer.byteLength
  }
  check(
    bin.byteLength === expectedBytes,
    `hexgrid.bin: ${bin.byteLength} bytes, manifest describes ${expectedBytes}`,
  )

  const rasterArea = m.inStateCells * m.hexAreaKm2
  const drift = Math.abs(rasterArea - GA_LAND_AREA_KM2) / GA_LAND_AREA_KM2
  check(
    drift < AREA_TOLERANCE,
    `hexgrid: rasterised area ${Math.round(rasterArea).toLocaleString()} km² drifts ` +
      `${(drift * 100).toFixed(1)}% from Georgia's actual land area`,
  )

  for (const gap of m.dataGaps ?? []) warnings.push(`hexgrid: ${gap}`)

  console.log(`hexgrid        ${m.spec.cols}×${m.spec.rows}, ${m.inStateCells.toLocaleString()} in-state cells, ` +
    `${Math.round(rasterArea).toLocaleString()} km² (${(drift * 100).toFixed(1)}% from Census)`)
}

const unverifiedCities = CITIES.filter((c) => !c.verified)
if (unverifiedCities.length > 0) {
  const msg = `cities.ts: ${unverifiedCities.length}/${CITIES.length} records unverified ` +
    `(coordinates and populations entered from memory, pending the M6 accuracy pass)`
  if (STRICT) problems.push(msg)
  else warnings.push(msg)
}

const cityFips = new Set(CITIES.map((c) => c.countyFips))
for (const f of cityFips) {
  check(/^13\d{3}$/.test(f), `cities.ts: ${f} is not a Georgia FIPS code`)
}

for (const s of SCENARIOS) {
  check(/^13\d{3}$/.test(s.contract.countyFips),
    `scenarios.ts: ${s.id} county ${s.contract.countyFips} is not a Georgia FIPS code`)

  if (s.basedOn === 'announced') {
    check(s.sources.length > 0,
      `scenarios.ts: ${s.id} is marked 'announced' but cites no sources`)
    check(s.sourceUrl !== null,
      `scenarios.ts: ${s.id} is marked 'announced' but has no primary sourceUrl`)
    for (const src of s.sources) {
      check(/^https:\/\/\S+$/.test(src.url),
        `scenarios.ts: ${s.id} source "${src.label}" is not an https URL`)
    }
  } else {
    warnings.push(`scenarios.ts: ${s.id} is a projection, not a filed project`)
  }

  if (s.phasing) {
    const total = s.phasing.count * s.phasing.mwEach
    check(total === s.contract.contractedMw,
      `scenarios.ts: ${s.id} phasing totals ${total} MW but the contract is ` +
      `${s.contract.contractedMw} MW`)
  }
}

console.log(`scenarios      ${SCENARIOS.length} defined, ` +
  `${SCENARIOS.filter((s) => s.basedOn === 'announced').length} sourced to real projects`)

const imageryPath = resolve(DATA, 'basemap/imagery.json')
if (existsSync(imageryPath)) {
  const manifest = JSON.parse(readFileSync(imageryPath, 'utf8')) as {
    tiles?: { file: string; bounds: number[] }[]
    license?: string
    attribution?: string
  }
  const tiles = manifest.tiles ?? []
  check(tiles.length > 0, 'basemap: imagery.json lists no tiles')
  check(!!manifest.attribution, 'basemap: imagery.json carries no attribution string')
  for (const tile of tiles) {
    check(existsSync(resolve(DATA, 'basemap', tile.file)),
      `basemap: imagery.json references ${tile.file}, which is not vendored`)
    check(Array.isArray(tile.bounds) && tile.bounds.length === 4
      && tile.bounds[2] > tile.bounds[0] && tile.bounds[3] > tile.bounds[1],
      `basemap: ${tile.file} has degenerate bounds`)
  }
  console.log(`imagery        ${tiles.length} tile(s), ${manifest.license ?? 'unknown'} licence`)
} else {
  warnings.push('basemap: no aerial imagery vendored (run `npm run fetch:imagery`)')
}

const hydroDir = resolve(DATA, 'hydrology')
if (existsSync(hydroDir)) {
  const files = readdirSync(hydroDir).filter((f) => f.endsWith('.json'))
  if (!files.includes('state.json')) {
    warnings.push('hydrology: no statewide rivers (run `npm run fetch:hydrology -- --state`)')
  }
  let ways = 0
  let bodies = 0
  for (const f of files) {
    const bytes = statSync(resolve(hydroDir, f)).size
    const file = JSON.parse(readFileSync(resolve(hydroDir, f), 'utf8')) as {
      waterways?: unknown[]; bodies?: unknown[]; attribution?: string
    }
    const count = (file.waterways?.length ?? 0) + (file.bodies?.length ?? 0)
    ways += file.waterways?.length ?? 0
    bodies += file.bodies?.length ?? 0
    check(!!file.attribution,
      `hydrology/${f}: no attribution: ODbL requires crediting OpenStreetMap contributors`)
    reportTier('hydrology', f, count, 'features', bytes)
  }
  console.log(`hydrology      ${describeTiers(files)}, ${ways.toLocaleString()} watercourses, ` +
    `${bodies.toLocaleString()} water bodies`)
} else {
  warnings.push(
    'hydrology: none vendored: rivers and wetlands are missing from the map AND ' +
    'from the routing cost surface (run `npm run fetch:hydrology -- --state`)',
  )
}

const roadsDir = resolve(DATA, 'roads')
if (existsSync(roadsDir)) {
  const files = readdirSync(roadsDir).filter((f) => f.endsWith('.json'))
  if (!files.includes('state.json')) {
    warnings.push('roads: no statewide highways (run `npm run fetch:roads -- --state`)')
  }

  let totalRoads = 0
  for (const f of files) {
    const bytes = statSync(resolve(roadsDir, f)).size
    const file = JSON.parse(readFileSync(resolve(roadsDir, f), 'utf8')) as {
      roads?: unknown[]; attribution?: string; license?: string
    }
    const count = file.roads?.length ?? 0
    totalRoads += count
    check(!!file.attribution,
      `roads/${f}: no attribution: ODbL requires crediting OpenStreetMap contributors`)
    reportTier('roads', f, count, 'ways', bytes)
  }
  console.log(`roads          ${describeTiers(files)}, ${totalRoads.toLocaleString()} ways total`)
} else {
  warnings.push(
    'roads: none vendored: run `npm run fetch:roads -- --state` for statewide ' +
    'highways, then `-- --county 13261 --name Sumter` for the tutorial county',
  )
}

console.log('')
for (const w of warnings) console.log(`  ! ${w}`)
for (const p of problems) console.error(`  ✗ ${p}`)

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s) found.`)
  process.exit(1)
}
console.log(warnings.length > 0
  ? `\nStructurally sound. ${warnings.length} thing(s) still to verify.`
  : '\nAll data verified.')
