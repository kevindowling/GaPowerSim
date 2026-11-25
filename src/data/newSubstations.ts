// DATA STATUS: prices are PG&E's 2025 guide for a substation looped into two
// lines. Land, time and opposition are invented.

export interface SubstationType { kv: 115 | 230 | 500; cost: number; acres: number; quarters: number; friction: number }

export const SUBSTATION_TYPES: readonly SubstationType[] = [
  { kv: 115, cost: 20_000_000, acres: 12, quarters: 5, friction: 0.2 },
  { kv: 230, cost: 23_000_000, acres: 20, quarters: 6, friction: 0.25 },
  { kv: 500, cost: 65_000_000, acres: 60, quarters: 8, friction: 0.4 },
]

/** How near an existing line has to be for the substation to be built on it. */
export const LOOP_KM = 0.6

export function substationType(kv: number): SubstationType {
  return SUBSTATION_TYPES.find((t) => t.kv === kv) ?? SUBSTATION_TYPES[0]
}
