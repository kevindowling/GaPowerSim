import type { CapexMilestone, Customer, GameState } from './types.ts'
import type { QuarterIndex } from './time.ts'
import type { Scenario } from '../data/scenarios.ts'

/** Share of the advance paid on signing. Invented. */
export const SIGNING_SHARE = 0.3
/** Share of an installment lost for each quarter late. Invented. */
export const LATE_STEP = 0.1
/** An installment never falls below this share. Invented. */
export const LATE_FLOOR = 0.3

/** One payment on signing, then one for each phase. */
export function installments(count: number, mwEach: number, due: readonly QuarterIndex[]): CapexMilestone[] {
  const each = (1 - SIGNING_SHARE) / count
  return [
    { id: 'signing', label: 'Contract signed', fraction: SIGNING_SHARE, trigger: 'signed', released: false },
    ...due.map((dueQuarter, i) => ({
      id: `phase-${i + 1}`, label: `${Math.round((i + 1) * mwEach).toLocaleString()} MW at the campus`, fraction: each,
      trigger: 'phase' as const, phase: i + 1, dueQuarter, released: false,
    })),
  ]
}

export const paymentSchedule = (sc: Scenario): CapexMilestone[] =>
  installments(sc.phasing.count, sc.phasing.mwEach, sc.phasing.due)

/** Share of an installment paid when its power arrives in a quarter. */
export function shareIfPaid(m: CapexMilestone, quarter: QuarterIndex): number {
  if (m.dueQuarter === undefined) return 1
  return Math.max(LATE_FLOOR, 1 - LATE_STEP * Math.max(0, quarter - m.dueQuarter))
}

/** What an installment pays if its power arrives in a quarter. */
export function amountIfPaid(
  state: GameState, m: CapexMilestone, quarter: QuarterIndex, advance = state.contract.capexAdvance,
): number {
  return advance * m.fraction * shareIfPaid(m, quarter)
}

function unpaid(state: GameState, list: readonly CapexMilestone[], advance: number): number {
  return list.reduce((n, m) => n + (m.released ? 0 : amountIfPaid(state, m, state.quarter, advance)), 0)
}

/** Unpaid at this quarter's value, whether or not it can still be earned. */
export function owedAdvance(state: GameState): number {
  return unpaid(state, state.contract.milestones, state.contract.capexAdvance)
}

/** Payments still to come from the first data center, at what they are worth this quarter. */
export function unpaidAdvance(state: GameState): number {
  return state.contract.status === 'failed' || state.contract.status === 'offered' ? 0 : unpaid(state, state.contract.milestones, state.contract.capexAdvance)
}

export function customerUnpaid(state: GameState, c: Customer): number {
  return c.status === 'cancelled' ? 0 : unpaid(state, c.milestones, c.advance)
}

/** Payments still to come from every data center. */
export function allUnpaid(state: GameState): number {
  return (state.customers ?? []).reduce((n, c) => n + customerUnpaid(state, c), unpaidAdvance(state))
}

/** Pay an installment. Mutates. */
export function payInstallment(state: GameState, m: CapexMilestone, advance: number): { amount: number; lost: number } {
  const amount = amountIfPaid(state, m, state.quarter, advance)
  m.released = true
  m.paid = amount
  m.paidQuarter = state.quarter
  state.cash += amount
  return { amount, lost: Math.round((1 - shareIfPaid(m, state.quarter)) * 100) }
}
