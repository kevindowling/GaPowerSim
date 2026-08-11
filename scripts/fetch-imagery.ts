/**
 * fetch-imagery.ts — aerial photography for a scenario's study area.
 *
 * The point is not decoration. Once a player is choosing between two corridor
 * routes a hundred metres apart, the difference between them is a treeline, a
 * centre pivot, a house set back from the road — things a terrain raster cannot
 * show and a parcel outline only implies. Aerial imagery is what makes "this
 * route cuts the farm in half" legible before the takings table says so.
 *
 * SOURCE. Default is USDA NAIP, which is **public domain** — federal imagery,
 * no licence fee, no attribution requirement (we credit it anyway). That choice
 * is deliberate: commercial basemaps (Esri, Google, Mapbox) forbid exactly what
 * this project does, which is cache tiles and ship them inside a static build.
 *
 * Two ways to run this:
 *
 *   npm run fetch:imagery -- --scenario americus-400
 *       Pulls a NAIP export for the scenario's study area. Needs outbound
 *       network to the USDA/USGS imagery service.
 *
 *   npm run fetch:imagery -- --scenario americus-400 --file <image> \
 *       --bounds <minLon,minLat,maxLon,maxLat>
 *       Uses an image you exported elsewhere. Use this when egress is blocked.
 *       The image must already be in lon/lat (EPSG:4326) with the given corner
 *       bounds — that is what a plain QGIS or gdal_translate export gives you.
 *
 * Output: public/data/basemap/, committed. Nothing is fetched at runtime.
 *
 * THE SKEW PROBLEM, and why this tiles. The game draws in an Albers equal-area
 * projection, and a lon/lat rectangle is not a rectangle in Albers — the top
 * edge is shorter than the bottom and the quad rotates off axis. Measured over
 * a 0.5-degree study area at Americus that departure is about 1% of the width,
 * roughly 490 m on the ground. Blitting such an image axis-aligned would put
 * the photo half a kilometre off the parcels it exists to explain, which is
 * worse than having no imagery at all, because it looks authoritative.
 *
 * Subdividing does not fix this. The skew is mostly an angular property — the
 * convergence of the meridians at this longitude — so it converges to a floor
 * rather than to zero: measured here, shrinking the extent sixteenfold takes it
 * only from 1.05% to 0.79% of width. No tile size makes an axis-aligned blit
 * correct. It only shrinks the residual, and getting 490 m down under 20 m
 * would take a 32x32 grid — a thousand requests to avoid asking the right
 * question.
 *
 * So the imagery is warped instead of tiled. The NAIP service is asked to return
 * the image already in the game's Albers projection via `imageSR`, which makes
 * it axis-aligned in world space by construction, with no residual skew at all.
 * The skew check remains as a guard on the --file path, where somebody may hand
 * us a plain lon/lat export.
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync, copyFileSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { project } from '../src/engine/geo/projection.ts'
import { IMAGERY_VERSION, type ImageryManifest, type ImageryTile } from '../src/engine/geo/basemapTypes.ts'
import { SCENARIOS } from '../src/data/scenarios.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const OUT_DIR = resolve(ROOT, 'public/data/basemap')

/** Half-width of the study area around the campus, in degrees (~28 km). */
const STUDY_HALF_DEG = 0.25

const NAIP_SERVICE = process.env.NAIP_URL
  ?? 'https://gis.apfo.usda.gov/arcgis/rest/services/NAIP/USDA_CONUS_PRIME/ImageServer/exportImage'

interface Args {
  scenario: string
  file: string | null
  bounds: [number, number, number, number] | null
  pixels: number
  /** Projection the supplied --bounds are expressed in. */
  srs: 'latlon' | 'albers'
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let scenario = ''
  let file: string | null = null
  let bounds: [number, number, number, number] | null = null
  let pixels = 4096
  let srs: 'latlon' | 'albers' = 'latlon'
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--scenario') scenario = argv[++i] ?? ''
    else if (argv[i] === '--file') file = argv[++i] ?? null
    else if (argv[i] === '--pixels') pixels = Number(argv[++i])
    else if (argv[i] === '--srs') {
      const v = argv[++i]
      if (v !== 'latlon' && v !== 'albers') {
        console.error('--srs must be latlon or albers')
        process.exit(1)
      }
      srs = v
    }
    else if (argv[i] === '--bounds') {
      const parts = (argv[++i] ?? '').split(',').map(Number)
      if (parts.length !== 4 || parts.some(Number.isNaN)) {
        console.error('--bounds must be minLon,minLat,maxLon,maxLat')
        process.exit(1)
      }
      bounds = parts as [number, number, number, number]
    }
  }
  if (!scenario) {
    console.error(
      'Usage: fetch:imagery -- --scenario <id> [--file <image> --bounds <a,b,c,d> --srs latlon|albers] [--pixels N]',
    )
    process.exit(1)
  }
  return { scenario, file, bounds, pixels, srs }
}

/**
 * Project the four corners and report how far the result is from an
 * axis-aligned rectangle, as a fraction of the quad's width.
 */
export function skewOf(b: [number, number, number, number]): number {
  const [minLon, minLat, maxLon, maxLat] = b
  const sw = project(minLon, minLat)
  const se = project(maxLon, minLat)
  const nw = project(minLon, maxLat)
  const ne = project(maxLon, maxLat)

  const width = Math.max(Math.abs(se[0] - sw[0]), Math.abs(ne[0] - nw[0]))
  if (width === 0) return Infinity

  // Two ways this quad can fail to be a rectangle: the horizontals disagree in
  // y (rotation), and the verticals disagree in x (convergence of meridians).
  const rotation = Math.max(Math.abs(se[1] - sw[1]), Math.abs(ne[1] - nw[1]))
  const convergence = Math.max(Math.abs(nw[0] - sw[0]), Math.abs(ne[0] - se[0]))
  return Math.max(rotation, convergence) / width
}

/** Projected axis-aligned bounds of a lon/lat box, using the extreme corners. */
function projectedBounds(b: [number, number, number, number]): [number, number, number, number] {
  const [minLon, minLat, maxLon, maxLat] = b
  const corners = [
    project(minLon, minLat), project(maxLon, minLat),
    project(minLon, maxLat), project(maxLon, maxLat),
  ]
  const xs = corners.map((c) => c[0])
  const ys = corners.map((c) => c[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/**
 * The same departure expressed in metres on the ground, which is the number
 * that actually decides whether a player sees the photo sitting off the
 * parcels. The ratio alone is misleading: it does not change with tile size.
 */
export function skewMetresOf(b: [number, number, number, number]): number {
  const pb = projectedBounds(b)
  return skewOf(b) * (pb[2] - pb[0]) * 1000
}

/**
 * How far the photo may sit from the ground truth beneath it.
 *
 * 20 m is under the 23 m right-of-way half-width of a 230 kV line, so an error
 * at this scale cannot make a corridor look like it misses a building it
 * actually clips. It is also about a pixel at the zoom where imagery fades in.
 */
const MAX_SKEW_M = 20

/**
 * The game's projection as an ArcGIS spatial reference, so the imagery server
 * can warp NAIP into it directly.
 *
 * These parameters must track src/engine/geo/projection.ts exactly — a mismatch
 * would misregister every pixel. Units are metres here because that is what
 * ArcGIS expects; the projected bounds are converted from the game's kilometres
 * on the way in and back on the way out.
 */
const GAME_SR_WKT =
  'PROJCS["GaPowerSim_Albers",' +
  'GEOGCS["GCS_Sphere_GaPowerSim",' +
  'DATUM["D_Sphere",SPHEROID["Sphere",6371008.8,0.0]],' +
  'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],' +
  'PROJECTION["Albers"],' +
  'PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],' +
  'PARAMETER["Central_Meridian",-83.5],' +
  'PARAMETER["Standard_Parallel_1",31.5],PARAMETER["Standard_Parallel_2",34.5],' +
  'PARAMETER["Latitude_Of_Origin",32.5],' +
  'UNIT["Meter",1.0]]'

async function fetchNaip(
  b: [number, number, number, number], pixels: number,
): Promise<Buffer> {
  // bbox and imageSR are both the game's projection, in metres, so the service
  // warps NAIP for us and the result needs no correction here.
  const pb = projectedBounds(b).map((v) => v * 1000)
  const params = new URLSearchParams({
    bbox: pb.join(','),
    bboxSR: GAME_SR_WKT,
    imageSR: GAME_SR_WKT,
    size: `${pixels},${pixels}`,
    format: 'jpg',
    f: 'image',
  })
  const url = `${NAIP_SERVICE}?${params}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(
      `NAIP service returned ${res.status}. If this environment blocks egress, ` +
      `export the imagery elsewhere and re-run with --file and --bounds.`,
    )
  }
  const type = res.headers.get('content-type') ?? ''
  if (!type.startsWith('image/')) {
    throw new Error(`Expected an image, got ${type}. The service may have returned an error document.`)
  }
  return Buffer.from(await res.arrayBuffer())
}

/** Pixel dimensions from a JPEG or PNG header, without pulling in a decoder. */
function imageSize(buf: Buffer): { width: number; height: number } {
  // PNG: IHDR width/height at bytes 16..24.
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  // JPEG: walk the segments to a start-of-frame marker.
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue }
      const marker = buf[i + 1]
      const len = buf.readUInt16BE(i + 2)
      // SOF0..SOF15, excluding the non-frame markers in that range.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
      }
      i += 2 + len
    }
  }
  throw new Error('Could not read image dimensions — expected a JPEG or PNG.')
}

async function main(): Promise<void> {
  const args = parseArgs()
  const scenario = SCENARIOS.find((s) => s.id === args.scenario)
  if (!scenario) {
    console.error(`Unknown scenario "${args.scenario}". Known: ${SCENARIOS.map((s) => s.id).join(', ')}`)
    process.exit(1)
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const outName = `${scenario.id}.jpg`
  const outPath = resolve(OUT_DIR, outName)

  let buf: Buffer
  let projected: [number, number, number, number]
  let source: string
  let license: string
  let attribution: string

  if (args.file) {
    if (!existsSync(args.file)) {
      console.error(`No such file: ${args.file}`)
      process.exit(1)
    }
    if (!args.bounds) {
      console.error('--file requires --bounds, so the image can be georeferenced.')
      process.exit(1)
    }

    if (args.srs === 'albers') {
      // Already warped into the game's projection; bounds are projected km.
      projected = args.bounds
    } else {
      const metres = skewMetresOf(args.bounds)
      if (metres > MAX_SKEW_M) {
        console.error(
          `Refusing to vendor this image.\n\n` +
          `Its lon/lat extent projects ${metres.toFixed(0)} m away from an ` +
          `axis-aligned rectangle (limit ${MAX_SKEW_M} m). Drawn as-is, the photo ` +
          `would sit that far off the parcels it exists to explain.\n\n` +
          `Fix it by warping to the game's projection, then passing projected ` +
          `kilometres:\n\n` +
          `  gdalwarp -t_srs "+proj=aea +lat_1=31.5 +lat_2=34.5 +lat_0=32.5 ` +
          `+lon_0=-83.5 +R=6371008.8 +units=km" in.tif out.tif\n` +
          `  npm run fetch:imagery -- --scenario ${scenario.id} --file out.tif ` +
          `--srs albers --bounds <minX,minY,maxX,maxY>\n`,
        )
        process.exit(1)
      }
      projected = projectedBounds(args.bounds)
    }

    buf = readFileSync(args.file)
    copyFileSync(args.file, outPath)
    source = `Local export (${basename(args.file)}, ${args.srs})`
    license = 'unknown'
    attribution = 'Aerial imagery: see source'
  } else {
    const { lon, lat } = scenario.contract.site
    const extent: [number, number, number, number] = args.bounds ?? [
      lon - STUDY_HALF_DEG, lat - STUDY_HALF_DEG,
      lon + STUDY_HALF_DEG, lat + STUDY_HALF_DEG,
    ]
    // The service returns the image already in the game's projection, so the
    // projected bounds of the request are the bounds of the image.
    projected = projectedBounds(extent)
    buf = await fetchNaip(extent, args.pixels)
    writeFileSync(outPath, buf)
    source = `USDA NAIP, warped to the game projection (${NAIP_SERVICE})`
    license = 'public-domain'
    attribution = 'Aerial imagery: USDA NAIP (public domain)'
  }

  const { width, height } = imageSize(buf)
  const tile: ImageryTile = {
    file: outName,
    bounds: projected.map((v) => Math.round(v * 1e4) / 1e4) as [number, number, number, number],
    widthPx: width,
    heightPx: height,
    metresPerPixel: Math.round(((projected[2] - projected[0]) * 1000 / width) * 100) / 100,
  }

  const manifest: ImageryManifest = {
    version: IMAGERY_VERSION,
    source,
    attribution,
    license,
    capturedYear: null,
    tiles: [tile],
  }
  writeFileSync(resolve(OUT_DIR, 'imagery.json'), JSON.stringify(manifest, null, 2))

  console.log(
    `${outPath}\n` +
    `  ${width}x${height} px - ${(buf.length / 1024 / 1024).toFixed(1)} MB\n` +
    `  ${tile.metresPerPixel.toFixed(2)} m/px over ` +
    `${(projected[2] - projected[0]).toFixed(1)}x${(projected[3] - projected[1]).toFixed(1)} km\n` +
    `  ${license} - ${attribution}`,
  )
}

// Only run when invoked directly, so the skew check can be unit tested.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
