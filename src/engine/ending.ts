/** Deciding when a scenario is over, and scoring it when it is. */

import type { GameState, Ending } from './types.ts'
import { scoreScenario } from './scoring.ts'
import { pushLog } from './state.ts'
import { HORIZON_YEAR } from '../data/customerTerms.ts'
import { quarterOf } from './time.ts'
import { settleUp } from './customers.ts'
import { phasesOn, phasing } from './phases.ts'
import { approvalOf, CANCEL_BELOW } from './approval.ts'

/** Quarters past the deadline before the customer gives up. */
export const TERMINATION_QUARTERS_LATE = 9

function reasonToStop(state: GameState): Ending | null {
  if (state.cash < -state.creditLimit) return 'insolvent'
  if (state.energizedQuarter === null
    && state.contract.status === 'accepted'
    && state.quarter - state.contract.inServiceQuarter >= TERMINATION_QUARTERS_LATE) {
    return 'terminated'
  }
  return null
}

export function endScenario(state: GameState, ending: Ending): void {
  if (state.ending) return
  state.ending = ending
  state.phase = 'ended'
  state.pendingEvent = null
  if (state.realtime) state.realtime.speed = 0
  if (ending !== 'completed') state.contract.status = 'failed'
  if (ending === 'cancelled' || ending === 'terminated') refundMain(state)
  if (ending === 'completed' && state.quarter > quarterOf(HORIZON_YEAR, 4)) settleUp(state)
  state.outcome = scoreScenario(state)
  pushLog(state, 'system', state.outcome.headline, true)
}

/** What would be given back if the first data center were cancelled now: the signing payment, for phases not on. */
export function mainRefundDue(state: GameState): number {
  const m = state.contract.milestones[0]
  if (!m?.released || m.trigger !== 'signed' || state.contract.phasesOn === undefined) return 0
  return (m.paid ?? 0) * (1 - phasesOn(state) / phasing(state).count)
}

function refundMain(state: GameState): void {
  const due = state.refunded === undefined ? mainRefundDue(state) : 0
  if (due <= 0) return
  state.refunded = due
  state.cash -= due
  pushLog(state, 'money', `You give ${state.contract.developer} back $${(due / 1e6).toFixed(0)}M of the signing payment.`, true)
}

/** Checked as a build quarter ends. Mutates. */
export function checkCancelled(state: GameState): boolean {
  if (state.ending || state.phase !== 'build' || state.contract.status !== 'accepted') return false
  if (approvalOf(state) >= CANCEL_BELOW) return false
  return loseMain(state, 'cancelled', `${state.contract.name} lost local approval and was cancelled.`)
}

/** Mutates. Returns true if the scenario just ended. */
export function checkEnding(state: GameState): boolean {
  if (state.ending) return false
  const reason = reasonToStop(state)
  if (reason === 'terminated') return loseMain(state, reason, `${state.contract.name} was too late and was cancelled.`)
  if (reason) {
    endScenario(state, reason)
    return true
  }
  if ((state.afterYear || state.contract.status === 'failed' || state.contract.status === 'offered') && state.quarter > quarterOf(HORIZON_YEAR, 4)) {
    endScenario(state, 'completed')
    return true
  }
  return false
}

/** The first data center is lost. The game goes on if there are others. Returns true if it ended. */
function loseMain(state: GameState, ending: Ending, text: string): boolean {
  if (!(state.customers ?? []).some((c) => c.status !== 'cancelled')) {
    endScenario(state, ending)
    return true
  }
  refundMain(state)
  state.contract.status = 'failed'
  const back = state.mainSpareMw ?? 0
  state.mainSpareMw = 0
  pushLog(state, 'politics', `${text}${back > 0 ? ` ${back} MW of spare power is free again.` : ''} You still supply the others.`, true)
  return false
}

/** Whether there is more to do after the first data center's year. */
export function canContinue(state: GameState): boolean {
  return state.ending === 'completed' && !state.afterYear && state.contract.status === 'served'
}

/** Carry on supplying every data center. Returns a new state. */
export function continueGame(prev: GameState): GameState {
  if (!canContinue(prev)) return prev
  const state = structuredClone(prev)
  state.ending = null
  state.outcome = null
  state.phase = 'build'
  // The ledger keeps what the year cost.
  state.phaseEnergyCost = (state.phaseEnergyCost ?? 0) + (state.realtime?.fuelCost ?? 0) + (state.realtime?.marketCost ?? 0)
  state.realtime = null
  state.afterYear = true
  return state
}
