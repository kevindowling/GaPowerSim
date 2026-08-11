import { useEffect, useRef, useState, useCallback } from 'react'
import { Camera } from '../render/camera.ts'
import {
  MapRenderer, type Overlay, type Marker, type SitingPreview,
  type CorridorDraw, type ParcelTint,
} from '../render/mapRenderer.ts'
import type { MapData } from '../engine/geo/mapTypes.ts'
import type { Parcel } from '../engine/parcels/types.ts'

interface Props {
  data: MapData
  overlay: Overlay
  showHexes: boolean
  markers?: readonly Marker[]
  siting?: SitingPreview | null
  /** True while a placement tool is armed, which changes the cursor. */
  placing?: boolean
  parcels?: readonly Parcel[]
  parcelTints?: Record<string, ParcelTint>
  corridors?: readonly CorridorDraw[]
  hoverParcel?: string | null
  onHoverCounty: (name: string | null, cell: CellReadout | null, cellIndex: number) => void
  onClickCell?: (cell: number) => void
  onScaleChange: (scale: number) => void
}

export interface CellReadout {
  terrain: number
  population: number
  landValue: number
}

/**
 * The map surface: owns the canvas, the camera, and all pointer interaction.
 * Rendering runs on requestAnimationFrame but only repaints when something has
 * actually changed, so an idle map costs nothing.
 */
export function MapView({
  data, overlay, showHexes, markers, siting, placing,
  parcels, parcelTints, corridors, hoverParcel,
  onHoverCounty, onClickCell, onScaleChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const camRef = useRef(new Camera())
  const rendererRef = useRef<MapRenderer | null>(null)
  const dirtyRef = useRef(true)
  const hoverCountyRef = useRef(-1)
  const vpRef = useRef({ width: 1, height: 1 })
  const [ready, setReady] = useState(false)

  const markDirty = useCallback(() => { dirtyRef.current = true }, [])

  // --- set up renderer and initial framing ------------------------------
  useEffect(() => {
    const renderer = new MapRenderer(data)
    rendererRef.current = renderer
    const cam = camRef.current
    cam.bounds = renderer.stateBounds
    // 0.9 px/km still fits the whole state on a small embed. 150 px/km puts a
    // 1 km hex at 150 px and a typical parcel frontage at a readable size, which
    // is as deep as the game ever needs to go.
    cam.minScale = 0.9
    cam.maxScale = 150
    setReady(true)
    markDirty()
  }, [data, markDirty])

  // --- size to container, with device pixel ratio ------------------------
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

  // --- render loop -------------------------------------------------------
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
        siting,
        parcels,
        parcelTints,
        corridors,
        hoverParcel,
      })
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [overlay, showHexes, markers, siting, parcels, parcelTints, corridors, hoverParcel])

  // Repaint when anything the renderer reads changes.
  useEffect(markDirty, [
    overlay, showHexes, markers, siting, parcels, parcelTints, corridors, hoverParcel, markDirty,
  ])

  // --- interaction -------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let dragging = false
    let lastX = 0
    let lastY = 0
    let moved = 0
    const pointers = new Map<number, { x: number; y: number }>()
    let pinchDist = 0

    const localPoint = (e: PointerEvent | WheelEvent): [number, number] => {
      const r = canvas.getBoundingClientRect()
      return [e.clientX - r.left, e.clientY - r.top]
    }

    const updateHover = (sx: number, sy: number) => {
      const renderer = rendererRef.current
      if (!renderer) return
      const [wx, wy] = camRef.current.toWorld(sx, sy, vpRef.current)
      const ci = renderer.countyAt(wx, wy)
      if (ci !== hoverCountyRef.current) {
        hoverCountyRef.current = ci
        markDirty()
      }
      const cell = renderer.cellAt(wx, wy)
      if (ci < 0) {
        onHoverCounty(null, null, cell)
        return
      }
      const g = data.grid
      onHoverCounty(
        data.counties.counties[ci]?.name ?? null,
        cell >= 0
          ? { terrain: g.terrain[cell], population: g.population[cell], landValue: g.landValue[cell] }
          : null,
        cell,
      )
    }

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 1) {
        dragging = true
        moved = 0
        const [x, y] = localPoint(e)
        lastX = x
        lastY = y
      } else if (pointers.size === 2) {
        dragging = false
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
        camRef.current.panByPixels(dx, dy)
        lastX = x
        lastY = y
        markDirty()
      } else {
        updateHover(x, y)
      }
    }

    const endPointer = (e: PointerEvent) => {
      const wasDragging = dragging
      pointers.delete(e.pointerId)
      if (pointers.size < 2) pinchDist = 0
      if (pointers.size === 0) dragging = false
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)

      // A click is a pointer-up that didn't travel. Anything more was a pan,
      // and panning must never place a several-hundred-million-dollar plant.
      if (e.type === 'pointerup' && wasDragging && moved < 5 && onClickCell) {
        const renderer = rendererRef.current
        if (!renderer) return
        const [x, y] = localPoint(e)
        const [wx, wy] = camRef.current.toWorld(x, y, vpRef.current)
        const cell = renderer.cellAt(wx, wy)
        if (cell >= 0) onClickCell(cell)
      }
    }

    const onWheel = (e: WheelEvent) => {
      // The map owns the wheel while the pointer is over it. Without this the
      // host page scrolls out from under the embed as soon as you try to zoom.
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
      if (hoverCountyRef.current !== -1) {
        hoverCountyRef.current = -1
        markDirty()
      }
      onHoverCounty(null, null, -1)
    }

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
  }, [data, markDirty, onHoverCounty, onClickCell, onScaleChange])

  // --- keyboard ----------------------------------------------------------
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
    </div>
  )
}
