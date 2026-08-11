/**
 * Seeded pseudo-random number generator.
 *
 * The whole simulation runs off this, and the generator's state lives inside
 * GameState rather than in a module global. That is what makes a save file
 * reproducible: reloading a game and playing the same moves produces the same
 * storms, the same plant failures and the same holdout landowners. It also makes
 * the engine testable — "same seed, same outcome" is an assertion we can run.
 */

/** mulberry32: small, fast, and good enough for game randomness. */
export function nextRandom(state: number): [value: number, nextState: number] {
  let t = (state + 0x6d2b79f5) | 0
  t = Math.imul(t ^ (t >>> 15), 1 | t)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296
  return [value, t | 0]
}

/**
 * A cursor over the random stream. Callers mutate this and write `state` back
 * into GameState, which keeps the plumbing readable at call sites.
 */
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

  /** True with the given probability. */
  chance(p: number): boolean {
    return this.next() < p
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.min(items.length - 1, Math.floor(this.next() * items.length))]
  }

  /** Approximately normal, via the sum of three uniforms. */
  normal(mean: number, stdDev: number): number {
    const u = this.next() + this.next() + this.next()
    return mean + ((u - 1.5) / 0.5) * stdDev * 0.5774
  }
}

/** Derive a stable sub-seed, so unrelated systems don't share a stream. */
export function deriveSeed(seed: number, label: string): number {
  let h = seed | 0
  for (let i = 0; i < label.length; i++) {
    h = Math.imul(h ^ label.charCodeAt(i), 0x01000193) | 0
  }
  return h
}
