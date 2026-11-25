import type { GameState } from './types.ts'
import { LATE_LIMIT } from '../data/customerTerms.ts'
import { approvalOf, CANCEL_BELOW, DEFAULT_APPROVAL, STALL_BELOW } from './approval.ts'
import { TERMINATION_QUARTERS_LATE } from './ending.ts'

/** Quarters before it leaves at which a late data center is in trouble. Invented. */
const LAST_QUARTERS = 4

/** Why a data center may leave soon, or null. 'main' is the first. */
export function leaving(state: GameState, id: string): string | null {
  if (state.ending) return null
  const c = state.customers?.find((x) => x.id === id)
  if (id === 'main' ? state.contract.status !== 'accepted' : c?.status !== 'signed') return null
  const approval = id === 'main' ? approvalOf(state) : c!.approval ?? DEFAULT_APPROVAL
  if (approval < STALL_BELOW) return `Approval is ${Math.round(approval)}. It leaves below ${CANCEL_BELOW}.`
  const due = id === 'main' ? state.contract.inServiceQuarter
    : c!.milestones.find((m) => !m.released && m.dueQuarter !== undefined)?.dueQuarter
  if (due === undefined || (id === 'main' && state.energizedQuarter !== null)) return null
  const left = due + (id === 'main' ? TERMINATION_QUARTERS_LATE : LATE_LIMIT) - state.quarter
  if (left > LAST_QUARTERS) return null
  return left <= 0 ? 'It leaves this quarter without power.' : `It leaves in ${left} ${left === 1 ? 'quarter' : 'quarters'} without power.`
}
