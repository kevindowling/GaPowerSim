/** Circumradius in km. Area = (3√3/2)·s² ≈ 1.000 km² at this value. */
export const HEX_SIZE_KM = 0.6204

/** Centre-to-centre distance between horizontally adjacent cells. */
export const HEX_WIDTH_KM = Math.sqrt(3) * HEX_SIZE_KM

/** Centre-to-centre distance between vertically adjacent rows. */
export const HEX_ROW_KM = 1.5 * HEX_SIZE_KM

/** Area of a single cell in km². */
export const HEX_AREA_KM2 = ((3 * Math.sqrt(3)) / 2) * HEX_SIZE_KM * HEX_SIZE_KM

export interface GridSpec {
  /** Projected km of the grid's (0,0) cell centre. */
  originX: number
  originY: number
  cols: number
  rows: number
}

/** Odd-r offset (col,row) → projected km centre point. */
export function cellCenter(spec: GridSpec, col: number, row: number): [number, number] {
  const x = spec.originX + HEX_WIDTH_KM * (col + 0.5 * (row & 1))
  const y = spec.originY + HEX_ROW_KM * row
  return [x, y]
}

/** Projected km → nearest odd-r offset cell. */
export function pointToCell(spec: GridSpec, x: number, y: number): [number, number] {
  // Convert to fractional axial, round in cube space, convert back to offset.
  const px = (x - spec.originX) / HEX_SIZE_KM
  const py = (y - spec.originY) / HEX_SIZE_KM
  const q = (Math.sqrt(3) / 3) * px - (1 / 3) * py
  const r = (2 / 3) * py
  const [aq, ar] = axialRound(q, r)
  return axialToOffset(aq, ar)
}

/** Round fractional axial coordinates to the nearest cell, via cube rounding. */
export function axialRound(q: number, r: number): [number, number] {
  const s = -q - r
  let rq = Math.round(q)
  let rr = Math.round(r)
  const rs = Math.round(s)
  const dq = Math.abs(rq - q)
  const dr = Math.abs(rr - r)
  const ds = Math.abs(rs - s)
  // Discard whichever axis drifted most, so q+r+s === 0 is preserved.
  if (dq > dr && dq > ds) rq = -rr - rs
  else if (dr > ds) rr = -rq - rs
  return [rq, rr]
}

export function offsetToAxial(col: number, row: number): [number, number] {
  return [col - ((row - (row & 1)) >> 1), row]
}

export function axialToOffset(q: number, r: number): [number, number] {
  return [q + ((r - (r & 1)) >> 1), r]
}

/** Distance in cells between two odd-r offset cells. */
export function cellDistance(c1: number, r1: number, c2: number, r2: number): number {
  const [q1, ar1] = offsetToAxial(c1, r1)
  const [q2, ar2] = offsetToAxial(c2, r2)
  return (Math.abs(q1 - q2) + Math.abs(q1 + ar1 - q2 - ar2) + Math.abs(ar1 - ar2)) / 2
}

/** The six axial neighbour directions. */
const AXIAL_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
]

export function neighbors(spec: GridSpec, col: number, row: number, out: number[]): number {
  const [q, r] = offsetToAxial(col, row)
  let n = 0
  for (const [dq, dr] of AXIAL_DIRS) {
    const [nc, nr] = axialToOffset(q + dq, r + dr)
    if (nc < 0 || nr < 0 || nc >= spec.cols || nr >= spec.rows) continue
    out[n * 2] = nc
    out[n * 2 + 1] = nr
    n++
  }
  return n
}

/** Dense array index for an odd-r offset cell. */
export function cellIndex(spec: GridSpec, col: number, row: number): number {
  return row * spec.cols + col
}

/** Corner points of a cell, for rendering. */
export function cellCorners(spec: GridSpec, col: number, row: number): number[] {
  const [cx, cy] = cellCenter(spec, col, row)
  const pts = new Array<number>(12)
  for (let i = 0; i < 6; i++) {
    // Pointy-top: first corner straight up, then every 60°.
    const angle = (Math.PI / 180) * (60 * i - 90)
    pts[i * 2] = cx + HEX_SIZE_KM * Math.cos(angle)
    pts[i * 2 + 1] = cy + HEX_SIZE_KM * Math.sin(angle)
  }
  return pts
}
