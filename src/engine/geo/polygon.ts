import pc from 'polygon-clipping'

/** [x, y] in projected km. */
export type Point = [number, number]
/** A closed ring; first and last points are equal. */
export type Ring = Point[]
/** Exterior ring followed by any holes. */
export type Poly = Ring[]
export type MultiPoly = Poly[]

export const KM2_PER_ACRE = 0.00404686
export const ACRES_PER_KM2 = 1 / KM2_PER_ACRE

export function km2ToAcres(km2: number): number {
  return km2 * ACRES_PER_KM2
}

/** Shoelace area of a single ring; sign follows winding. */
export function ringArea(ring: Ring): number {
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  }
  return sum / 2
}

/** Area of a polygon with holes, in km². Always positive. */
export function polyArea(poly: Poly): number {
  if (poly.length === 0) return 0
  let area = Math.abs(ringArea(poly[0]))
  for (let i = 1; i < poly.length; i++) area -= Math.abs(ringArea(poly[i]))
  return Math.max(0, area)
}

export function multiPolyArea(mp: MultiPoly): number {
  let sum = 0
  for (const poly of mp) sum += polyArea(poly)
  return sum
}

export function bbox(mp: MultiPoly): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const poly of mp) {
    for (const p of poly[0] ?? []) {
      if (p[0] < minX) minX = p[0]
      if (p[0] > maxX) maxX = p[0]
      if (p[1] < minY) minY = p[1]
      if (p[1] > maxY) maxY = p[1]
    }
  }
  return [minX, minY, maxX, maxY]
}

export function bboxOverlaps(
  a: [number, number, number, number], b: [number, number, number, number],
): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3])
}

export function centroid(poly: Poly): Point {
  const ring = poly[0]
  if (!ring || ring.length === 0) return [0, 0]
  let x = 0
  let y = 0
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
    a += cross
    x += (ring[j][0] + ring[i][0]) * cross
    y += (ring[j][1] + ring[i][1]) * cross
  }
  if (Math.abs(a) < 1e-12) return ring[0]
  return [x / (3 * a), y / (3 * a)]
}

let clipFailures = 0

export function clipFailureCount(): number {
  return clipFailures
}

function guard<T>(fn: () => T, fallback: T, op: string): T {
  try {
    return fn()
  } catch (e) {
    clipFailures += 1
    if (clipFailures <= 3) {
      console.warn(`polygon ${op} failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    return fallback
  }
}

export function intersect(a: MultiPoly, b: MultiPoly): MultiPoly {
  if (a.length === 0 || b.length === 0) return []
  return guard(() => pc.intersection(a as pc.Geom, b as pc.Geom) as MultiPoly, [], 'intersection')
}

export function subtract(a: MultiPoly, b: MultiPoly): MultiPoly {
  if (b.length === 0) return a
  return guard(() => pc.difference(a as pc.Geom, b as pc.Geom) as MultiPoly, a, 'difference')
}

export function union(polys: MultiPoly[]): MultiPoly {
  if (polys.length === 0) return []
  if (polys.length === 1) return polys[0]
  const [first, ...rest] = polys
  return guard(
    () => pc.union(first as pc.Geom, ...(rest as pc.Geom[])) as MultiPoly,
    polys.flat(),
    'union',
  )
}

/** Points around a circle, used to round the joints of a corridor. */
function disc(center: Point, radius: number, segments = 12): Ring {
  const ring: Ring = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    ring.push([center[0] + radius * Math.cos(a), center[1] + radius * Math.sin(a)])
  }
  ring.push(ring[0])
  return ring
}

export function corridorBuffer(centerline: Point[], halfWidthKm: number): MultiPoly {
  if (centerline.length < 2 || halfWidthKm <= 0) return []

  const pieces: MultiPoly[] = []

  for (let i = 0; i < centerline.length - 1; i++) {
    const [x0, y0] = centerline[i]
    const [x1, y1] = centerline[i + 1]
    const dx = x1 - x0
    const dy = y1 - y0
    const len = Math.hypot(dx, dy)
    if (len < 1e-9) continue
    // Unit normal to the segment.
    const nx = (-dy / len) * halfWidthKm
    const ny = (dx / len) * halfWidthKm
    pieces.push([[[
      [x0 + nx, y0 + ny],
      [x1 + nx, y1 + ny],
      [x1 - nx, y1 - ny],
      [x0 - nx, y0 - ny],
      [x0 + nx, y0 + ny],
    ]]])
  }

  for (let i = 1; i < centerline.length - 1; i++) {
    pieces.push([[disc(centerline[i], halfWidthKm)]])
  }

  return union(pieces)
}

/** Total length of a centerline in km. */
export function centerlineLength(centerline: Point[]): number {
  let len = 0
  for (let i = 0; i < centerline.length - 1; i++) {
    len += Math.hypot(
      centerline[i + 1][0] - centerline[i][0],
      centerline[i + 1][1] - centerline[i][1],
    )
  }
  return len
}
