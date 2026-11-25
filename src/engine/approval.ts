import type { Customer, GameState, Rating } from './types.ts'
import type { CountiesFile } from './geo/mapTypes.ts'
import { adjacentCounties } from './geo/adjacency.ts'

/** A data center below this when a build quarter ends is cancelled. Invented. */
export const CANCEL_BELOW = 25
/** Permits stall below this. Invented. */
export const STALL_BELOW = 35
/** A neighbouring county below this issues no permits. Invented. */
export const NO_PERMITS_BELOW = 12
/** Below and above these, opinion in a neighbouring county spreads. Invented. */
export const SPREAD_BELOW = 45
export const SPREAD_ABOVE = 65

export const DEFAULT_APPROVAL = 55
const HISTORY_LIMIT = 40

/** Approval of the data center in its own county, 0 to 100. */
export function approvalOf(state: GameState): number {
  return state.contract.approval ?? DEFAULT_APPROVAL
}

function ratingAt(state: GameState, fips: string): Rating | null {
  if (fips === state.contract.countyFips) return state.contract
  const other = state.customers?.find((c) => c.countyFips === fips && c.status !== 'cancelled')
  if (other) return other
  const c = state.counties[fips]
  return c?.adjacent ? c : null
}

/** The data center whose county this is, if any. */
export function homeOf(state: GameState, fips: string): 'main' | Customer | null {
  if (fips === state.contract.countyFips) return 'main'
  return state.customers?.find((c) => c.countyFips === fips && c.status !== 'cancelled') ?? null
}

/** Approval where something is happening. Null where there is no rating. */
export function ratingOf(state: GameState, fips: string): number | null {
  const r = ratingAt(state, fips)
  return r && (r.approval ?? DEFAULT_APPROVAL)
}

export function ratingRecord(state: GameState, fips: string): Readonly<Rating> {
  return ratingAt(state, fips) ?? {}
}

/** Counties that border the data center's. */
export function neighbours(state: GameState): string[] {
  return state.contract.neighbours ?? Object.values(state.counties).filter((c) => c.adjacent).map((c) => c.fips)
}

export interface ChangeOptions { cap?: number; outside?: boolean }

/** Move a rating and record why. Returns the change made. Mutates. */
export function changeRating(
  state: GameState, fips: string, delta: number, reason: string, options: ChangeOptions = {},
): number {
  const r = ratingAt(state, fips)
  if (!r || delta === 0) return 0
  const now = r.approval ?? DEFAULT_APPROVAL
  const top = delta > 0 ? Math.max(now, options.cap ?? 100) : 100
  const next = Math.max(0, Math.min(top, now + delta))
  const made = next - now
  if (made === 0) return 0
  r.approval = next
  const history = (r.history ??= [])
  const last = history[history.length - 1]
  // Small repeated changes in one quarter read as one entry.
  if (last && last.quarter === state.quarter && last.text === reason) last.delta += made
  else history.push({ quarter: state.quarter, text: reason, delta: made, ...(options.outside && { outside: true }) })
  if (history.length > HISTORY_LIMIT) history.shift()
  return made
}

/** Move the data center's own approval. Mutates. */
export function changeApproval(
  state: GameState, delta: number, reason: string, options: ChangeOptions = {},
): number {
  return changeRating(state, state.contract.countyFips, delta, reason, options)
}

/** Bring a saved game up to date. Older saves rated every county. Mutates. */
export function migrateApproval(state: GameState, file: CountiesFile): void {
  for (const fips of adjacentCounties(file, state.contract.countyFips)) {
    if (state.counties[fips]) state.counties[fips].adjacent = true
  }
  if (state.contract.approval !== undefined) return
  const old = state.counties[state.contract.countyFips]
  state.contract.approval = Math.max(CANCEL_BELOW + 5, old?.approval ?? DEFAULT_APPROVAL)
  state.contract.history = old?.history ?? []
  state.contract.programmes = old?.programmes ?? {}
}

export function approvalBand(approval: number): {
  label: string
  tone: 'good' | 'fair' | 'poor' | 'hostile'
} {
  if (approval >= SPREAD_ABOVE) return { label: 'Supportive', tone: 'good' }
  if (approval >= SPREAD_BELOW) return { label: 'Uneasy', tone: 'fair' }
  if (approval >= CANCEL_BELOW) return { label: 'Opposed', tone: 'poor' }
  return { label: 'Hostile', tone: 'hostile' }
}
