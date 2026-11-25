import type { Camera, Viewport, BBox } from './camera.ts'

type Line = readonly (readonly [number, number])[]

interface Tile { path: Path2D; minX: number; minY: number; maxX: number; maxY: number }

/** Run drawing code in world kilometres. Line widths must be divided by scale. */
export function withWorld(
  ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, draw: () => void,
): void {
  const base = ctx.getTransform()
  ctx.transform(
    cam.scale, 0, 0, -cam.scale,
    vp.width / 2 - cam.centerX * cam.scale, vp.height / 2 + cam.centerY * cam.scale,
  )
  draw()
  ctx.setTransform(base)
}

/** Geometry grouped into square tiles, each compiled to one path. */
class Tiles {
  protected tiles: Tile[] = []

  constructor(lines: Iterable<Line>, tileKm: number, closed: boolean) {
    const byKey = new Map<string, Tile>()
    for (const line of lines) {
      if (line.length < 2) continue
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const [x, y] of line) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
      const key = `${Math.floor((minX + maxX) / 2 / tileKm)},${Math.floor((minY + maxY) / 2 / tileKm)}`
      let t = byKey.get(key)
      if (!t) byKey.set(key, t = { path: new Path2D(), minX, minY, maxX, maxY })
      t.minX = Math.min(t.minX, minX)
      t.minY = Math.min(t.minY, minY)
      t.maxX = Math.max(t.maxX, maxX)
      t.maxY = Math.max(t.maxY, maxY)
      t.path.moveTo(line[0][0], line[0][1])
      for (let i = 1; i < line.length; i++) t.path.lineTo(line[i][0], line[i][1])
      if (closed) t.path.closePath()
    }
    this.tiles = [...byKey.values()]
  }

  protected *visible(v: BBox): Iterable<Path2D> {
    for (const t of this.tiles) {
      if (t.maxX >= v.minX && t.minX <= v.maxX && t.maxY >= v.minY && t.minY <= v.maxY) yield t.path
    }
  }

  stroke(ctx: CanvasRenderingContext2D, view: BBox, color: string, width: number): void {
    ctx.strokeStyle = color
    ctx.lineWidth = width
    for (const p of this.visible(view)) ctx.stroke(p)
  }
}

export class LineTiles extends Tiles {
  constructor(lines: Iterable<Line>, tileKm: number) { super(lines, tileKm, false) }
}

export class AreaTiles extends Tiles {
  constructor(rings: Iterable<Line>, tileKm: number) { super(rings, tileKm, true) }

  fill(ctx: CanvasRenderingContext2D, view: BBox, color: string): void {
    ctx.fillStyle = color
    for (const p of this.visible(view)) ctx.fill(p)
  }
}
