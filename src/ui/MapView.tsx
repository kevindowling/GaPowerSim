import { useEffect, useLayoutEffect, useRef, useState, useCallback, type ReactNode } from 'react'
import { Camera } from '../render/camera.ts'
import {
  MapRenderer, type Overlay, type Marker, type SitingPreview,
  type CorridorDraw, type ParcelTint, type StormDraw, type ImageryDraw, type NodeDraw, type FootprintDraw, type DataCenterDraw, type SubstationDraw,
} from '../render/mapRenderer.ts'
import type { Gis, Road, Waterway, WaterBody } from '../engine/geo/basemapTypes.ts'
import type { MapData } from '../engine/geo/mapTypes.ts'
import type { Parcel } from '../engine/parcels/types.ts'
import type { RouteDraft } from '../state/gameStore.ts'

interface Props {
  data: MapData
  overlay: Overlay
  showHexes: boolean
  markers?: readonly Marker[]
  dataCenters?: readonly DataCenterDraw[]
  substations?: readonly SubstationDraw[]
  pickedLine?: readonly (readonly [number, number])[] | null
  siting?: SitingPreview | null
  /** True while a placement tool is armed, which changes the cursor. */
  placing?: boolean
  parcels?: readonly Parcel[]
  parcelTints?: Record<string, ParcelTint>
  extraParcels?: readonly Parcel[]
  footprints?: readonly FootprintDraw[]
  tappable?: ReadonlyArray<{ points: readonly (readonly [number, number])[] }>
  tappableShort?: ReadonlyArray<{ points: readonly (readonly [number, number])[] }>
  /** True where a click would open something. */
  hitAt?: (x: number, y: number, cell: number, pxPerKm: number) => boolean
  /** Live preview while drawing a line; null when not drawing. */
  probe?: (x: number, y: number, pxPerKm: number) => RouteDraft | null
  /** Press on a place to begin a line and drag to the other end. */
  onDrawStart?: (x: number, y: number, pxPerKm: number) => boolean
  /** Changes when the preview has to be worked out again. */
  probeKey?: unknown
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
  showGrid?: boolean
  nodes?: readonly NodeDraw[]
  waypoints?: readonly [number, number][]
  focus?: { x: number; y: number; scale: number } | null
  selectedCounty?: string | null
  countyFill?: Record<string, string>
  streams?: ReadonlyArray<{ status: string; paths: ReadonlyArray<ReadonlyArray<readonly [number, number]>> }>
  /** What to say beside the pointer. */
  tipAt?: (x: number, y: number, cell: number, pxPerKm: number) => MapTip | null
  /** Details beside a point on the map. */
  popover?: { at: [number, number]; content: ReactNode; avoid?: readonly (readonly [number, number])[] } | null
  onHoverCell: (cellIndex: number) => void
  onClickMap?: (x: number, y: number, cell: number, pxPerKm: number) => void
  onScaleChange: (scale: number) => void
}

/** Clear of the ring round a marker. */
const POPOVER_GAP = 30
const EDGE = 8

export interface MapTip { title: string; lines: string[]; tone?: 'bad' }

export function MapView({
  data, overlay, showHexes, markers, dataCenters, substations, pickedLine, siting, placing,
  parcels, parcelTints, corridors, hoverParcel, storms, focus,
  imagery, roads, showImagery, showRoads, waterways, waterBodies, showWater,
  stateGis, gis, showGrid, nodes, waypoints, extraParcels, footprints, hitAt, tappable, tappableShort, probe, onDrawStart, probeKey,
  selectedCounty, countyFill, streams, tipAt, popover, onHoverCell, onClickMap, onScaleChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const camRef = useRef(new Camera())
  const rendererRef = useRef<MapRenderer | null>(null)
  const dirtyRef = useRef(true)
  const hoverCountyRef = useRef(-1)
  const vpRef = useRef({ width: 1, height: 1 })
  const draftRef = useRef<RouteDraft | null>(null)
  const refreshRef = useRef<() => void>(() => {})
  const pointerRef = useRef<[number, number] | null>(null)
  const [ready, setReady] = useState(false)
  const [tip, setTip] = useState<MapTip | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const popAtRef = useRef<[number, number] | null>(null)
  popAtRef.current = popover?.at ?? null
  const avoidRef = useRef<readonly (readonly [number, number])[] | null>(null)
  avoidRef.current = popover?.avoid ?? null
  const sideRef = useRef<{ key: string; i: number }>({ key: '', i: 0 })
  const placeTipRef = useRef<(x: number, y: number) => void>(() => {})

  const markDirty = useCallback(() => { dirtyRef.current = true }, [])

  const placePopover = useCallback(() => {
    const el = popRef.current
    const at = popAtRef.current
    if (!el || !at) return
    const { width, height } = vpRef.current
    const [px, py] = camRef.current.toScreen(at[0], at[1], vpRef.current)
    const w = el.offsetWidth
    const h = el.offsetHeight
    if (avoidRef.current) {
      const spots: Array<[number, number]> = [
        [px + POPOVER_GAP, py - h / 2], [px + POPOVER_GAP, py + POPOVER_GAP], [px + POPOVER_GAP, py - POPOVER_GAP - h],
        [px - POPOVER_GAP - w, py - h / 2], [px - POPOVER_GAP - w, py + POPOVER_GAP], [px - POPOVER_GAP - w, py - POPOVER_GAP - h],
        [px - w / 2, py + POPOVER_GAP], [px - w / 2, py - POPOVER_GAP - h],
      ].map(([x, y]) => [Math.max(EDGE, Math.min(width - EDGE - w, x)), Math.max(EDGE, Math.min(height - EDGE - h, y))])
      const covers = ([x, y]: [number, number], qx: number, qy: number): boolean =>
        qx > x - 14 && qx < x + w + 14 && qy > y - 14 && qy < y + h + 14
      const key = `${at[0]},${at[1]},${w},${Math.round(h / 60)}`
      // Keep its side while the map moves, unless that hides the click.
      if (sideRef.current.key !== key || covers(spots[sideRef.current.i], px, py)) {
        const points = avoidRef.current.map(([x, y]) => camRef.current.toScreen(x, y, vpRef.current))
        const score = spots.map((s) => points.reduce((n, [x, y]) => n + (covers(s, x, y) ? 1 : 0), covers(s, px, py) ? 1000 : 0))
        sideRef.current = { key, i: score.indexOf(Math.min(...score)) }
      }
      const [sx, sy] = spots[sideRef.current.i]
      el.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy)}px)`
      return
    }
    const right = px + POPOVER_GAP + w <= width - EDGE
    const left = px - POPOVER_GAP - w >= EDGE
    const x = right ? px + POPOVER_GAP : left ? px - POPOVER_GAP - w : px - w / 2
    const y = right || left ? py - Math.min(60, h / 2) : py + POPOVER_GAP
    const cx = Math.max(EDGE, Math.min(width - EDGE - w, x))
    const cy = Math.max(EDGE, Math.min(height - EDGE - h, y))
    el.style.transform = `translate(${Math.round(cx)}px, ${Math.round(cy)}px)`
  }, [])

  useEffect(() => {
    const renderer = new MapRenderer(data)
    rendererRef.current = renderer
    const cam = camRef.current
    cam.bounds = renderer.mapBounds
    cam.minScale = 0.6
    cam.maxScale = 150
    setReady(true)
    markDirty()
  }, [data, markDirty])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return

    let firstFit = true
    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.round(rect.width))
      const h = Math.max(1, Math.round(rect.height))
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      vpRef.current = { width: w, height: h }
      if (firstFit && rendererRef.current) {
        camRef.current.fit(rendererRef.current.stateBounds, vpRef.current, 28)
        onScaleChange(camRef.current.scale)
        firstFit = false
      }
      markDirty()
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [ready, markDirty, onScaleChange])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const canvas = canvasRef.current
      const renderer = rendererRef.current
      if (!canvas || !renderer || !dirtyRef.current) return
      dirtyRef.current = false

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      renderer.render(ctx, camRef.current, vpRef.current, {
        overlay,
        hoverCounty: hoverCountyRef.current,
        showHexes,
        markers,
        dataCenters,
        substations,
        pickedLine,
        siting,
        parcels,
        parcelTints,
        corridors,
        hoverParcel,
        storms,
        imagery,
        roads,
        showImagery,
        showRoads,
        waterways,
        waterBodies,
        showWater,
        stateGis,
        gis,
        showGrid,
        nodes,
        waypoints,
        extraParcels,
        footprints,
        tappable,
        tappableShort,
        draft: draftRef.current,
        selectedCounty,
        countyFill,
        streams,
      })
      placePopover()
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [overlay, showHexes, markers, dataCenters, substations, pickedLine, siting, parcels, parcelTints, corridors, hoverParcel, storms,
      imagery, roads, showImagery, showRoads, waterways, waterBodies, showWater,
      stateGis, gis, showGrid, nodes, waypoints, extraParcels, footprints, tappable, tappableShort, selectedCounty, countyFill, streams])

  // Repaint when anything the renderer reads changes.
  useEffect(markDirty, [
    overlay, showHexes, markers, dataCenters, substations, pickedLine, siting, parcels, parcelTints, corridors, hoverParcel, storms,
    imagery, roads, showImagery, showRoads, waterways, waterBodies, showWater,
    stateGis, gis, showGrid, nodes, waypoints, extraParcels, footprints, tappable, tappableShort, selectedCounty, countyFill, streams, markDirty,
  ])

  useEffect(() => {
    if (!focus || !ready) return
    const cam = camRef.current
    const from = { x: cam.centerX, y: cam.centerY, scale: cam.scale }
    const start = performance.now()
    const DURATION = 900
    let raf = 0

    const ease = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)

    const step = () => {
      const t = Math.min(1, (performance.now() - start) / DURATION)
      const k = ease(t)
      cam.centerX = from.x + (focus.x - from.x) * k
      cam.centerY = from.y + (focus.y - from.y) * k
      // Interpolate zoom geometrically, so it feels linear.
      cam.scale = from.scale * (focus.scale / from.scale) ** k
      onScaleChange(cam.scale)
      markDirty()
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [focus, ready, markDirty, onScaleChange])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let dragging = false
    let drawing = false
    let lastX = 0
    let lastY = 0
    let moved = 0
    const pointers = new Map<number, { x: number; y: number }>()
    let pinchDist = 0

    const localPoint = (e: PointerEvent | WheelEvent): [number, number] => {
      const r = canvas.getBoundingClientRect()
      return [e.clientX - r.left, e.clientY - r.top]
    }

    const updateDraft = (sx: number, sy: number) => {
      const [wx, wy] = camRef.current.toWorld(sx, sy, vpRef.current)
      const draft = probe?.(wx, wy, camRef.current.scale) ?? null
      if (draft || draftRef.current) markDirty()
      draftRef.current = draft
      canvas.classList.toggle('valid', draft?.state === 'valid')
      canvas.classList.toggle('invalid', draft?.state === 'invalid')
    }

    const updateHover = (sx: number, sy: number) => {
      const renderer = rendererRef.current
      if (!renderer) return
      pointerRef.current = [sx, sy]
      updateDraft(sx, sy)
      const [wx, wy] = camRef.current.toWorld(sx, sy, vpRef.current)
      const ci = renderer.countyAt(wx, wy)
      if (ci !== hoverCountyRef.current) {
        hoverCountyRef.current = ci
        markDirty()
      }
      const cell = renderer.cellAt(wx, wy)
      canvas.classList.toggle('over', hitAt?.(wx, wy, cell, camRef.current.scale) ?? false)
      onHoverCell(cell)
      showTip(tipAt?.(wx, wy, cell, camRef.current.scale) ?? null, sx, sy)
    }

    const showTip = (next: MapTip | null, sx: number, sy: number) => {
      setTip((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next))
      placeTip(sx, sy)
    }

    const placeTip = (sx: number, sy: number) => {
      const el = tipRef.current
      if (!el) return
      const { width, height } = vpRef.current
      const left = sx + 16 + el.offsetWidth > width - 6 ? sx - 14 - el.offsetWidth : sx + 16
      const top = sy + 18 + el.offsetHeight > height - 6 ? sy - 12 - el.offsetHeight : sy + 18
      el.style.transform = `translate(${Math.max(4, left)}px, ${Math.max(4, top)}px)`
    }
    placeTipRef.current = placeTip

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 1) {
        dragging = true
        moved = 0
        setTip(null)
        const [x, y] = localPoint(e)
        lastX = x
        lastY = y
        const [wx, wy] = camRef.current.toWorld(x, y, vpRef.current)
        drawing = onDrawStart?.(wx, wy, camRef.current.scale) ?? false
        if (drawing) updateDraft(x, y)
        wrapRef.current?.classList.toggle('drawing', drawing)
      } else if (pointers.size === 2) {
        dragging = false
        drawing = false
        const [a, b] = [...pointers.values()]
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      const [x, y] = localPoint(e)

      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinchDist > 0 && d > 0) {
          const r = canvas.getBoundingClientRect()
          camRef.current.zoomAt(
            d / pinchDist,
            (a.x + b.x) / 2 - r.left,
            (a.y + b.y) / 2 - r.top,
            vpRef.current,
          )
          onScaleChange(camRef.current.scale)
          markDirty()
        }
        pinchDist = d
        return
      }

      if (dragging) {
        const dx = x - lastX
        const dy = y - lastY
        moved += Math.abs(dx) + Math.abs(dy)
        lastX = x
        lastY = y
        if (drawing) {
          pointerRef.current = [x, y]
          updateDraft(x, y)
          return
        }
        camRef.current.panByPixels(dx, dy)
        markDirty()
      } else {
        updateHover(x, y)
      }
    }

    const endPointer = (e: PointerEvent) => {
      const wasDragging = dragging
      const wasDrawing = drawing
      if (pointers.size <= 1) drawing = false
      if (!drawing) wrapRef.current?.classList.remove('drawing')
      pointers.delete(e.pointerId)
      if (pointers.size < 2) pinchDist = 0
      if (pointers.size === 0) dragging = false
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)

      // A press that began a line finishes it only if it was dragged somewhere.
      const finish = wasDrawing ? moved >= 12 : moved < 5
      if (e.type === 'pointerup' && wasDragging && finish && onClickMap) {
        const renderer = rendererRef.current
        if (!renderer) return
        const [x, y] = localPoint(e)
        const [wx, wy] = camRef.current.toWorld(x, y, vpRef.current)
        const cell = renderer.cellAt(wx, wy)
        if (cell >= 0) onClickMap(wx, wy, cell, camRef.current.scale)
      }
      if (e.type === 'pointerup' && e.pointerType === 'mouse') updateHover(...localPoint(e))
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const [x, y] = localPoint(e)
      // Normalise line/page deltas so trackpads and mice feel similar.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1
      const factor = Math.exp((-e.deltaY * unit) / 380)
      camRef.current.zoomAt(factor, x, y, vpRef.current)
      onScaleChange(camRef.current.scale)
      markDirty()
    }

    const onLeave = () => {
      pointerRef.current = null
      if (draftRef.current) {
        draftRef.current = null
        markDirty()
      }
      if (hoverCountyRef.current !== -1) {
        hoverCountyRef.current = -1
        markDirty()
      }
      onHoverCell(-1)
      setTip(null)
    }

    refreshRef.current = () => {
      if (probe && pointerRef.current) updateDraft(...pointerRef.current)
      else if (draftRef.current) {
        draftRef.current = null
        canvas.classList.remove('valid', 'invalid')
        markDirty()
      }
    }
    refreshRef.current()

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', endPointer)
    canvas.addEventListener('pointercancel', endPointer)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', endPointer)
      canvas.removeEventListener('pointercancel', endPointer)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [data, markDirty, tipAt, onHoverCell, onClickMap, onScaleChange, hitAt, probe, onDrawStart])

  // The preview can change without the pointer moving.
  useEffect(() => refreshRef.current(), [probeKey])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const cam = camRef.current
    const step = 60
    switch (e.key) {
      case 'ArrowLeft': cam.panByPixels(step, 0); break
      case 'ArrowRight': cam.panByPixels(-step, 0); break
      case 'ArrowUp': cam.panByPixels(0, step); break
      case 'ArrowDown': cam.panByPixels(0, -step); break
      case '+': case '=':
        cam.zoomAt(1.25, vpRef.current.width / 2, vpRef.current.height / 2, vpRef.current); break
      case '-': case '_':
        cam.zoomAt(0.8, vpRef.current.width / 2, vpRef.current.height / 2, vpRef.current); break
      case '0':
        if (rendererRef.current) cam.fit(rendererRef.current.stateBounds, vpRef.current, 28)
        break
      default: return
    }
    e.preventDefault()
    onScaleChange(cam.scale)
    markDirty()
  }, [markDirty, onScaleChange])

  // Its size is only known once drawn.
  useLayoutEffect(() => {
    if (tip && pointerRef.current) placeTipRef.current(...pointerRef.current)
  }, [tip])

  const popKey = popover ? `${popover.at[0]},${popover.at[1]}` : ''
  useLayoutEffect(() => {
    const el = popRef.current
    if (!el) return
    el.scrollTop = 0
    placePopover()
    const ro = new ResizeObserver(placePopover)
    ro.observe(el)
    return () => ro.disconnect()
  }, [popKey, placePopover])

  return (
    <div ref={wrapRef} className="map-wrap">
      <canvas
        ref={canvasRef}
        className={placing ? 'map-canvas placing' : 'map-canvas'}
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label="Map of Georgia. Drag to pan, scroll to zoom, arrow keys to move."
        role="application"
      />
      {popover && <div ref={popRef} className="map-popover">{popover.content}</div>}
      {tip && (
        <div ref={tipRef} className={tip.tone === 'bad' ? 'map-tip bad' : 'map-tip'} role="status">
          <strong>{tip.title}</strong>
          {tip.lines.map((l) => <span key={l}>{l}</span>)}
        </div>
      )}
    </div>
  )
}
