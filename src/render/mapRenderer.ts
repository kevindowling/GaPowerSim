/**
 * Canvas 2D map renderer.
 *
 * Level of detail is the whole trick here. Georgia is 152,000 hex cells; drawing
 * them as polygons every frame at statewide zoom would be pointless as well as
 * slow, since each cell would be under a pixel. So terrain is baked once into a
 * cols×rows raster and blitted as a single image, county outlines are drawn as
 * vectors on top, and actual hexagons only appear once a cell is big enough on
 * screen to be worth seeing.
 */

import { PALETTE } from './palette.ts'
import { Camera, type Viewport } from './camera.ts'
import {
  HEX_WIDTH_KM, HEX_ROW_KM, HEX_SIZE_KM, cellCenter, cellCorners,
} from '../engine/geo/hex.ts'
import { OUTSIDE_STATE, type MapData } from '../engine/geo/mapTypes.ts'
import type { Parcel } from '../engine/parcels/types.ts'
import type { MultiPoly } from '../engine/geo/polygon.ts'
import { ICONS, type IconKey } from './icons.ts'
import { project } from '../engine/geo/projection.ts'
import { CITIES } from '../data/cities.ts'
import type { Road, Waterway, WaterBody } from '../engine/geo/basemapTypes.ts'

/** Cell size in px/km below which hexes are not drawn at all. */
const HEX_FADE_IN = 6
/** Cell size in px/km at which hexes are fully opaque. */
const HEX_FADE_FULL = 14

/** Parcels only appear once one is big enough on screen to be a shape. */
const PARCEL_FADE_IN = 14
const PARCEL_FADE_FULL = 30

/* Aerial imagery only earns its bandwidth once the player is close enough to
   read what is on the ground; statewide it is a brown smear. It fades in with
   the parcels, because that is the moment routing becomes a local decision. */
const IMAGERY_FADE_IN = 10
const IMAGERY_FADE_FULL = 22

/* Roads come in earlier — the shape of the road network is useful for
   choosing a corridor long before individual parcels matter. */
const ROAD_FADE_IN = 5
const ROAD_FADE_FULL = 12

/* Water is drawn from the very start. Where the rivers are is a statewide fact
   about the state and shapes which counties a campaign can reach, so unlike
   roads it never fades out entirely. */
const WATER_MIN_ALPHA = 0.55

const PARCEL_FILL: Record<ParcelTint, string> = {
  taken: 'rgba(232,163,61,0.30)',
  severed: 'rgba(181,69,94,0.28)',
  accepted: 'rgba(94,140,106,0.34)',
  holdout: 'rgba(198,72,60,0.34)',
  condemned: 'rgba(142,47,63,0.44)',
  blocked: 'rgba(51,50,44,0.42)',
}

const PARCEL_STROKE: Record<ParcelTint, string> = {
  taken: '#c98f3b',
  severed: '#b5455e',
  accepted: '#5e8c6a',
  holdout: '#c6483c',
  condemned: '#8e2f3f',
  blocked: '#33322c',
}

export type Overlay = 'none' | 'population' | 'landValue' | 'terrain'

export type MarkerKind =
  | 'datacenter'
  | 'plant-permitting'
  | 'plant-construction'
  | 'plant-online'

export interface Marker {
  cell: number
  kind: MarkerKind
  label: string
  /** 0–1, drawn as a progress ring on plants under construction. */
  progress?: number
  /** Which glyph goes inside the marker. */
  icon?: IconKey
}

/**
 * Path2D objects are expensive to build from a string, and these are drawn every
 * frame, so each icon is compiled once and reused.
 */
const pathCache = new Map<string, Path2D[]>()

function iconPaths(key: IconKey): Path2D[] {
  const cached = pathCache.get(key)
  if (cached) return cached
  const compiled = ICONS[key].paths.map((d) => new Path2D(d))
  pathCache.set(key, compiled)
  return compiled
}

/** Draw a vector icon centred on a point, scaled to a pixel size. */
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

/** The ghost of a plant the player is about to place. */
export interface SitingPreview {
  cell: number
  ok: boolean
  /** Footprint radius in km, so a solar farm visibly dwarfs a turbine. */
  radiusKm: number
}

/** How a parcel should read: untouched, in the right-of-way, or contested. */
export type ParcelTint = 'taken' | 'severed' | 'accepted' | 'holdout' | 'condemned' | 'blocked'

export interface CorridorDraw {
  centerline: Array<[number, number]>
  buffer: MultiPoly
  status: 'planned' | 'acquiring' | 'building' | 'energized'
}

export interface RenderOptions {
  overlay: Overlay
  /** County index under the pointer, or -1. */
  hoverCounty: number
  showHexes: boolean
  markers?: readonly Marker[]
  siting?: SitingPreview | null
  /** Parcels for the county being worked, drawn only when zoomed in. */
  parcels?: readonly Parcel[]
  /** Per-parcel tint, keyed by parcel id. */
  parcelTints?: Record<string, ParcelTint>
  corridors?: readonly CorridorDraw[]
  /** Parcel id under the pointer. */
  hoverParcel?: string | null
  /** Live weather during the operate phase. */
  storms?: readonly StormDraw[]
  /** Aerial photography for the study area, when it has been vendored. */
  imagery?: ImageryDraw | null
  /** Road centrelines for the county being worked. */
  roads?: readonly Road[]
  /** Whether the player has the aerial layer switched on. */
  showImagery?: boolean
  showRoads?: boolean
  /** Rivers, lakes and wetlands for the visible scope. */
  waterways?: readonly Waterway[]
  waterBodies?: readonly WaterBody[]
  showWater?: boolean
}

/** Decoded imagery plus where it sits, in projected kilometres. */
export interface ImageryDraw {
  images: readonly CanvasImageSource[]
  tiles: readonly { bounds: [number, number, number, number] }[]
}

export interface StormDraw {
  x: number
  y: number
  radiusKm: number
  /** 0-1. Drives how angry the cell looks. */
  severity: number
}

interface CityScreen {
  name: string
  wx: number
  wy: number
  population: number
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export class MapRenderer {
  private terrainRaster: HTMLCanvasElement | null = null
  private overlayRaster: HTMLCanvasElement | null = null
  private overlayKind: Overlay = 'none'
  private cities: CityScreen[]

  /** World-space rectangle the rasters cover. */
  private rasterBounds: { x0: number; y0: number; x1: number; y1: number }

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

  /** Bounding box of the state, for the camera's initial fit. */
  get stateBounds() {
    const [minX, minY, maxX, maxY] = this.data.counties.bbox
    return { minX, minY, maxX, maxY }
  }

  // --- raster baking -----------------------------------------------------

  private hexToPixel(index: number, spec: { cols: number; rows: number }): number {
    // Grid row 0 is the southern edge; canvas row 0 is the top. Flip.
    const row = Math.floor(index / spec.cols)
    const col = index - row * spec.cols
    return ((spec.rows - 1 - row) * spec.cols + col) * 4
  }

  private bakeTerrain(): HTMLCanvasElement {
    const { spec, terrain, county } = this.data.grid
    const canvas = document.createElement('canvas')
    canvas.width = spec.cols
    canvas.height = spec.rows
    const ctx = canvas.getContext('2d')!
    const img = ctx.createImageData(spec.cols, spec.rows)
    const px = img.data

    // Parse the palette hex strings once rather than per cell.
    const rgb = PALETTE.terrain.map((hex) => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ])

    for (let i = 0; i < terrain.length; i++) {
      const p = this.hexToPixel(i, spec)
      if (county[i] === OUTSIDE_STATE) {
        px[p + 3] = 0
        continue
      }
      const c = rgb[terrain[i]] ?? rgb[1]
      px[p] = c[0]
      px[p + 1] = c[1]
      px[p + 2] = c[2]
      px[p + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    return canvas
  }

  private bakeOverlay(kind: Overlay): HTMLCanvasElement | null {
    if (kind === 'none' || kind === 'terrain') return null
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
      // Violet for people, amber for money.
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

  // --- drawing -----------------------------------------------------------

  render(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, opts: RenderOptions): void {
    if (!this.terrainRaster) this.terrainRaster = this.bakeTerrain()
    if (this.overlayKind !== opts.overlay) {
      this.overlayRaster = this.bakeOverlay(opts.overlay)
      this.overlayKind = opts.overlay
    }

    ctx.fillStyle = PALETTE.paper
    ctx.fillRect(0, 0, vp.width, vp.height)

    this.drawRaster(ctx, cam, vp, this.terrainRaster, 1)

    // Imagery goes over the terrain raster and under everything else: it is the
    // ground, and every game mark needs to read on top of it.
    const imageryAlpha = opts.showImagery && opts.imagery
      ? smoothstep(IMAGERY_FADE_IN, IMAGERY_FADE_FULL, cam.scale)
      : 0
    if (imageryAlpha > 0.01) this.drawImagery(ctx, cam, vp, opts.imagery!, imageryAlpha)

    // The data overlays stay on top of the photo, or they would be invisible.
    if (this.overlayRaster) this.drawRaster(ctx, cam, vp, this.overlayRaster, 1)

    const hexAlpha = opts.showHexes ? smoothstep(HEX_FADE_IN, HEX_FADE_FULL, cam.scale) : 0
    if (hexAlpha > 0.01) this.drawHexes(ctx, cam, vp, hexAlpha)

    // Water sits above the imagery and under everything the player acts on.
    // Drawn before roads so a bridge reads as crossing the river, not under it.
    if (opts.showWater !== false && (opts.waterways?.length || opts.waterBodies?.length)) {
      this.drawWater(ctx, cam, vp, opts.waterways ?? [], opts.waterBodies ?? [], imageryAlpha)
    }

    if (opts.showRoads && opts.roads?.length) {
      const roadAlpha = smoothstep(ROAD_FADE_IN, ROAD_FADE_FULL, cam.scale)
      if (roadAlpha > 0.01) this.drawRoads(ctx, cam, vp, opts.roads, roadAlpha, imageryAlpha)
    }

    // Parcels sit under the corridor so the right-of-way reads as laid across
    // them, which is what it is.
    if (opts.parcels?.length) {
      const alpha = smoothstep(PARCEL_FADE_IN, PARCEL_FADE_FULL, cam.scale)
      if (alpha > 0.01) {
        this.drawParcels(ctx, cam, vp, opts.parcels, opts.parcelTints ?? {}, opts.hoverParcel ?? null, alpha)
      }
    }
    if (opts.corridors?.length) this.drawCorridors(ctx, cam, vp, opts.corridors)

    this.drawCounties(ctx, cam, vp, opts.hoverCounty)
    this.drawCities(ctx, cam, vp)
    if (opts.siting) this.drawSitingPreview(ctx, cam, vp, opts.siting)
    if (opts.markers?.length) this.drawMarkers(ctx, cam, vp, opts.markers)
    if (opts.storms?.length) this.drawStorms(ctx, cam, vp, opts.storms)
  }

  /**
   * Assets on the map. Plants and the campus they serve are the only saturated
   * marks besides corridors, so they read instantly against the land tones.
   */
  private drawMarkers(
    ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, markers: readonly Marker[],
  ): void {
    const vis = cam.visibleBounds(vp)
    ctx.save()
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'

    for (const m of markers) {
      const [wx, wy] = this.cellCenterOf(m.cell)
      if (wx < vis.minX || wx > vis.maxX || wy < vis.minY || wy > vis.maxY) continue
      const [px, py] = cam.toScreen(wx, wy, vp)

      if (m.kind === 'datacenter') {
        // A squared-off block: server halls, not a power plant.
        const s = 11
        ctx.beginPath()
        ctx.roundRect(px - s, py - s, s * 2, s * 2, 4)
        ctx.fillStyle = PALETTE.dataCenter
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = PALETTE.paper
        ctx.stroke()
        drawIcon(ctx, m.icon ?? 'dataCenter', px, py, s * 1.5, 'rgba(242,239,230,0.95)')
      } else {
        const online = m.kind === 'plant-online'
        const building = m.kind === 'plant-construction'
        const r = 11

        ctx.beginPath()
        ctx.arc(px, py, r, 0, Math.PI * 2)
        ctx.fillStyle = online ? PALETTE.energized : PALETTE.paper
        ctx.fill()
        ctx.lineWidth = 2.2
        ctx.strokeStyle = online ? PALETTE.plant : building ? PALETTE.warn : PALETTE.inkFaint
        // A dashed ring reads as "not real yet" — this plant is still on paper.
        if (!online && !building) ctx.setLineDash([3, 3])
        ctx.stroke()
        ctx.setLineDash([])

        if (m.icon) {
          // Inside an energised plant the glyph sits on amber, so it goes dark;
          // otherwise it carries the status colour itself.
          drawIcon(
            ctx, m.icon, px, py, r * 1.35,
            online ? PALETTE.ink : building ? PALETTE.warn : PALETTE.inkFaint,
          )
        }

        // Progress ring: how far along construction is, at a glance.
        if (building && m.progress !== undefined && m.progress > 0) {
          ctx.beginPath()
          ctx.arc(px, py, r + 3.5, -Math.PI / 2, -Math.PI / 2 + m.progress * Math.PI * 2)
          ctx.strokeStyle = PALETTE.warn
          ctx.lineWidth = 2.5
          ctx.lineCap = 'round'
          ctx.stroke()
          ctx.lineCap = 'butt'
        }
      }

      // Label only when there's room to read it.
      if (cam.scale > 2.5) {
        ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif'
        ctx.lineWidth = 3
        ctx.strokeStyle = 'rgba(242,239,230,0.92)'
        ctx.strokeText(m.label, px + 13, py)
        ctx.fillStyle = PALETTE.ink
        ctx.fillText(m.label, px + 13, py)
      }
    }
    ctx.restore()
  }

  /**
   * Property lines, and who is in the way.
   *
   * Only drawn once zoomed in far enough for a parcel to be a readable shape —
   * at statewide zoom a rural county's cadastre is a grey smear, and the
   * eighteen thousand polygons cost real frame time to say nothing.
   */
  private drawParcels(
    ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport,
    parcels: readonly Parcel[], tints: Record<string, ParcelTint>,
    hoverParcel: string | null, alpha: number,
  ): void {
    const vis = cam.visibleBounds(vp)
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.lineWidth = Math.min(1.2, 0.03 * cam.scale)

    for (const parcel of parcels) {
      const ring = parcel.poly[0]
      if (!ring || ring.length < 3) continue

      // Cheap viewport reject before touching the path API.
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const [x, y] of ring) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
      if (maxX < vis.minX || minX > vis.maxX || maxY < vis.minY || minY > vis.maxY) continue

      ctx.beginPath()
      for (let i = 0; i < ring.length; i++) {
        const [px, py] = cam.toScreen(ring[i][0], ring[i][1], vp)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()

      const tint = tints[parcel.id]
      if (tint) {
        ctx.fillStyle = PARCEL_FILL[tint]
        ctx.fill()
      } else if (parcel.id === hoverParcel) {
        ctx.fillStyle = 'rgba(47,111,122,0.16)'
        ctx.fill()
      }

      ctx.strokeStyle = tint ? PARCEL_STROKE[tint] : PALETTE.countyLine
      ctx.stroke()
    }
    ctx.restore()
  }

  /** The right-of-way and the line down the middle of it. */
  private drawCorridors(
    ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, corridors: readonly CorridorDraw[],
  ): void {
    ctx.save()
    for (const corridor of corridors) {
      const planned = corridor.status === 'planned'
      const live = corridor.status === 'energized'

      // The swept right-of-way: the land actually being taken.
      if (corridor.buffer.length > 0 && cam.scale > 4) {
        ctx.beginPath()
        for (const poly of corridor.buffer) {
          for (const ring of poly) {
            for (let i = 0; i < ring.length; i++) {
              const [px, py] = cam.toScreen(ring[i][0], ring[i][1], vp)
              if (i === 0) ctx.moveTo(px, py)
              else ctx.lineTo(px, py)
            }
            ctx.closePath()
          }
        }
        ctx.fillStyle = planned ? 'rgba(232,163,61,0.20)' : 'rgba(232,163,61,0.32)'
        ctx.fill()
      }

      // The centerline.
      const pts = corridor.centerline
      if (pts.length < 2) continue
      ctx.beginPath()
      for (let i = 0; i < pts.length; i++) {
        const [px, py] = cam.toScreen(pts[i][0], pts[i][1], vp)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      if (planned) ctx.setLineDash([7, 5])
      ctx.lineWidth = live ? 3.2 : 2.4
      ctx.strokeStyle = live ? PALETTE.energized : planned ? PALETTE.corridorDim : PALETTE.corridor
      ctx.stroke()
      ctx.setLineDash([])

      // Structures at every angle point, once they'd be visible.
      if (cam.scale > 8) {
        ctx.fillStyle = PALETTE.ink
        for (const [wx, wy] of pts) {
          const [px, py] = cam.toScreen(wx, wy, vp)
          ctx.fillRect(px - 1.6, py - 1.6, 3.2, 3.2)
        }
      }
    }
    ctx.restore()
  }

  /** Parcel at a world point, or null. Tests only the parcels handed in. */
  parcelAt(parcels: readonly Parcel[], wx: number, wy: number): Parcel | null {
    for (const parcel of parcels) {
      const ring = parcel.poly[0]
      if (!ring) continue
      let inside = false
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if ((yi > wy) !== (yj > wy) && wx < ((xj - xi) * (wy - yi)) / (yj - yi) + xi) {
          inside = !inside
        }
      }
      if (inside) return parcel
    }
    return null
  }

  /**
   * Storm cells, drawn over everything because that is how they feel.
   * A soft radial wash rather than a hard disc: weather does not have edges,
   * and the player needs to see roughly where it is heading, not a hitbox.
   */
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

      // A severe cell gets an outline so it cannot be mistaken for haze.
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

  private drawSitingPreview(
    ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, s: SitingPreview,
  ): void {
    if (s.cell < 0) return
    const [wx, wy] = this.cellCenterOf(s.cell)
    const [px, py] = cam.toScreen(wx, wy, vp)
    const rPx = Math.max(7, s.radiusKm * cam.scale)

    ctx.save()
    // The footprint circle is drawn to true scale: a 1,400-acre solar farm
    // should look alarming next to a 40-acre turbine site, because it is.
    ctx.beginPath()
    ctx.arc(px, py, rPx, 0, Math.PI * 2)
    ctx.fillStyle = s.ok ? 'rgba(94,140,106,0.20)' : 'rgba(198,72,60,0.20)'
    ctx.fill()
    ctx.setLineDash([5, 4])
    ctx.lineWidth = 2
    ctx.strokeStyle = s.ok ? PALETTE.ok : PALETTE.fault
    ctx.stroke()
    ctx.setLineDash([])

    ctx.beginPath()
    ctx.arc(px, py, 3, 0, Math.PI * 2)
    ctx.fillStyle = s.ok ? PALETTE.ok : PALETTE.fault
    ctx.fill()
    ctx.restore()
  }

  /**
   * Aerial photography, blitted axis-aligned in world space.
   *
   * That is only correct because the fetch script reprojects the image into
   * this projection and refuses to vendor anything with visible skew — see
   * scripts/fetch-imagery.ts. Drawing a raw lon/lat export here would put the
   * photo a few tens of metres off the parcels it is meant to explain.
   */
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

  /**
   * Rivers, lakes and wetlands.
   *
   * Water bodies fill; watercourses stroke, widening with zoom so a creek reads
   * as a thread statewide and a channel up close. Wetland gets a hatch rather
   * than a fill, because it is not open water and a player deciding where to
   * put a corridor needs to tell the difference: one is a span, the other is a
   * permit.
   */
  private drawWater(
    ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport,
    ways: readonly Waterway[], bodies: readonly WaterBody[], overPhoto: number,
  ): void {
    const vis = cam.visibleBounds(vp)
    // Over aerial photography the real water is already visible, so the layer
    // steps back to an outline rather than painting over the thing it describes.
    const alpha = WATER_MIN_ALPHA + (1 - WATER_MIN_ALPHA) * (1 - overPhoto)

    ctx.save()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    for (const body of bodies) {
      const ring = body.ring
      if (ring.length < 3) continue
      let visible = false
      for (const [wx, wy] of ring) {
        if (wx >= vis.minX && wx <= vis.maxX && wy >= vis.minY && wy <= vis.maxY) {
          visible = true
          break
        }
      }
      if (!visible) continue

      ctx.beginPath()
      for (let i = 0; i < ring.length; i++) {
        const [px, py] = cam.toScreen(ring[i][0], ring[i][1], vp)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()

      if (body.kind === 'wetland') {
        ctx.globalAlpha = alpha * 0.5
        ctx.fillStyle = PALETTE.wetland
        ctx.fill()
        ctx.globalAlpha = alpha * 0.8
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        ctx.strokeStyle = PALETTE.waterDeep
        ctx.stroke()
        ctx.setLineDash([])
      } else {
        ctx.globalAlpha = alpha * (overPhoto > 0.5 ? 0.45 : 0.95)
        ctx.fillStyle = body.kind === 'reservoir' ? PALETTE.waterDeep : PALETTE.water
        ctx.fill()
      }
    }

    for (const way of ways) {
      const pts = way.points
      if (pts.length < 2) continue
      let visible = false
      for (const [wx, wy] of pts) {
        if (wx >= vis.minX && wx <= vis.maxX && wy >= vis.minY && wy <= vis.maxY) {
          visible = true
          break
        }
      }
      if (!visible) continue

      ctx.beginPath()
      for (let i = 0; i < pts.length; i++) {
        const [px, py] = cam.toScreen(pts[i][0], pts[i][1], vp)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      // A river should look like a river when you are close to it.
      const base = way.kind === 'river' ? 1.6 : 0.9
      ctx.globalAlpha = alpha
      ctx.lineWidth = Math.min(9, base * (1 + cam.scale / 14))
      ctx.strokeStyle = PALETTE.water
      ctx.stroke()
    }
    ctx.restore()
  }

  /**
   * Road centrelines.
   *
   * Drawn with a light casing so they stay readable over both the flat terrain
   * palette and aerial photography, which are very different backgrounds. Width
   * is by class and does not scale with zoom past a point — a road is a
   * landmark here, not a measured object.
   */
  private drawRoads(
    ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport,
    roads: readonly Road[], alpha: number, overPhoto: number,
  ): void {
    const vis = cam.visibleBounds(vp)
    const widths = [3.4, 2.6, 1.8, 1.1, 0.8]
    // Minor roads would turn the county into a grey wash when zoomed out.
    const minClass = cam.scale < 9 ? 2 : cam.scale < 16 ? 3 : 4

    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    for (const pass of [0, 1]) {
      for (const road of roads) {
        if (road.cls > minClass) continue
        const pts = road.points
        if (pts.length < 2) continue

        // Cheap reject on the first vertex' neighbourhood; roads are short.
        let visible = false
        for (const [wx, wy] of pts) {
          if (wx >= vis.minX && wx <= vis.maxX && wy >= vis.minY && wy <= vis.maxY) {
            visible = true
            break
          }
        }
        if (!visible) continue

        ctx.beginPath()
        for (let i = 0; i < pts.length; i++) {
          const [px, py] = cam.toScreen(pts[i][0], pts[i][1], vp)
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        const w = widths[road.cls]
        if (pass === 0) {
          ctx.globalAlpha = alpha * (0.35 + 0.4 * overPhoto)
          ctx.lineWidth = w + 2.4
          ctx.strokeStyle = overPhoto > 0.5 ? 'rgba(20,18,14,0.55)' : 'rgba(255,253,246,0.85)'
        } else {
          ctx.globalAlpha = alpha
          ctx.lineWidth = w
          ctx.strokeStyle = road.cls <= 1 ? PALETTE.roadMajor : PALETTE.roadMinor
        }
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  private drawRaster(
    ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport,
    raster: HTMLCanvasElement, alpha: number,
  ): void {
    const { x0, y0, x1, y1 } = this.rasterBounds
    // Top-left of the image in screen space is (minX, maxY) in world space.
    const [sx, sy] = cam.toScreen(x0, y1, vp)
    const w = (x1 - x0) * cam.scale
    const h = (y1 - y0) * cam.scale
    ctx.save()
    ctx.globalAlpha = alpha
    // Smoothing reads as intentional flat illustration when the raster is
    // upscaled; once cells are large enough to see, crisp edges look better.
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
    ctx.globalAlpha = alpha * 0.5
    ctx.strokeStyle = PALETTE.inkFaint
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
    ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, hoverCounty: number,
  ): void {
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
          // Cheap reject: skip rings entirely outside the viewport.
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

      if (ci === hoverCounty) {
        ctx.fillStyle = 'rgba(47,111,122,0.14)'
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
    // Show more places as the map gets closer: at statewide zoom only the big
    // ones, by county zoom every crossroads with a name.
    const minPop = cam.scale < 1.4 ? 60_000
      : cam.scale < 3 ? 15_000
      : cam.scale < 8 ? 3_000
      : cam.scale < 20 ? 800
      : 0

    ctx.save()
    ctx.textBaseline = 'middle'

    // Greedy label placement, largest place first. Metro Atlanta stacks half a
    // dozen cities inside a few pixels at statewide zoom; without this they
    // overprint into an unreadable smear. A smaller city that cannot find a free
    // spot keeps its dot and loses its label — the dot is the honest part.
    const placed: Array<[number, number, number, number]> = []
    const overlaps = (a: [number, number, number, number]) =>
      placed.some((b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1])

    /** Try right of the dot first, then left, then above, then below. */
    const CANDIDATES: ReadonlyArray<readonly [number, number, CanvasTextAlign]> = [
      [1, 0, 'left'], [-1, 0, 'right'], [0, -1, 'center'], [0, 1, 'center'],
    ]

    for (const c of this.cities) {
      if (c.population < minPop) continue
      if (c.wx < vis.minX || c.wx > vis.maxX || c.wy < vis.minY || c.wy > vis.maxY) continue
      const [px, py] = cam.toScreen(c.wx, c.wy, vp)

      const r = c.population > 100_000 ? 4.2 : c.population > 20_000 ? 3.2 : 2.3
      const size = c.population > 100_000 ? 13 : c.population > 20_000 ? 12 : 11
      ctx.font = `${c.population > 100_000 ? 600 : 500} ${size}px ui-sans-serif, system-ui, sans-serif`
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

      // The dot is always drawn: a place existing is not negotiable, only its label.
      ctx.beginPath()
      ctx.arc(px, py, r, 0, Math.PI * 2)
      ctx.fillStyle = PALETTE.ink
      ctx.fill()
      ctx.lineWidth = 1.6
      ctx.strokeStyle = PALETTE.paper
      ctx.stroke()

      if (!box) continue
      placed.push(box)
      // Also reserve the dot itself so later labels don't sit on top of it.
      placed.push([px - r - 1, py - r - 1, px + r + 1, py + r + 1])

      ctx.textAlign = align
      // Halo the label so it stays readable over any terrain tone.
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(242,239,230,0.92)'
      ctx.strokeText(c.name, tx, ty)
      ctx.fillStyle = PALETTE.ink
      ctx.fillText(c.name, tx, ty)
    }
    ctx.restore()
  }

  // --- hit testing -------------------------------------------------------

  /** County index at a world point, or -1. Reads the raster grid, not the polygons. */
  countyAt(wx: number, wy: number): number {
    const { spec, county } = this.data.grid
    const row = Math.round((wy - spec.originY) / HEX_ROW_KM)
    if (row < 0 || row >= spec.rows) return -1
    const col = Math.round((wx - spec.originX) / HEX_WIDTH_KM - 0.5 * (row & 1))
    if (col < 0 || col >= spec.cols) return -1
    const v = county[row * spec.cols + col]
    return v === OUTSIDE_STATE ? -1 : v
  }

  /** Grid cell index at a world point, or -1 if off-grid. */
  cellAt(wx: number, wy: number): number {
    const { spec } = this.data.grid
    const row = Math.round((wy - spec.originY) / HEX_ROW_KM)
    if (row < 0 || row >= spec.rows) return -1
    const col = Math.round((wx - spec.originX) / HEX_WIDTH_KM - 0.5 * (row & 1))
    if (col < 0 || col >= spec.cols) return -1
    return row * spec.cols + col
  }

  /** Centre of a cell in world km, for placing markers. */
  cellCenterOf(index: number): [number, number] {
    const { spec } = this.data.grid
    const row = Math.floor(index / spec.cols)
    return cellCenter(spec, index - row * spec.cols, row)
  }

  get hexSizeKm(): number {
    return HEX_SIZE_KM
  }
}
