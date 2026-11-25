function perpendicularDistanceSq(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return (px - ax) ** 2 + (py - ay) ** 2
  // Project the point onto the segment, clamped to the segment's extent.
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2
}

export function simplifyFlat(coords: number[], toleranceKm: number): number[] {
  const n = coords.length / 2
  if (n < 3) return coords.slice()

  const tolSq = toleranceKm * toleranceKm
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1

  const stack: Array<[number, number]> = [[0, n - 1]]
  while (stack.length > 0) {
    const [first, last] = stack.pop()!
    if (last - first < 2) continue

    const ax = coords[first * 2]
    const ay = coords[first * 2 + 1]
    const bx = coords[last * 2]
    const by = coords[last * 2 + 1]

    let maxDistSq = -1
    let maxIndex = -1
    for (let i = first + 1; i < last; i++) {
      const d = perpendicularDistanceSq(coords[i * 2], coords[i * 2 + 1], ax, ay, bx, by)
      if (d > maxDistSq) {
        maxDistSq = d
        maxIndex = i
      }
    }

    if (maxDistSq > tolSq && maxIndex > 0) {
      keep[maxIndex] = 1
      stack.push([first, maxIndex], [maxIndex, last])
    }
  }

  const out: number[] = []
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push(coords[i * 2], coords[i * 2 + 1])
  }
  return out
}

/** Round a flat coordinate array to a fixed number of decimals, in place. */
export function roundFlat(coords: number[], decimals: number): number[] {
  const f = 10 ** decimals
  for (let i = 0; i < coords.length; i++) {
    coords[i] = Math.round(coords[i] * f) / f
  }
  return coords
}

/** Shoelace area of a closed ring in projected units (positive = counter-clockwise). */
export function ringArea(coords: number[]): number {
  const n = coords.length / 2
  if (n < 3) return 0
  let sum = 0
  for (let i = 0, j = n - 1; i < n; j = i++) {
    sum += coords[j * 2] * coords[i * 2 + 1] - coords[i * 2] * coords[j * 2 + 1]
  }
  return sum / 2
}
