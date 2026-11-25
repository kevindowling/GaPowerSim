export function nextRandom(state: number): [value: number, nextState: number] {
  const next = (state + 0x6d2b79f5) | 0
  let t = next
  t = Math.imul(t ^ (t >>> 15), 1 | t)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296
  // The state is a counter, so it does not repeat for 2^32 draws.
  return [value, next]
}

export class Rng {
  constructor(public state: number) {}

  /** Uniform in [0, 1). */
  next(): number {
    const [v, s] = nextRandom(this.state)
    this.state = s
    return v
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1))
  }

  chance(p: number): boolean {
    return this.next() < p
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.min(items.length - 1, Math.floor(this.next() * items.length))]
  }

  /** Approximately normal, via the sum of three uniforms. */
  normal(mean: number, stdDev: number): number {
    const u = this.next() + this.next() + this.next()
    return mean + ((u - 1.5) / 0.5) * stdDev
  }
}

/** Derive a stable sub-seed, so unrelated systems don't share a stream. */
export function deriveSeed(seed: number, label: string): number {
  let h = seed | 0
  for (let i = 0; i < label.length; i++) {
    h = Math.imul(h ^ label.charCodeAt(i), 0x01000193) | 0
  }
  // Similar labels would otherwise give similar streams.
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) | 0
}
