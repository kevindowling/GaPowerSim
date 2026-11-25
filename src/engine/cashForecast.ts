import type { CashQuarter, GameState } from './types.ts'
import type { QuarterIndex } from './time.ts'
import { quarterOf } from './time.ts'
import { Rng } from './rng.ts'
import { HORIZON_YEAR } from '../data/customerTerms.ts'
import { landQuartersLeft } from './forecast.ts'
import { ledger } from './ledger.ts'
import { advanceProjects } from './turn/resolve.ts'

/** What land still to buy is assumed to cost, as a multiple of its appraisal. Scripted games paid about this. */
export const LAND_MULTIPLE = 2.4

/** Running totals: money in is positive, money out negative. */
export function totalsOf(state: GameState): Record<string, number> {
  const l = ledger(state)
  const out: Record<string, number> = {}
  for (const r of l.received) out[r.label] = r.amount
  for (const r of l.spent) out[r.label] = -r.amount
  return out
}

/** Remember how the quarter ended. Mutates. */
export function recordCash(state: GameState, quarter: QuarterIndex): void {
  const list = (state.cashHistory ??= [])
  list.push({ quarter, cash: state.cash, totals: totalsOf(state) })
  if (list.length > 60) list.shift()
}

/** What moved cash between two records. */
export function changes(before: Record<string, number>, after: Record<string, number>): Array<{ label: string; amount: number }> {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .map((label) => ({ label, amount: (after[label] ?? 0) - (before[label] ?? 0) }))
    .filter((r) => Math.abs(r.amount) >= 50_000)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
}

export interface CashPoint { quarter: QuarterIndex; cash: number; rows: Array<{ label: string; amount: number }> }

/** Cash at the end of each coming quarter if nothing slips and nothing else is ordered. */
export function cashForecast(game: GameState, quarters = 24): CashPoint[] {
  if (game.phase === 'ended') return []
  const s = structuredClone(game)
  // The operating year is settled by quarter here, as later years are.
  if (s.phase === 'operate') s.phase = 'build'
  s.realtime = null
  s.pendingEvent = null
  s.log = []
  s.cashHistory = []
  s.contract.approval = Math.max(60, s.contract.approval ?? 60)
  for (const c of s.customers ?? []) c.approval = Math.max(60, c.approval ?? 60)
  for (const c of Object.values(s.counties)) if (c.approval !== undefined) c.approval = Math.max(60, c.approval)
  const rng = new Rng(1)
  const out: CashPoint[] = []
  const end = Math.min(game.quarter + quarters, quarterOf(HORIZON_YEAR, 4) + 1)
  const land = new Map<string, { settled: QuarterIndex; each: number }>()
  for (const c of s.corridors) {
    const left = landQuartersLeft(s, c)
    if (c.status !== 'acquiring' || left === null) continue
    const cost = Object.entries(c.deals).reduce((n, [id, d]) =>
      n + (d.status === 'accepted' || d.status === 'condemned' ? 0 : (c.takings[id]?.appraisedTotal ?? 0) * LAND_MULTIPLE), 0)
    land.set(c.id, { settled: s.quarter + left - 1, each: cost / left })
  }
  let before = totalsOf(s)
  while (s.quarter < end) {
    for (const c of s.corridors) {
      const plan = land.get(c.id)
      if (!plan || c.status !== 'acquiring') continue
      s.cash -= plan.each
      c.rowPaid += plan.each
      s.record.rowPaid += plan.each
      for (const d of Object.values(c.deals)) {
        // Paid above, so nothing is charged again when the game settles it.
        if (d.status !== 'accepted' && d.status !== 'condemned') {
          d.status = s.quarter >= plan.settled ? 'accepted' : 'holdout'
          d.paid = 0
        }
      }
    }
    advanceProjects(s, rng)
    if ((s.phase as GameState['phase']) === 'operate') { s.phase = 'build'; s.realtime = null }
    const now = totalsOf(s)
    out.push({ quarter: s.quarter, cash: s.cash, rows: changes(before, now) })
    before = now
    s.quarter += 1
  }
  return out
}

/** Change in the last finished quarter. */
export function lastQuarter(game: GameState): { quarter: QuarterIndex; rows: Array<{ label: string; amount: number }> } | null {
  const h: CashQuarter[] = game.cashHistory ?? []
  const last = h[h.length - 1]
  if (!last || last.quarter < game.startQuarter) return null
  return { quarter: last.quarter, rows: changes(h[h.length - 2]?.totals ?? {}, last.totals) }
}
