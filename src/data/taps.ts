// DATA STATUS: plausible figures, not from a utility study.

export type TapKv = 115 | 230 | 500

export interface TapClass {
  kv: TapKv
  /** Spare capacity on the existing lines of this voltage, MW. */
  spareMw: number
  /** Switching station and protection. */
  cost: number
  /** Interconnection study and build. */
  quarters: number
}

export const TAP_CLASSES: readonly TapClass[] = [
  { kv: 115, spareMw: 90, cost: 9_000_000, quarters: 2 },
  { kv: 230, spareMw: 240, cost: 22_000_000, quarters: 2 },
  { kv: 500, spareMw: 250, cost: 58_000_000, quarters: 3 },
]

/** A breaker station on one of the player's own lines. */
export const OWN_TAP_COST = 6_000_000

/** Existing lines further from the substation than this do not feed the area. */
export const TAP_RANGE_KM = 45

export function tapClassFor(kv: number): TapClass | null {
  return [...TAP_CLASSES].reverse().find((t) => kv >= t.kv && kv < t.kv * 2) ?? null
}

/** A breaker position at an existing substation, from the PG&E 2025 guide. */
export const SUB_POSITION_COST = 2_400_000
