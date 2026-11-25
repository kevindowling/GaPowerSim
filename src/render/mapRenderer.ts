import { PALETTE, PARCEL_LAND, LAND_FILL } from './palette.ts'
import { Camera, type Viewport } from './camera.ts'
import {
  HEX_WIDTH_KM, HEX_ROW_KM, cellCenter, cellCorners,
} from '../engine/geo/hex.ts'
import { OUTSIDE_STATE, type MapData, type StateShape } from '../engine/geo/mapTypes.ts'
import type { Parcel } from '../engine/parcels/types.ts'
import { parcelBox } from '../engine/parcels/takings.ts'
import { LATTICE_KM, latticeParcel } from '../engine/parcels/lattice.ts'
import type { MultiPoly } from '../engine/geo/polygon.ts'
import { ICONS, type IconKey } from './icons.ts'
import { project } from '../engine/geo/projection.ts'
import { CITIES } from '../data/cities.ts'
import type { Gis, Road, Waterway, WaterBody } from '../engine/geo/basemapTypes.ts'
import { LineTiles, AreaTiles, withWorld } from './tiles.ts'
import type { RouteDraft } from '../state/gameStore.ts'

// Zoom thresholds, in px per km.
const HEX_FADE_IN = 9
const HEX_FADE_FULL = 18
const LAND_FADE_IN = 11
const LAND_FADE_FULL = 19
const PARCEL_LINE_FADE_IN = 16
const PARCEL_LINE_FADE_FULL = 34
const IMAGERY_FADE_IN = 10
const IMAGERY_FADE_FULL = 22
const STREAM_FROM = 8
const POND_FROM = 6
const BUILDING_FROM = 22
const STREET_LABEL_FROM = 60

const PARCEL_FILL: Record<ParcelTint, string> = {
  taken: 'rgba(226,132,40,0.55)',
  severed: 'rgba(190,52,84,0.50)',
  offered: 'rgba(31,111,139,0.42)',
  accepted: 'rgba(47,122,77,0.55)',
  holdout: 'rgba(194,39,29,0.55)',
  condemned: 'rgba(110,28,48,0.62)',
  blocked: 'rgba(30,32,30,0.62)',
}

export type Overlay = 'none' | 'population' | 'landValue' | 'approval' | 'air' | 'water'

export type MarkerKind =
  | 'datacenter'
  | 'datacenter-offer'
  | 'datacenter-leaving'
  | 'substation'
  | 'substation-building'
  | 'plant-permitting'
  | 'plant-construction'
  | 'plant-online'
  | 'plant-out'

export interface Marker {
  cell: number
  /** Exact place, projected km. The cell's centre if absent. */
  at?: readonly [number, number]
  kind: MarkerKind
  label: string
  /** Units at this spot. */
  count?: number
  /** 0 to 1, drawn as a progress ring. */
  progress?: number
  icon?: IconKey
}

export interface DataCenterDraw {
  x: number
  y: number
  mw: number | null
  label: string
  stopped: boolean
  selected: boolean
}

function inFlatRing(r: readonly number[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    if ((r[i + 1] > y) !== (r[j + 1] > y)
      && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) inside = !inside
  }
  return inside
}

/** Marker radius in pixels. */
export function dcRadius(mw: number | null): number {
  return mw === null ? 5 : Math.min(17, 5 + Math.sqrt(mw) / 4.5)
}

export interface SubstationDraw { x: number; y: number; kv: number; label: string; from: number; mine: boolean; selected: boolean }

export interface NodeDraw { x: number; y: number; selected: boolean }

const pathCache = new Map<string, Path2D[]>()

function iconPaths(key: IconKey): Path2D[] {
  const cached = pathCache.get(key)
  if (cached) return cached
  const compiled = ICONS[key].paths.map((d) => new Path2D(d))
  pathCache.set(key, compiled)
  return compiled
}

function drawIcon(
  ctx: CanvasRenderingContext2D, key: IconKey,
  cx: number, cy: number, sizePx: number, color: string,
): void {
  const icon = ICONS[key]
  const scale = sizePx / Math.max(icon.width, icon.height)
  ctx.save()
  ctx.translate(cx - (icon.width * scale) / 2, cy - (icon.height * scale) / 2)
  ctx.scale(scale, scale)
  ctx.fillStyle = color
  for (const path of iconPaths(key)) ctx.fill(path)
  ctx.restore()
}

export interface SitingPreview {
  ok: boolean
  cells: readonly number[]
  /** Straight-line reach to the campus, drawn as a guide. */
  toward: [number, number] | null
}

/** Land a sited plant covers. */
export interface FootprintDraw {
  cells: readonly number[]
  selected: boolean
  solar: boolean
  stage: 'permitting' | 'construction' | 'online'
}

export type ParcelTint =
  | 'taken' | 'severed' | 'offered' | 'accepted' | 'holdout' | 'condemned' | 'blocked'

export interface CorridorDraw {
  centerline: Array<[number, number]>
  buffer: MultiPoly
  status: 'planned' | 'acquiring' | 'building' | 'energized'
  /** Share of the rating still available. */
  available: number
  /** Transformers where it meets a data center. */
  gear?: ReadonlyArray<{ atStart: boolean; state: 'missing' | 'ordered' | 'installed'; progress: number }>
}

/** Pixels from a data center to the transformer on its line. */
const GEAR_PX = 42
/** Scale from which a working transformer is drawn. */
const GEAR_FROM = 6

/** Where a line's transformer is drawn, projected km. */
export function gearPoint(
  centerline: ReadonlyArray<readonly [number, number]>, atStart: boolean, pxPerKm: number,
): [number, number] {
  const pts = atStart ? centerline : [...centerline].reverse()
  let left = GEAR_PX / pxPerKm
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]
    const [bx, by] = pts[i]
    const d = Math.hypot(bx - ax, by - ay)
    if (d >= left && d > 0) return [ax + ((bx - ax) * left) / d, ay + ((by - ay) * left) / d]
    left -= d
  }
  // A line shorter than that on screen: the same way, clear of the icon.
  const [ax, ay] = pts[0]
  const [bx, by] = pts[pts.length - 1]
  const d = Math.hypot(bx - ax, by - ay)
  const r = GEAR_PX / pxPerKm
  return d > 1e-9 ? [ax + ((bx - ax) * r) / d, ay + ((by - ay) * r) / d] : [ax + r, ay]
}

export interface RenderOptions {
  overlay: Overlay
  hoverCounty: number
  /** County with its card open. */
  selectedCounty?: string | null
  /** County colours for the approval, air and water layers. */
  countyFill?: Record<string, string>
  /** Assessed streams, on the water layer. */
  streams?: ReadonlyArray<{ status: string; paths: ReadonlyArray<ReadonlyArray<readonly [number, number]>> }>
  showHexes: boolean
  markers?: readonly Marker[]
  dataCenters?: readonly DataCenterDraw[]
  substations?: readonly SubstationDraw[]
  /** Existing line that is selected. */
  pickedLine?: readonly (readonly [number, number])[] | null
  siting?: SitingPreview | null
  parcels?: readonly Parcel[]
  parcelTints?: Record<string, ParcelTint>
  /** Stand-in parcels on the current route. */
  extraParcels?: readonly Parcel[]
  corridors?: readonly CorridorDraw[]
  hoverParcel?: string | null
  storms?: readonly StormDraw[]
  imagery?: ImageryDraw | null
  roads?: readonly Road[]
  showImagery?: boolean
  showRoads?: boolean
  waterways?: readonly Waterway[]
  waterBodies?: readonly WaterBody[]
  showWater?: boolean
  stateGis?: Gis | null
  gis?: Gis | null
  /** Existing lines and substations. */
  showGrid?: boolean
  nodes?: readonly NodeDraw[]
  waypoints?: readonly [number, number][]
  footprints?: readonly FootprintDraw[]
  /** Existing lines that can be tapped, marked while routing. */
  draft?: RouteDraft | null
  tappable?: ReadonlyArray<{ points: readonly (readonly [number, number])[] }>
  /** Ones that cannot carry the next phase. */
  tappableShort?: ReadonlyArray<{ points: readonly (readonly [number, number])[] }>
}

export interface ImageryDraw {
  images: readonly CanvasImageSource[]
  /** Bounds in projected km. */
  tiles: readonly { bounds: [number, number, number, number] }[]
}

export interface StormDraw { x: number; y: number; radiusKm: number; severity: number }

interface CityScreen { name: string; wx: number; wy: number; population: number }

type Box = [number, number, number, number]

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)
  h ^= h >>> 15
  return (Math.imul(h, 0x2c1b3c6d) >>> 0) / 4294967296
}

function shade(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return h >>> 0
}

export function approvalFill(a: number): string {
  return a >= 65 ? 'rgba(36,104,63,0.45)' : a >= 45 ? 'rgba(190,190,120,0.40)'
    : a >= 25 ? 'rgba(214,132,40,0.50)' : 'rgba(179,35,26,0.50)'
}

function landColor(p: Parcel): string {
  const set = PARCEL_LAND[p.archetype]
  return set[shade(p.id) % set.length]
}

export class MapRenderer {
  private terrainRaster: HTMLCanvasElement | null = null
  private overlayRaster: HTMLCanvasElement | null = null
  private overlayKind: Overlay = 'none'
  private cities: CityScreen[]
  private rasterBounds: { x0: number; y0: number; x1: number; y1: number }
  private tiles = new WeakMap<object, LineTiles | AreaTiles>()
  private parcelTiles = new WeakMap<object, Map<string, AreaTiles>>()
  private placed: Box[] = []

  constructor(private readonly data: MapData) {
    const { spec } = data.grid
    this.rasterBounds = {
      x0: spec.originX - HEX_WIDTH_KM / 2,
      y0: spec.originY - HEX_ROW_KM / 2,
      x1: spec.originX + HEX_WIDTH_KM * (spec.cols - 0.5),
      y1: spec.originY + HEX_ROW_KM * (spec.rows - 0.5),
    }
    this.cities = CITIES.map((c) => {
      const [wx, wy] = project(c.lon, c.lat)
      return { name: c.name, wx, wy, population: c.population }
    }).sort((a, b) => b.population - a.population)
  }

  get stateBounds() {
    const [minX, minY, maxX, maxY] = this.data.counties.bbox
    return { minX, minY, maxX, maxY }
  }

  /** Georgia, Alabama and Mississippi. */
  get mapBounds() {
    const b = { ...this.stateBounds }
    for (const s of this.data.states ?? []) {
      if (s.abbr !== 'AL' && s.abbr !== 'MS') continue
      for (const r of s.rings) {
        for (let i = 0; i < r.length; i += 2) {
          b.minX = Math.min(b.minX, r[i]); b.maxX = Math.max(b.maxX, r[i])
          b.minY = Math.min(b.minY, r[i + 1]); b.maxY = Math.max(b.maxY, r[i + 1])
        }
      }
    }
    return b
  }

  private hexToPixel(index: number, spec: { cols: number; rows: number }): number {
    // Grid row 0 is the southern edge; canvas row 0 is the top.
    const row = Math.floor(index / spec.cols)
    const col = index - row * spec.cols
    return ((spec.rows - 1 - row) * spec.cols + col) * 4
  }

  private bakeTerrain(): HTMLCanvasElement {
    const { spec, terrain, county, population } = this.data.grid
    const canvas = document.createElement('canvas')
    canvas.width = spec.cols
    canvas.height = spec.rows
    const ctx = canvas.getContext('2d')!
    const img = ctx.createImageData(spec.cols, spec.rows)
    const px = img.data
    const rgb = PALETTE.terrain.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)))

    for (let i = 0; i < terrain.length; i++) {
      const p = this.hexToPixel(i, spec)
      if (county[i] === OUTSIDE_STATE) {
        px[p + 3] = 0
        continue
      }
      const c = rgb[terrain[i]] ?? rgb[1]
      const row = Math.floor(i / spec.cols)
      const col = i - row * spec.cols
      // Woods and fields in patches a few km across.
      const patch = hash(col >> 2, row >> 2) * 0.6 + hash(col, row) * 0.4
      const wood = (patch - 0.5) * 34
      const town = Math.max(0, population[i] / 255 - 0.25) * 60
      px[p] = c[0] - Math.max(0, wood) * 1.1 - town * 0.4
      px[p + 1] = c[1] - Math.max(0, wood) * 0.35 - town * 0.7
      px[p + 2] = c[2] - Math.abs(wood) * 0.9 - town * 0.3
      px[p + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    return canvas
  }

  private bakeOverlay(kind: Overlay): HTMLCanvasElement | null {
    if (kind !== 'population' && kind !== 'landValue') return null
    const { spec, county, population, landValue } = this.data.grid
    const canvas = document.createElement('canvas')
    canvas.width = spec.cols
    canvas.height = spec.rows
    const ctx = canvas.getContext('2d')!
    const img = ctx.createImageData(spec.cols, spec.rows)
    const px = img.data

    let maxLand = 1
    if (kind === 'landValue') {
      for (let i = 0; i < landValue.length; i++) {
        if (county[i] !== OUTSIDE_STATE && landValue[i] > maxLand) maxLand = landValue[i]
      }
    }

    for (let i = 0; i < county.length; i++) {
      const p = this.hexToPixel(i, spec)
      if (county[i] === OUTSIDE_STATE) {
        px[p + 3] = 0
        continue
      }
      let t: number
      if (kind === 'population') {
        t = population[i] / 255
      } else {
        t = landValue[i] / maxLand
      }
      if (kind === 'population') {
        px[p] = 110; px[p + 1] = 91; px[p + 2] = 158
      } else {
        px[p] = 232; px[p + 1] = 163; px[p + 2] = 61
      }
      px[p + 3] = Math.round(Math.min(1, t ** 0.8) * 205)
    }
    ctx.putImageData(img, 0, 0)
    return canvas
  }

  render(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, opts: RenderOptions): void {
    if (!this.terrainRaster) this.terrainRaster = this.bakeTerrain()
    if (this.overlayKind !== opts.overlay) {
      this.overlayRaster = this.bakeOverlay(opts.overlay)
      this.overlayKind = opts.overlay
    }
    this.placed = []

    const states = this.data.states ?? []
    ctx.fillStyle = states.length > 0 ? PALETTE.sea : PALETTE.outside
    ctx.fillRect(0, 0, vp.width, vp.height)
    this.drawStates(ctx, cam, vp, states)
    this.drawRaster(ctx, cam, vp, this.terrainRaster, 1)

    const landAlpha = smoothstep(LAND_FADE_IN, LAND_FADE_FULL, cam.scale)
    const imageryAlpha = opts.showImagery && opts.imagery
      ? smoothstep(IMAGERY_FADE_IN, IMAGERY_FADE_FULL, cam.scale) : 0

    if (landAlpha > 0.01 && imageryAlpha < 0.99) this.drawLand(ctx, cam, vp, opts, landAlpha)
    if (imageryAlpha > 0.01) this.drawImagery(ctx, cam, vp, opts.imagery!, imageryAlpha)
    this.drawParks(ctx, cam, vp, opts)
    if (this.overlayRaster) this.drawRaster(ctx, cam, vp, this.overlayRaster, 1)

    const hexAlpha = opts.showHexes ? smoothstep(HEX_FADE_IN, HEX_FADE_FULL, cam.scale) : 0
    if (hexAlpha > 0.01) this.drawHexes(ctx, cam, vp, hexAlpha)

    for (const f of opts.footprints ?? []) this.drawFootprint(ctx, cam, vp, f)
    if (opts.showWater !== false) this.drawWater(ctx, cam, vp, opts, imageryAlpha)
    this.drawParcelTints(ctx, cam, vp, opts)
    if (opts.showRoads) this.drawRoads(ctx, cam, vp, opts)
    if (cam.scale > BUILDING_FROM && opts.gis) this.drawBuildings(ctx, cam, vp, opts.gis)
    if (opts.showGrid !== false || opts.tappable?.length || opts.tappableShort?.length) this.drawExistingGrid(ctx, cam, vp, opts)
    this.drawCounties(ctx, cam, vp, opts)
    if (opts.overlay === 'water' && opts.streams?.length) this.drawStreams(ctx, cam, vp, opts.streams)
    if (opts.corridors?.length) this.drawCorridors(ctx, cam, vp, opts.corridors)
    if (opts.siting) this.drawSitingPreview(ctx, cam, vp, opts.siting)
    if (opts.pickedLine) this.drawPicked(ctx, cam, vp, opts.pickedLine)
    if (opts.substations?.length) this.drawSubstations(ctx, cam, vp, opts.substations)
    if (opts.dataCenters?.length) this.drawDataCenters(ctx, cam, vp, opts.dataCenters)
    if (opts.markers?.length) this.drawMarkers(ctx, cam, vp, opts.markers)
    this.drawNodes(ctx, cam, vp, opts)
    if (opts.corridors?.length) this.drawGear(ctx, cam, vp, opts.corridors)
    this.drawStateNames(ctx, cam, vp, states)
    this.drawCities(ctx, cam, vp)
    if (opts.showWater !== false) this.drawWaterLabels(ctx, cam, vp, opts)
    if (opts.showRoads && cam.scale > STREET_LABEL_FROM) this.drawStreetLabels(ctx, cam, vp, opts)
    if (opts.storms?.length) this.drawStorms(ctx, cam, vp, opts.storms)
    if (opts.draft) this.drawDraft(ctx, cam, vp, opts.draft)
  }

  private lineTiles(key: object, make: () => Iterable<readonly (readonly [number, number])[]>, km = 12): LineTiles {
    let t = this.tiles.get(key)
    if (!t) {
      t = new LineTiles(make(), km)
      this.tiles.set(key, t)
    }
    return t as LineTiles
  }

  private areaTiles(key: object, make: () => Iterable<readonly [number, number][]>, km = 12): AreaTiles {
    let t = this.tiles.get(key)
    if (!t) {
      t = new AreaTiles(make(), km)
      this.tiles.set(key, t)
    }
    return t as AreaTiles
  }

  /** Sub-list cache, so a filtered layer keeps one stable key. */
  private subset = new WeakMap<object, Map<string, readonly unknown[]>>()
  private filtered<T>(list: readonly T[], name: string, keep: (t: T) => boolean): readonly T[] {
    let m = this.subset.get(list)
    if (!m) this.subset.set(list, m = new Map())
    let out = m.get(name)
    if (!out) m.set(name, out = list.filter(keep))
    return out as readonly T[]
  }

  private drawStates(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, states: readonly StateShape[]): void {
    const vis = cam.visibleBounds(vp)
    ctx.save()
    ctx.lineJoin = 'round'
    for (const s of states) {
      let seen = false
      ctx.beginPath()
      for (const ring of s.rings) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (let i = 0; i < ring.length; i += 2) {
          minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i])
          minY = Math.min(minY, ring[i + 1]); maxY = Math.max(maxY, ring[i + 1])
        }
        if (maxX < vis.minX || minX > vis.maxX || maxY < vis.minY || minY > vis.maxY) continue
        seen = true
        for (let i = 0; i < ring.length; i += 2) {
          const [px, py] = cam.toScreen(ring[i], ring[i + 1], vp)
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.closePath()
      }
      if (!seen) continue
      ctx.fillStyle = PALETTE.neighbor
      ctx.fill()
      ctx.lineWidth = 1.2
      ctx.strokeStyle = PALETTE.neighborLine
      ctx.stroke()
    }
    ctx.restore()
  }

  /** State names over the part of each state in view. */
  private drawStateNames(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, states: readonly StateShape[]): void {
    if (cam.scale > 6) return
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '650 14px "Public Sans Variable", sans-serif'
    for (const s of states) {
      if (s.abbr === 'GA' || s.rings.length === 0) continue
      let sx = 0, sy = 0, n = 0
      const ring = s.rings[0]
      const vis = cam.visibleBounds(vp)
      const dx = (vis.maxX - vis.minX) / 14
      const dy = (vis.maxY - vis.minY) / 10
      for (let x = vis.minX + dx / 2; x <= vis.maxX; x += dx) {
        for (let y = vis.minY + dy / 2; y <= vis.maxY; y += dy) {
          if (inFlatRing(ring, x, y)) { sx += x; sy += y; n++ }
        }
      }
      if (n < 4) continue
      const [px, py] = cam.toScreen(sx / n, sy / n, vp)
      ctx.lineWidth = 4
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'
      ctx.strokeText(s.name, px, py)
      ctx.fillStyle = PALETTE.inkSoft
      ctx.fillText(s.name, px, py)
    }
    ctx.restore()
  }

  private drawLand(
    ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, opts: RenderOptions, alpha: number,
  ): void {
    ctx.save()
    ctx.globalAlpha = alpha
    const lineAlpha = smoothstep(PARCEL_LINE_FADE_IN, PARCEL_LINE_FADE_FULL, cam.scale)
    this.drawLattice(ctx, cam, vp, opts.parcels?.[0]?.countyFips ?? '', lineAlpha)

    if (opts.parcels?.length) {
      let byColor = this.parcelTiles.get(opts.parcels)
      if (!byColor) {
        const groups = new Map<string, Array<readonly [number, number][]>>()
        for (const p of opts.parcels) {
          const c = landColor(p)
          const g = groups.get(c)
          if (g) g.push(p.poly[0])
          else groups.set(c, [p.poly[0]])
        }
        byColor = new Map([...groups].map(([c, rings]) => [c, new AreaTiles(rings, 6)]))
        this.parcelTiles.set(opts.parcels, byColor)
      }
      withWorld(ctx, cam, vp, () => {
        for (const [color, t] of byColor!) t.fill(ctx, cam.visibleBounds(vp), color)
      })
    }

    if (opts.gis) {
      const gis = opts.gis
      withWorld(ctx, cam, vp, () => {
        for (const kind of Object.keys(LAND_FILL) as Array<keyof typeof LAND_FILL>) {
          const list = this.filtered(gis.land, kind, (l) => l.kind === kind)
          this.areaTiles(list, () => list.map((l) => l.ring), 8)
            .fill(ctx, cam.visibleBounds(vp), LAND_FILL[kind])
        }
      })
    }

    if (lineAlpha > 0.01 && opts.parcels?.length) {
      ctx.globalAlpha = lineAlpha * 0.8
      const parcels = opts.parcels
      withWorld(ctx, cam, vp, () => {
        this.lineTiles(parcels, () => parcels.map((p) => p.poly[0]), 4)
          .stroke(ctx, cam.visibleBounds(vp), 'rgba(84,90,70,0.65)', 0.7 / cam.scale)
      })
    }
    ctx.restore()
  }

  private latticeTiles = new Map<string, { fills: Map<string, Path2D>; lines: Path2D }>()

  /** Generated fields outside the loaded county. */
  private drawLattice(
    ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, covered: string, lineAlpha: number,
  ): void {
    const N = 16
    const size = N * LATTICE_KM
    const vis = cam.visibleBounds(vp)
    withWorld(ctx, cam, vp, () => {
      const alpha = ctx.globalAlpha
      for (let tj = Math.floor(vis.minY / size); tj <= Math.floor(vis.maxY / size); tj++) {
        for (let ti = Math.floor(vis.minX / size); ti <= Math.floor(vis.maxX / size); ti++) {
          const key = `${covered}:${ti},${tj}`
          let tile = this.latticeTiles.get(key)
          if (!tile) this.latticeTiles.set(key, tile = this.buildFields(ti * N, tj * N, N, covered))
          for (const [c, path] of tile.fills) {
            ctx.fillStyle = c
            ctx.fill(path)
          }
          if (lineAlpha > 0.01) {
            ctx.globalAlpha = alpha * lineAlpha * 0.8
            ctx.strokeStyle = 'rgba(84,90,70,0.65)'
            ctx.lineWidth = 0.7 / cam.scale
            ctx.stroke(tile.lines)
            ctx.globalAlpha = alpha
          }
        }
      }
    })
  }

  private buildFields(
    i0: number, j0: number, n: number, covered: string,
  ): { fills: Map<string, Path2D>; lines: Path2D } {
    const fills = new Map<string, Path2D>()
    const lines = new Path2D()
    const { county, population } = this.data.grid
    // Same habit as the loaded county: split the long side, off centre.
    const split = (
      x: number, y: number, w: number, h: number, depth: number, seed: number, set: readonly string[],
    ): void => {
      const roll = hash(seed, depth)
      if (depth > 0 && roll < 0.78) {
        const t = 0.36 + hash(seed, depth + 17) * 0.28
        if (w >= h * (0.8 + hash(seed, depth + 31) * 0.4)) {
          split(x, y, w * t, h, depth - 1, seed * 2 + 1, set)
          split(x + w * t, y, w * (1 - t), h, depth - 1, seed * 2 + 2, set)
        } else {
          split(x, y, w, h * t, depth - 1, seed * 2 + 1, set)
          split(x, y + h * t, w, h * (1 - t), depth - 1, seed * 2 + 2, set)
        }
        return
      }
      const c = this.cellAt(x + w / 2, y + h / 2)
      if (c < 0 || county[c] === OUTSIDE_STATE) return
      const fips = this.data.grid.manifest.counties[county[c]]?.fips
      if (fips === covered) return
      const color = population[c] > 110 ? PARCEL_LAND.homestead[seed & 1]
        : set[Math.floor(hash(seed, 91) * set.length)]
      let path = fills.get(color)
      if (!path) fills.set(color, path = new Path2D())
      path.rect(x, y, w, h)
      lines.rect(x, y, w, h)
    }
    // Blocks of two by two, so owners run together and the grid does not show.
    for (let j = j0; j < j0 + n; j += 2) {
      for (let i = i0; i < i0 + n; i += 2) {
        const p = latticeParcel(this.data.grid, i, j) ?? latticeParcel(this.data.grid, i + 1, j + 1)
        if (!p) continue
        const set = p.archetype === 'timber' ? PARCEL_LAND.timber
          : p.archetype === 'public' ? PARCEL_LAND.public : PARCEL_LAND['row-crop']
        const mixed = hash(i * 7 + 3, j * 13 + 5) < 0.45 ? [...set, ...PARCEL_LAND.timber] : set
        split(i * LATTICE_KM, j * LATTICE_KM, LATTICE_KM * 2, LATTICE_KM * 2, 4, (shade(p.id) & 0xffff) + 1, mixed)
      }
    }
    return { fills, lines }
  }

  private drawParks(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, opts: RenderOptions): void {
    if (!opts.stateGis) return
    const parks = opts.stateGis.parks
    ctx.save()
    ctx.globalAlpha = 0.5
    withWorld(ctx, cam, vp, () => {
      const t = this.areaTiles(parks, () => parks.map((p) => p.ring), 60)
      t.fill(ctx, cam.visibleBounds(vp), PALETTE.park)
      t.stroke(ctx, cam.visibleBounds(vp), PALETTE.parkInk, 1 / cam.scale)
    })
    ctx.restore()
  }

  private drawWater(
    ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, opts: RenderOptions, overPhoto: number,
  ): void {
    const bodies = opts.waterBodies ?? []
    const ways = opts.waterways ?? []
    const vis = cam.visibleBounds(vp)
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.globalAlpha = overPhoto > 0.5 ? 0.5 : 1
    withWorld(ctx, cam, vp, () => {
      if (cam.scale > POND_FROM) {
        const wet = this.filtered(bodies, 'wetland', (b) => b.kind === 'wetland')
        this.areaTiles(wet, () => wet.map((b) => b.ring), 12).fill(ctx, vis, PALETTE.wetland)
      }
      const open = this.filtered(bodies, 'open', (b) => b.kind !== 'wetland')
      const openTiles = this.areaTiles(open, () => open.map((b) => b.ring), 20)
      openTiles.fill(ctx, vis, PALETTE.water)
      if (cam.scale > 12) openTiles.stroke(ctx, vis, PALETTE.waterDeep, 0.8 / cam.scale)

      if (cam.scale > STREAM_FROM) {
        const streams = this.filtered(ways, 'stream', (w) => w.kind === 'stream')
        this.lineTiles(streams, () => streams.map((w) => w.points), 10)
          .stroke(ctx, vis, PALETTE.water, Math.min(2.2, 0.5 + cam.scale / 26) / cam.scale)
      }
      const rivers = this.filtered(ways, 'river', (w) => w.kind === 'river')
      this.lineTiles(rivers, () => rivers.map((w) => w.points), 30)
        .stroke(ctx, vis, PALETTE.waterDeep, Math.min(7, 0.9 + cam.scale / 9) / cam.scale)
    })
    ctx.restore()
  }

  private drawRoads(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, opts: RenderOptions): void {
    const roads = opts.roads ?? []
    const vis = cam.visibleBounds(vp)
    const maxClass = cam.scale < 1.6 ? 0 : cam.scale < 6 ? 1 : cam.scale < 12 ? 2 : cam.scale < 26 ? 3 : 4
    const grow = Math.min(2.2, 0.6 + cam.scale / 45)
    const widths = [3, 2.4, 1.8, 1.4, 0.9].map((w) => w * grow)

    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    withWorld(ctx, cam, vp, () => {
      const layers: Array<{ t: LineTiles; c: number }> = []
      for (let c = maxClass; c >= 0; c--) {
        const list = this.filtered(roads, `c${c}`, (r) => r.cls === c)
        if (list.length > 0) {
          layers.push({ t: this.lineTiles(list, () => list.map((r) => r.points), c <= 1 ? 25 : 8), c })
        }
      }
      if (cam.scale > 3) {
        for (const { t, c } of layers) {
          if (c === 4) continue
          t.stroke(ctx, vis, PALETTE.roadCase, (widths[c] + 1.4) / cam.scale)
        }
      }
      for (const { t, c } of layers) {
        if (c === 4) ctx.setLineDash([3 / cam.scale, 3 / cam.scale])
        t.stroke(ctx, vis, cam.scale > 3 ? PALETTE.road[c] : '#b79a6b', widths[c] / cam.scale)
        ctx.setLineDash([])
      }
      const rail = cam.scale > 6 ? opts.gis?.rail ?? opts.stateGis?.rail : opts.stateGis?.rail
      if (rail && cam.scale > 3) {
        this.lineTiles(rail, () => rail.map((r) => r.points), 25)
          .stroke(ctx, vis, PALETTE.rail, 1.2 / cam.scale)
      }
    })
    ctx.restore()
  }

  private drawBuildings(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, gis: Gis): void {
    const vis = cam.visibleBounds(vp)
    const s = Math.max(2, Math.min(7, cam.scale * 0.022))
    ctx.save()
    ctx.fillStyle = PALETTE.building
    for (const [x, y] of gis.buildings) {
      if (x < vis.minX || x > vis.maxX || y < vis.minY || y > vis.maxY) continue
      const [px, py] = cam.toScreen(x, y, vp)
      ctx.fillRect(px - s / 2, py - s / 2, s, s)
    }
    ctx.fillStyle = PALETTE.church
    for (const [x, y] of gis.churches) {
      if (x < vis.minX || x > vis.maxX || y < vis.minY || y > vis.maxY) continue
      const [px, py] = cam.toScreen(x, y, vp)
      ctx.fillRect(px - s * 0.2, py - s, s * 0.4, s * 2)
      ctx.fillRect(px - s * 0.6, py - s * 0.6, s * 1.2, s * 0.4)
    }
    ctx.restore()
  }

  private drawExistingGrid(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, opts: RenderOptions): void {
    const vis = cam.visibleBounds(vp)
    const local = cam.scale > 8 && opts.gis ? opts.gis : null
    const state = opts.stateGis
    ctx.save()
    ctx.globalAlpha = cam.scale < 2 ? 0.45 : 0.75
    withWorld(ctx, cam, vp, () => {
      if (state) {
        const big = this.filtered(state.power, 'big', (l) => l.kv >= 230)
        this.lineTiles(big, () => big.map((l) => l.points), 40)
          .stroke(ctx, vis, PALETTE.powerExisting, (cam.scale < 3 ? 0.8 : 1.4) / cam.scale)
        if (cam.scale > 4) {
          const mid = this.filtered(state.power, 'mid', (l) => l.kv < 230)
          this.lineTiles(mid, () => mid.map((l) => l.points), 40)
            .stroke(ctx, vis, PALETTE.powerExisting, 0.8 / cam.scale)
        }
      }
      if (local) {
        const low = this.filtered(local.power, 'low', (l) => l.kv < 115)
        this.lineTiles(low, () => low.map((l) => l.points), 12)
          .stroke(ctx, vis, PALETTE.powerExisting, 0.5 / cam.scale)
      }
    })
    if (opts.tappableShort?.length) {
      const lines = opts.tappableShort
      ctx.globalAlpha = 1
      withWorld(ctx, cam, vp, () => {
        this.lineTiles(lines, () => lines.map((l) => l.points), 40).stroke(ctx, vis, '#8a9690', 1.6 / cam.scale)
      })
    }
    if (opts.tappable?.length) {
      const lines = opts.tappable
      ctx.globalAlpha = 1
      ctx.lineCap = 'round'
      withWorld(ctx, cam, vp, () => {
        const t = this.lineTiles(lines, () => lines.map((l) => l.points), 40)
        t.stroke(ctx, vis, PALETTE.halo, 6.5 / cam.scale)
        t.stroke(ctx, vis, '#2f8fb8', 3 / cam.scale)
      })
    }
    if (local) {
      for (const s of local.substations) {
        if (s.x < vis.minX || s.x > vis.maxX || s.y < vis.minY || s.y > vis.maxY) continue
        const [px, py] = cam.toScreen(s.x, s.y, vp)
        ctx.globalAlpha = 1
        ctx.fillStyle = PALETTE.halo
        ctx.strokeStyle = PALETTE.powerExisting
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.rect(px - 3.5, py - 3.5, 7, 7)
        ctx.fill()
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  private drawParcelTints(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, opts: RenderOptions): void {
    const tints = opts.parcelTints ?? {}
    const ids = Object.keys(tints)
    if (ids.length === 0 && !opts.hoverParcel) return
    const vis = cam.visibleBounds(vp)
    ctx.save()
    const draw = (list: readonly Parcel[]): void => {
      for (const p of list) {
        const tint = tints[p.id]
        const hover = p.id === opts.hoverParcel
        if (!tint && !hover) continue
        const b = parcelBox(p)
        if (b[2] < vis.minX || b[0] > vis.maxX || b[3] < vis.minY || b[1] > vis.maxY) continue
        ctx.beginPath()
        for (const [i, [x, y]] of p.poly[0].entries()) {
          const [px, py] = cam.toScreen(x, y, vp)
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.closePath()
        if (tint) {
          ctx.fillStyle = PARCEL_FILL[tint]
          ctx.fill()
        }
        ctx.strokeStyle = hover ? PALETTE.ink : 'rgba(40,30,20,0.45)'
        ctx.lineWidth = hover ? 2.5 : 0.8
        ctx.stroke()
      }
    }
    draw(opts.parcels ?? [])
    draw(opts.extraParcels ?? [])
    ctx.restore()
  }

  private drawCorridors(
    ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, corridors: readonly CorridorDraw[],
  ): void {
    ctx.save()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    for (const c of corridors) {
      const planned = c.status === 'planned'
      const live = c.status === 'energized'
      const down = live && c.available <= 0
      const pts = c.centerline
      if (pts.length < 2) continue

      if (c.buffer.length > 0 && cam.scale > 18) {
        ctx.beginPath()
        for (const poly of c.buffer) {
          for (const ring of poly) {
            for (let i = 0; i < ring.length; i++) {
              const [px, py] = cam.toScreen(ring[i][0], ring[i][1], vp)
              if (i === 0) ctx.moveTo(px, py)
              else ctx.lineTo(px, py)
            }
            ctx.closePath()
          }
        }
        ctx.fillStyle = 'rgba(180,80,43,0.22)'
        ctx.fill()
      }

      const trace = (): void => {
        ctx.beginPath()
        for (let i = 0; i < pts.length; i++) {
          const [px, py] = cam.toScreen(pts[i][0], pts[i][1], vp)
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
      }
      trace()
      ctx.lineWidth = live ? 7 : 5.5
      ctx.strokeStyle = PALETTE.halo
      ctx.stroke()
      trace()
      ctx.lineWidth = live ? 4 : 3
      ctx.strokeStyle = down ? PALETTE.fault : live ? PALETTE.energized : PALETTE.corridor
      if (planned || down) ctx.setLineDash([8, 6])
      else if (c.status === 'acquiring') ctx.setLineDash([2, 6])
      ctx.stroke()
      ctx.setLineDash([])

      if (live && c.available > 0 && c.available < 1) {
        trace()
        ctx.lineWidth = 1.4
        ctx.strokeStyle = PALETTE.fault
        ctx.stroke()
      }
      if (cam.scale > 20) {
        ctx.fillStyle = PALETTE.ink
        for (const [x, y] of pts) {
          const [px, py] = cam.toScreen(x, y, vp)
          ctx.fillRect(px - 1.8, py - 1.8, 3.6, 3.6)
        }
      }
    }
    ctx.restore()
  }

  private drawPicked(
    ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, points: readonly (readonly [number, number])[],
  ): void {
    ctx.save()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()
    points.forEach(([x, y], i) => {
      const [px, py] = cam.toScreen(x, y, vp)
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    })
    ctx.lineWidth = 8
    ctx.strokeStyle = PALETTE.halo
    ctx.stroke()
    ctx.lineWidth = 4
    ctx.strokeStyle = PALETTE.select
    ctx.stroke()
    ctx.restore()
  }

  private drawSubstations(
    ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, list: readonly SubstationDraw[],
  ): void {
    const vis = cam.visibleBounds(vp)
    ctx.save()
    ctx.textBaseline = 'middle'
    for (const s of list) {
      if (cam.scale < s.from || s.x < vis.minX || s.x > vis.maxX || s.y < vis.minY || s.y > vis.maxY) continue
      const [px, py] = cam.toScreen(s.x, s.y, vp)
      const r = s.kv >= 500 ? 6 : s.kv >= 230 ? 5 : 4
      ctx.beginPath()
      ctx.rect(px - r, py - r, r * 2, r * 2)
      ctx.fillStyle = s.mine ? PALETTE.energized : PALETTE.substation
      ctx.fill()
      ctx.lineWidth = s.selected ? 3 : 1.5
      ctx.strokeStyle = s.selected ? PALETTE.select : '#ffffff'
      ctx.stroke()
      if (cam.scale > (s.kv >= 500 ? 9 : 17)) {
        ctx.font = '500 11px "Public Sans Variable", sans-serif'
        ctx.lineWidth = 3
        ctx.strokeStyle = PALETTE.halo
        ctx.strokeText(s.label, px + r + 4, py)
        ctx.fillStyle = PALETTE.inkSoft
        ctx.fillText(s.label, px + r + 4, py)
      }
    }
    ctx.restore()
  }

  private drawStreams(
    ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, list: NonNullable<RenderOptions['streams']>,
  ): void {
    const vis = cam.visibleBounds(vp)
    ctx.save()
    ctx.lineJoin = 'round'
    for (const status of ['notAssessed', 'good', 'impaired']) {
      ctx.beginPath()
      for (const s of list) {
        if (s.status !== status) continue
        for (const path of s.paths) {
          if (!path.some(([x, y]) => x > vis.minX && x < vis.maxX && y > vis.minY && y < vis.maxY)) continue
          path.forEach(([x, y], i) => {
            const [px, py] = cam.toScreen(x, y, vp)
            if (i === 0) ctx.moveTo(px, py)
            else ctx.lineTo(px, py)
          })
        }
      }
      ctx.lineWidth = cam.scale > 6 ? 3 : 1.6
      ctx.strokeStyle = status === 'impaired' ? '#c2481c' : status === 'good' ? '#1c7fb0' : '#8a9690'
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawDataCenters(
    ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, list: readonly DataCenterDraw[],
  ): void {
    const vis = cam.visibleBounds(vp)
    ctx.save()
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    // Biggest first, so small ones stay clickable.
    for (const d of [...list].sort((a, b) => (b.mw ?? 0) - (a.mw ?? 0))) {
      if (d.x < vis.minX || d.x > vis.maxX || d.y < vis.minY || d.y > vis.maxY) continue
      const [px, py] = cam.toScreen(d.x, d.y, vp)
      const r = dcRadius(d.mw)
      ctx.beginPath()
      ctx.arc(px, py, r, 0, Math.PI * 2)
      ctx.globalAlpha = d.stopped ? 0.5 : 0.85
      ctx.fillStyle = d.stopped ? '#ffffff' : d.mw === null ? '#b9aed0' : PALETTE.dataCenter
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.lineWidth = d.selected ? 3 : 1.5
      ctx.strokeStyle = d.selected ? PALETTE.select : d.stopped ? PALETTE.inkSoft : '#ffffff'
      ctx.stroke()
      if (cam.scale > 8 || (cam.scale > 2.6 && (d.mw ?? 0) >= 900)) {
        ctx.font = '600 12px "Public Sans Variable", sans-serif'
        ctx.lineWidth = 3.5
        ctx.strokeStyle = PALETTE.halo
        ctx.strokeText(d.label, px + r + 5, py)
        ctx.fillStyle = PALETTE.ink
        ctx.fillText(d.label, px + r + 5, py)
      }
    }
    ctx.restore()
  }

  private drawMarkers(
    ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, markers: readonly Marker[],
  ): void {
    const vis = cam.visibleBounds(vp)
    ctx.save()
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    for (const m of markers) {
      const [wx, wy] = m.at ?? this.cellCenterOf(m.cell)
      if (wx < vis.minX || wx > vis.maxX || wy < vis.minY || wy > vis.maxY) continue
      const [px, py] = cam.toScreen(wx, wy, vp)

      const offer = m.kind === 'datacenter-offer'
      const trouble = m.kind === 'datacenter-leaving'
      const center = offer || trouble || m.kind === 'datacenter'
      if (center || m.kind === 'substation' || m.kind === 'substation-building') {
        const s = offer ? (cam.scale < 3 ? 11 : 13) : center ? (cam.scale < 3 ? 9 : 12) : 10
        ctx.beginPath()
        ctx.roundRect(px - s, py - s, s * 2, s * 2, 3)
        ctx.fillStyle = offer ? '#ffffff' : trouble ? PALETTE.fault : center ? PALETTE.dataCenter : m.kind === 'substation' ? PALETTE.substation : PALETTE.inkSoft
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = offer ? PALETTE.dataCenter : PALETTE.halo
        ctx.stroke()
        if (m.icon) drawIcon(ctx, m.icon, px, py, s * (offer ? 1.7 : 1.45), offer ? PALETTE.dataCenter : '#ffffff')
        if (trouble) {
          ctx.beginPath()
          ctx.arc(px + s, py - s, 6.5, 0, Math.PI * 2)
          ctx.fillStyle = '#ffffff'
          ctx.fill()
          ctx.lineWidth = 1.5
          ctx.strokeStyle = PALETTE.fault
          ctx.stroke()
          ctx.font = '800 10px "Public Sans Variable", sans-serif'
          ctx.textAlign = 'center'
          ctx.fillStyle = PALETTE.fault
          ctx.fillText('!', px + s, py - s + 0.5)
          ctx.textAlign = 'left'
        }
      } else {
        const online = m.kind === 'plant-online'
        const out = m.kind === 'plant-out'
        const building = m.kind === 'plant-construction'
        const r = 12
        ctx.beginPath()
        ctx.arc(px, py, r, 0, Math.PI * 2)
        ctx.fillStyle = online ? PALETTE.energized : out ? PALETTE.fault : '#ffffff'
        ctx.fill()
        ctx.lineWidth = 2.2
        ctx.strokeStyle = online ? PALETTE.ink : out ? PALETTE.ink : building ? PALETTE.warn : PALETTE.inkSoft
        if (m.kind === 'plant-permitting') ctx.setLineDash([3, 3])
        ctx.stroke()
        ctx.setLineDash([])
        if (m.icon) {
          drawIcon(ctx, m.icon, px, py, r * 1.35,
            out ? '#ffffff' : online ? PALETTE.ink : building ? PALETTE.warn : PALETTE.inkSoft)
        }
        if (building && m.progress) {
          ctx.beginPath()
          ctx.arc(px, py, r + 3.5, -Math.PI / 2, -Math.PI / 2 + m.progress * Math.PI * 2)
          ctx.strokeStyle = PALETTE.warn
          ctx.lineWidth = 2.5
          ctx.stroke()
        }
        if ((m.count ?? 1) > 1) {
          ctx.beginPath()
          ctx.arc(px + r * 0.85, py - r * 0.85, 7.5, 0, Math.PI * 2)
          ctx.fillStyle = PALETTE.ink
          ctx.fill()
          ctx.font = '700 10px "Public Sans Variable", sans-serif'
          ctx.textAlign = 'center'
          ctx.fillStyle = '#ffffff'
          ctx.fillText(String(m.count), px + r * 0.85, py - r * 0.85 + 0.5)
          ctx.textAlign = 'left'
        }
      }

      if (cam.scale > 5) {
        ctx.font = '650 12px "Public Sans Variable", sans-serif'
        const w = ctx.measureText(m.label).width
        ctx.lineWidth = 3.5
        ctx.strokeStyle = PALETTE.halo
        ctx.strokeText(m.label, px + 18, py)
        ctx.fillStyle = PALETTE.ink
        ctx.fillText(m.label, px + 18, py)
        this.placed.push([px - 14, py - 12, px + 20 + w, py + 12])
      } else {
        this.placed.push([px - 14, py - 14, px + 14, py + 14])
      }
    }
    ctx.restore()
  }

  /** Two rings, the sign for a transformer: dashed and cut off if missing, part ringed if ordered, solid if in service. */
  private drawGear(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, corridors: readonly CorridorDraw[]): void {
    ctx.save()
    ctx.lineCap = 'butt'
    for (const c of corridors) {
      for (const g of c.gear ?? []) {
        if (g.state === 'installed' && cam.scale < GEAR_FROM) continue
        const end = g.atStart ? c.centerline[0] : c.centerline[c.centerline.length - 1]
        const at = gearPoint(c.centerline, g.atStart, cam.scale)
        const [ex, ey] = cam.toScreen(end[0], end[1], vp)
        const [px, py] = cam.toScreen(at[0], at[1], vp)
        const color = g.state === 'missing' ? PALETTE.fault : g.state === 'ordered' ? PALETTE.warn : PALETTE.ok
        const r = 15
        if (g.state !== 'installed') {
          // Nothing flows past it yet. Stops short of the icon.
          const k = Math.min(1, 14 / Math.max(1, Math.hypot(ex - px, ey - py)))
          ctx.beginPath()
          ctx.moveTo(px, py)
          ctx.lineTo(ex + (px - ex) * k, ey + (py - ey) * k)
          ctx.lineWidth = 8
          ctx.strokeStyle = '#ffffff'
          ctx.stroke()
          ctx.lineWidth = 2.5
          ctx.setLineDash([3, 4])
          ctx.strokeStyle = color
          ctx.stroke()
          ctx.setLineDash([])
        }
        ctx.beginPath()
        ctx.arc(px, py, r, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.fill()
        ctx.lineWidth = 2.6
        ctx.strokeStyle = g.state === 'ordered' ? '#d9dfda' : color
        if (g.state === 'missing') ctx.setLineDash([4, 3])
        ctx.stroke()
        ctx.setLineDash([])
        if (g.state === 'ordered') {
          ctx.beginPath()
          ctx.arc(px, py, r, -Math.PI / 2, -Math.PI / 2 + Math.max(0.04, g.progress) * Math.PI * 2)
          ctx.strokeStyle = color
          ctx.lineWidth = 3.4
          ctx.stroke()
        }
        // The rings lie along the line.
        const a = Math.atan2(ey - py, ex - px)
        ctx.lineWidth = 2.2
        ctx.strokeStyle = color
        for (const k of [-1, 1]) {
          ctx.beginPath()
          ctx.arc(px + Math.cos(a) * 3.2 * k, py + Math.sin(a) * 3.2 * k, 5.3, 0, Math.PI * 2)
          ctx.stroke()
        }
        this.placed.push([px - r, py - r, px + r, py + r])
      }
    }
    ctx.restore()
  }

  private drawDraft(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, d: RouteDraft): void {
    const color = d.state === 'valid' ? PALETTE.select : d.state === 'invalid' ? PALETTE.fault : PALETTE.ink
    const [px, py] = cam.toScreen(d.at[0], d.at[1], vp)
    ctx.save()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    const pts = d.line ?? (d.from ? [d.from, d.at] : [])
    if (pts.length > 1) {
      const trace = (): void => {
        ctx.beginPath()
        pts.forEach(([x, y], i) => {
          const [sx, sy] = cam.toScreen(x, y, vp)
          if (i === 0) ctx.moveTo(sx, sy)
          else ctx.lineTo(sx, sy)
        })
      }
      trace()
      ctx.lineWidth = 6
      ctx.strokeStyle = PALETTE.halo
      ctx.stroke()
      trace()
      ctx.lineWidth = d.state === 'valid' ? 3.5 : 2.5
      ctx.strokeStyle = color
      if (d.state !== 'valid') ctx.setLineDash([9, 7])
      ctx.stroke()
      ctx.setLineDash([])
    }
    if (d.from) {
      const [sx, sy] = cam.toScreen(d.from[0], d.from[1], vp)
      ctx.beginPath()
      ctx.arc(sx, sy, 6, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = '#ffffff'
      ctx.stroke()
    }

    if (d.state !== 'free') {
      ctx.beginPath()
      ctx.arc(px, py, 22, 0, Math.PI * 2)
      ctx.fillStyle = d.state === 'valid' ? 'rgba(28,101,128,0.28)' : 'rgba(194,39,29,0.25)'
      ctx.fill()
      ctx.lineWidth = 3.5
      ctx.strokeStyle = color
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.arc(px, py, 4, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
    }

    ctx.font = '650 12.5px "Public Sans Variable", sans-serif'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    const w = ctx.measureText(d.label).width + 16
    const bx = Math.max(4, Math.min(vp.width - w - 4, px + (d.state === 'free' ? 14 : 28)))
    const by = Math.max(4, Math.min(vp.height - 28, py - 34))
    ctx.beginPath()
    ctx.roundRect(bx, by, w, 24, 4)
    ctx.fillStyle = d.state === 'free' ? 'rgba(22,36,31,0.88)' : color
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.fillText(d.label, bx + 8, by + 12.5)
    ctx.restore()
  }

  /** Places a line can start or end, shown while routing. */
  private drawNodes(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, opts: RenderOptions): void {
    ctx.save()
    for (const n of opts.nodes ?? []) {
      const [px, py] = cam.toScreen(n.x, n.y, vp)
      ctx.beginPath()
      ctx.arc(px, py, 19, 0, Math.PI * 2)
      ctx.lineWidth = n.selected ? 4 : 2.5
      ctx.strokeStyle = PALETTE.select
      if (!n.selected) ctx.setLineDash([5, 4])
      ctx.stroke()
      ctx.setLineDash([])
    }
    for (const [x, y] of opts.waypoints ?? []) {
      const [px, py] = cam.toScreen(x, y, vp)
      ctx.beginPath()
      ctx.arc(px, py, 5, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.lineWidth = 2.5
      ctx.strokeStyle = PALETTE.select
      ctx.stroke()
    }
    ctx.restore()
  }

  private free(b: Box): boolean {
    return !this.placed.some((p) => b[0] < p[2] && b[2] > p[0] && b[1] < p[3] && b[3] > p[1])
  }

  private drawWaterLabels(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, opts: RenderOptions): void {
    if (cam.scale < 2.2) return
    const vis = cam.visibleBounds(vp)
    const seen = new Set<string>()
    ctx.save()
    ctx.font = 'italic 500 11.5px "Public Sans Variable", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 3
    const put = (name: string, x: number, y: number): void => {
      if (seen.has(name)) return
      const [px, py] = cam.toScreen(x, y, vp)
      const w = ctx.measureText(name).width / 2 + 4
      const box: Box = [px - w, py - 8, px + w, py + 8]
      if (box[0] < 0 || box[2] > vp.width || box[1] < 0 || box[3] > vp.height || !this.free(box)) return
      seen.add(name)
      this.placed.push(box)
      ctx.strokeStyle = PALETTE.halo
      ctx.strokeText(name, px, py)
      ctx.fillStyle = PALETTE.waterInk
      ctx.fillText(name, px, py)
    }
    for (const w of opts.waterways ?? []) {
      if (!w.name || (w.kind === 'stream' && cam.scale < 18)) continue
      const m = w.points[w.points.length >> 1]
      if (m[0] > vis.minX && m[0] < vis.maxX && m[1] > vis.minY && m[1] < vis.maxY) put(w.name, m[0], m[1])
    }
    for (const b of opts.waterBodies ?? []) {
      if (!b.name) continue
      let x = 0, y = 0
      for (const p of b.ring) { x += p[0]; y += p[1] }
      x /= b.ring.length
      y /= b.ring.length
      if (x > vis.minX && x < vis.maxX && y > vis.minY && y < vis.maxY) put(b.name, x, y)
    }
    ctx.restore()
  }

  private drawStreetLabels(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, opts: RenderOptions): void {
    const vis = cam.visibleBounds(vp)
    const seen = new Set<string>()
    ctx.save()
    ctx.font = '500 10.5px "Public Sans Variable", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const r of opts.roads ?? []) {
      if (!r.name || r.points.length < 2 || seen.has(r.name)) continue
      const k = r.points.length >> 1
      const [ax, ay] = r.points[k - 1]
      const [bx, by] = r.points[k]
      const mx = (ax + bx) / 2
      const my = (ay + by) / 2
      if (mx < vis.minX || mx > vis.maxX || my < vis.minY || my > vis.maxY) continue
      const [px, py] = cam.toScreen(mx, my, vp)
      const half = ctx.measureText(r.name).width / 2 + 3
      let angle = Math.atan2(-(by - ay), bx - ax)
      if (angle > Math.PI / 2) angle -= Math.PI
      if (angle < -Math.PI / 2) angle += Math.PI
      const hw = Math.abs(Math.cos(angle)) * half + 6
      const hh = Math.abs(Math.sin(angle)) * half + 6
      const box: Box = [px - hw, py - hh, px + hw, py + hh]
      if (!this.free(box)) continue
      seen.add(r.name)
      this.placed.push(box)
      ctx.save()
      ctx.translate(px, py)
      ctx.rotate(angle)
      ctx.lineWidth = 3
      ctx.strokeStyle = PALETTE.halo
      ctx.strokeText(r.name, 0, 0)
      ctx.fillStyle = PALETTE.inkSoft
      ctx.fillText(r.name, 0, 0)
      ctx.restore()
    }
    ctx.restore()
  }

  private drawStorms(
    ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, storms: readonly StormDraw[],
  ): void {
    ctx.save()
    for (const storm of storms) {
      const [px, py] = cam.toScreen(storm.x, storm.y, vp)
      const r = Math.max(6, storm.radiusKm * cam.scale)
      const gradient = ctx.createRadialGradient(px, py, 0, px, py, r)
      const alpha = 0.16 + 0.30 * storm.severity
      gradient.addColorStop(0, `rgba(74,109,138,${alpha})`)
      gradient.addColorStop(0.65, `rgba(74,109,138,${alpha * 0.5})`)
      gradient.addColorStop(1, 'rgba(74,109,138,0)')
      ctx.beginPath()
      ctx.arc(px, py, r, 0, Math.PI * 2)
      ctx.fillStyle = gradient
      ctx.fill()

      if (storm.severity > 0.6) {
        ctx.beginPath()
        ctx.arc(px, py, r * 0.55, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(74,109,138,${0.4 * storm.severity})`
        ctx.lineWidth = 1.5
        ctx.setLineDash([4, 4])
        ctx.stroke()
        ctx.setLineDash([])
      }
    }
    ctx.restore()
  }

  private traceCells(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, cells: readonly number[]): void {
    const { spec } = this.data.grid
    ctx.beginPath()
    for (const cell of cells) {
      const row = Math.floor(cell / spec.cols)
      const pts = cellCorners(spec, cell - row * spec.cols, row)
      for (let i = 0; i < 6; i++) {
        const [px, py] = cam.toScreen(pts[i * 2], pts[i * 2 + 1], vp)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
    }
  }

  private panels: HTMLCanvasElement | null = null

  /** Rows of panels on grass, one tile. */
  private panelTile(): HTMLCanvasElement {
    if (this.panels) return this.panels
    const c = document.createElement('canvas')
    c.width = 48
    c.height = 24
    const x = c.getContext('2d')!
    x.fillStyle = '#93ab78'
    x.fillRect(0, 0, 48, 24)
    x.fillStyle = '#2b4470'
    x.fillRect(0, 4, 44, 12)
    x.fillStyle = '#4a69a0'
    x.fillRect(0, 4, 44, 2)
    x.fillStyle = '#93ab78'
    for (let i = 14; i < 44; i += 15) x.fillRect(i, 4, 1, 12)
    this.panels = c
    return c
  }

  private drawFootprint(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, f: FootprintDraw): void {
    ctx.save()
    if (f.solar) {
      this.traceCells(ctx, cam, vp, f.cells)
      if (f.stage === 'online') {
        const pattern = ctx.createPattern(this.panelTile(), 'repeat')
        if (pattern) {
          // A row is about 60 m, so the rows move with the map.
          const [ox, oy] = cam.toScreen(0, 0, vp)
          const k = (0.12 * cam.scale) / 24
          pattern.setTransform(new DOMMatrix([k, 0, 0, k, ox, oy]))
          ctx.fillStyle = pattern
          ctx.fill()
        }
      } else {
        ctx.fillStyle = f.stage === 'construction' ? 'rgba(176,140,92,0.62)' : 'rgba(60,90,140,0.13)'
        ctx.fill()
      }
    } else if (f.selected) {
      this.traceCells(ctx, cam, vp, f.cells)
      ctx.fillStyle = 'rgba(28,101,128,0.16)'
      ctx.fill()
    }
    this.traceOutline(ctx, cam, vp, f.cells)
    ctx.lineJoin = 'round'
    ctx.lineWidth = f.selected ? 3 : 1.6
    ctx.strokeStyle = f.selected ? PALETTE.select : '#2b4470'
    if (f.stage === 'permitting') ctx.setLineDash([6, 4])
    ctx.stroke()
    ctx.restore()
  }

  /** The outer edge of a group of cells. */
  private traceOutline(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, cells: readonly number[]): void {
    const { spec } = this.data.grid
    const own = new Set(cells)
    ctx.beginPath()
    for (const cell of cells) {
      const row = Math.floor(cell / spec.cols)
      const [cx, cy] = cellCenter(spec, cell - row * spec.cols, row)
      const p = cellCorners(spec, cell - row * spec.cols, row)
      for (let i = 0; i < 6; i++) {
        const j = (i + 1) % 6
        const mx = (p[i * 2] + p[j * 2]) / 2
        const my = (p[i * 2 + 1] + p[j * 2 + 1]) / 2
        if (own.has(this.cellAt(2 * mx - cx, 2 * my - cy))) continue
        const [ax, ay] = cam.toScreen(p[i * 2], p[i * 2 + 1], vp)
        const [bx, by] = cam.toScreen(p[j * 2], p[j * 2 + 1], vp)
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
      }
    }
  }

  private drawSitingPreview(
    ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, s: SitingPreview,
  ): void {
    ctx.save()
    this.traceCells(ctx, cam, vp, s.cells)
    ctx.fillStyle = s.ok ? 'rgba(47,122,77,0.30)' : 'rgba(194,39,29,0.30)'
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = s.ok ? PALETTE.ok : PALETTE.fault
    ctx.stroke()
    if (s.ok && s.toward && s.cells.length > 0) {
      const [ax, ay] = this.cellCenterOf(s.cells[0])
      const [px, py] = cam.toScreen(ax, ay, vp)
      const [qx, qy] = cam.toScreen(s.toward[0], s.toward[1], vp)
      const km = Math.hypot(ax - s.toward[0], ay - s.toward[1])
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(qx, qy)
      ctx.setLineDash([4, 5])
      ctx.lineWidth = 1.5
      ctx.strokeStyle = PALETTE.inkSoft
      ctx.stroke()
      ctx.setLineDash([])
      ctx.font = '650 12px "Public Sans Variable", sans-serif'
      ctx.textAlign = 'center'
      ctx.lineWidth = 3.5
      ctx.strokeStyle = PALETTE.halo
      const label = `${km.toFixed(0)} km to campus`
      ctx.strokeText(label, (px + qx) / 2, (py + qy) / 2 - 6)
      ctx.fillStyle = PALETTE.ink
      ctx.fillText(label, (px + qx) / 2, (py + qy) / 2 - 6)
    }
    ctx.restore()
  }

  private drawImagery(
    ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport,
    imagery: ImageryDraw, alpha: number,
  ): void {
    const vis = cam.visibleBounds(vp)
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    for (let i = 0; i < imagery.tiles.length; i++) {
      const [minX, minY, maxX, maxY] = imagery.tiles[i].bounds
      if (maxX < vis.minX || minX > vis.maxX || maxY < vis.minY || minY > vis.maxY) continue
      const [sx, sy] = cam.toScreen(minX, maxY, vp)
      ctx.drawImage(
        imagery.images[i], sx, sy,
        (maxX - minX) * cam.scale, (maxY - minY) * cam.scale,
      )
    }
    ctx.restore()
  }

  private drawRaster(
    ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport,
    raster: HTMLCanvasElement, alpha: number,
  ): void {
    const { x0, y0, x1, y1 } = this.rasterBounds
    const [sx, sy] = cam.toScreen(x0, y1, vp)
    const w = (x1 - x0) * cam.scale
    const h = (y1 - y0) * cam.scale
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.imageSmoothingEnabled = cam.scale < HEX_FADE_FULL
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(raster, sx, sy, w, h)
    ctx.restore()
  }

  private drawHexes(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, alpha: number): void {
    const { spec, county } = this.data.grid
    const vis = cam.visibleBounds(vp)
    const colStart = Math.max(0, Math.floor((vis.minX - spec.originX) / HEX_WIDTH_KM) - 1)
    const colEnd = Math.min(spec.cols - 1, Math.ceil((vis.maxX - spec.originX) / HEX_WIDTH_KM) + 1)
    const rowStart = Math.max(0, Math.floor((vis.minY - spec.originY) / HEX_ROW_KM) - 1)
    const rowEnd = Math.min(spec.rows - 1, Math.ceil((vis.maxY - spec.originY) / HEX_ROW_KM) + 1)

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.strokeStyle = PALETTE.hexLine
    ctx.lineWidth = Math.min(1, 0.06 * cam.scale)
    ctx.beginPath()
    for (let row = rowStart; row <= rowEnd; row++) {
      for (let col = colStart; col <= colEnd; col++) {
        if (county[row * spec.cols + col] === OUTSIDE_STATE) continue
        const pts = cellCorners(spec, col, row)
        for (let i = 0; i < 6; i++) {
          const [px, py] = cam.toScreen(pts[i * 2], pts[i * 2 + 1], vp)
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.closePath()
      }
    }
    ctx.stroke()
    ctx.restore()
  }

  private drawCounties(
    ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, opts: RenderOptions,
  ): void {
    const hoverCounty = opts.hoverCounty
    const vis = cam.visibleBounds(vp)
    const counties = this.data.counties.counties

    ctx.save()
    ctx.lineJoin = 'round'
    ctx.strokeStyle = PALETTE.countyLine
    ctx.lineWidth = Math.max(0.6, Math.min(1.6, cam.scale * 0.05))

    for (let ci = 0; ci < counties.length; ci++) {
      const c = counties[ci]
      ctx.beginPath()
      let anyVisible = false
      for (const poly of c.polygons) {
        for (const ring of poly) {
          let rMinX = Infinity, rMaxX = -Infinity, rMinY = Infinity, rMaxY = -Infinity
          for (let i = 0; i < ring.length; i += 2) {
            if (ring[i] < rMinX) rMinX = ring[i]
            if (ring[i] > rMaxX) rMaxX = ring[i]
            if (ring[i + 1] < rMinY) rMinY = ring[i + 1]
            if (ring[i + 1] > rMaxY) rMaxY = ring[i + 1]
          }
          if (rMaxX < vis.minX || rMinX > vis.maxX || rMaxY < vis.minY || rMinY > vis.maxY) continue
          anyVisible = true

          for (let i = 0; i < ring.length; i += 2) {
            const [px, py] = cam.toScreen(ring[i], ring[i + 1], vp)
            if (i === 0) ctx.moveTo(px, py)
            else ctx.lineTo(px, py)
          }
          ctx.closePath()
        }
      }
      if (!anyVisible) continue

      const fill = opts.countyFill?.[c.fips]
      if (fill !== undefined) {
        ctx.fillStyle = fill
        ctx.fill()
      }
      const picked = c.fips === opts.selectedCounty
      if (ci === hoverCounty || picked) {
        ctx.fillStyle = picked ? 'rgba(28,101,128,0.12)' : 'rgba(28,101,128,0.05)'
        ctx.fill()
        ctx.save()
        ctx.strokeStyle = PALETTE.select
        ctx.lineWidth = Math.max(1.4, Math.min(3, cam.scale * 0.09))
        ctx.stroke()
        ctx.restore()
      } else {
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  private drawCities(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport): void {
    const vis = cam.visibleBounds(vp)
    const minPop = cam.scale < 1.4 ? 60_000
      : cam.scale < 3 ? 15_000
      : cam.scale < 8 ? 3_000
      : cam.scale < 20 ? 800
      : 0

    ctx.save()
    ctx.textBaseline = 'middle'

    const placed = this.placed
    const overlaps = (a: Box): boolean => !this.free(a)

    const CANDIDATES: ReadonlyArray<readonly [number, number, CanvasTextAlign]> = [
      [1, 0, 'left'], [-1, 0, 'right'], [0, -1, 'center'], [0, 1, 'center'],
    ]

    for (const c of this.cities) {
      if (c.population < minPop) continue
      if (c.wx < vis.minX || c.wx > vis.maxX || c.wy < vis.minY || c.wy > vis.maxY) continue
      const [px, py] = cam.toScreen(c.wx, c.wy, vp)

      const r = c.population > 100_000 ? 4.2 : c.population > 20_000 ? 3.2 : 2.3
      const size = c.population > 100_000 ? 13 : c.population > 20_000 ? 12 : 11
      ctx.font = `${c.population > 100_000 ? 600 : 500} ${size}px "Public Sans Variable", sans-serif`
      const w = ctx.measureText(c.name).width
      const h = size + 2
      const gap = r + 4

      let box: [number, number, number, number] | null = null
      let tx = 0
      let ty = 0
      let align: CanvasTextAlign = 'left'
      for (const [dx, dy, a] of CANDIDATES) {
        const cx = px + dx * (gap + (a === 'center' ? 0 : 0))
        const cy = py + dy * (gap + h / 2)
        const left = a === 'left' ? cx : a === 'right' ? cx - w : cx - w / 2
        const cand: [number, number, number, number] = [left - 2, cy - h / 2, left + w + 2, cy + h / 2]
        if (!overlaps(cand)) {
          box = cand
          tx = cx
          ty = cy
          align = a
          break
        }
      }

      ctx.beginPath()
      ctx.arc(px, py, r, 0, Math.PI * 2)
      ctx.fillStyle = PALETTE.ink
      ctx.fill()
      ctx.lineWidth = 1.6
      ctx.strokeStyle = PALETTE.halo
      ctx.stroke()

      if (!box) continue
      placed.push(box)
      placed.push([px - r - 1, py - r - 1, px + r + 1, py + r + 1])

      ctx.textAlign = align
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(242,239,230,0.92)'
      ctx.strokeText(c.name, tx, ty)
      ctx.fillStyle = PALETTE.ink
      ctx.fillText(c.name, tx, ty)
    }
    ctx.restore()
  }

  countyAt(wx: number, wy: number): number {
    const { spec, county } = this.data.grid
    const row = Math.round((wy - spec.originY) / HEX_ROW_KM)
    if (row < 0 || row >= spec.rows) return -1
    const col = Math.round((wx - spec.originX) / HEX_WIDTH_KM - 0.5 * (row & 1))
    if (col < 0 || col >= spec.cols) return -1
    const v = county[row * spec.cols + col]
    return v === OUTSIDE_STATE ? -1 : v
  }

  cellAt(wx: number, wy: number): number {
    const { spec } = this.data.grid
    const row = Math.round((wy - spec.originY) / HEX_ROW_KM)
    if (row < 0 || row >= spec.rows) return -1
    const col = Math.round((wx - spec.originX) / HEX_WIDTH_KM - 0.5 * (row & 1))
    if (col < 0 || col >= spec.cols) return -1
    return row * spec.cols + col
  }

  cellCenterOf(index: number): [number, number] {
    const { spec } = this.data.grid
    const row = Math.floor(index / spec.cols)
    return cellCenter(spec, index - row * spec.cols, row)
  }

}
