export interface Viewport {
  width: number
  height: number
}

export interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export class Camera {
  /** World km at the centre of the viewport. */
  centerX = 0
  centerY = 0
  /** Pixels per kilometre. */
  scale = 1

  minScale = 0.5
  maxScale = 400

  /** World-space limit the centre is kept within, so the map can't be lost. */
  bounds: BBox | null = null

  toScreen(wx: number, wy: number, vp: Viewport): [number, number] {
    return [
      (wx - this.centerX) * this.scale + vp.width / 2,
      vp.height / 2 - (wy - this.centerY) * this.scale,
    ]
  }

  toWorld(sx: number, sy: number, vp: Viewport): [number, number] {
    return [
      (sx - vp.width / 2) / this.scale + this.centerX,
      this.centerY - (sy - vp.height / 2) / this.scale,
    ]
  }

  /** Frame a bounding box with a pixel margin on all sides. */
  fit(box: BBox, vp: Viewport, paddingPx = 24): void {
    const w = Math.max(box.maxX - box.minX, 1e-6)
    const h = Math.max(box.maxY - box.minY, 1e-6)
    const sx = (vp.width - paddingPx * 2) / w
    const sy = (vp.height - paddingPx * 2) / h
    this.scale = this.clampScale(Math.min(sx, sy))
    this.centerX = (box.minX + box.maxX) / 2
    this.centerY = (box.minY + box.maxY) / 2
    this.clampCenter()
  }

  clampScale(s: number): number {
    return Math.min(this.maxScale, Math.max(this.minScale, s))
  }

  /** Pan by a screen-space delta. */
  panByPixels(dxPx: number, dyPx: number): void {
    this.centerX -= dxPx / this.scale
    this.centerY += dyPx / this.scale
    this.clampCenter()
  }

  zoomAt(factor: number, anchorSx: number, anchorSy: number, vp: Viewport): void {
    const [wx, wy] = this.toWorld(anchorSx, anchorSy, vp)
    const next = this.clampScale(this.scale * factor)
    if (next === this.scale) return
    this.scale = next
    // Re-solve the centre so the anchor lands back where it was.
    this.centerX = wx - (anchorSx - vp.width / 2) / this.scale
    this.centerY = wy + (anchorSy - vp.height / 2) / this.scale
    this.clampCenter()
  }

  /** The world-space rectangle currently visible, useful for culling. */
  visibleBounds(vp: Viewport): BBox {
    const halfW = vp.width / 2 / this.scale
    const halfH = vp.height / 2 / this.scale
    return {
      minX: this.centerX - halfW,
      maxX: this.centerX + halfW,
      minY: this.centerY - halfH,
      maxY: this.centerY + halfH,
    }
  }

  private clampCenter(): void {
    const b = this.bounds
    if (!b) return
    // Allow a little overscroll so edge geography isn't jammed against the frame.
    const marginX = (b.maxX - b.minX) * 0.15
    const marginY = (b.maxY - b.minY) * 0.15
    this.centerX = Math.min(b.maxX + marginX, Math.max(b.minX - marginX, this.centerX))
    this.centerY = Math.min(b.maxY + marginY, Math.max(b.minY - marginY, this.centerY))
  }
}
