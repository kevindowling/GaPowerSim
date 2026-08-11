/**
 * Quarter resolution — the heart of the build phase.
 *
 * The player spends a quarter making decisions, then ends it, and everything
 * lands at once: construction advances and burns capital, the developer releases
 * money against milestones, counties drift, and the deadline gets one quarter
 * closer whether or not anything is ready.
 *
 * `endQuarter` returns a NEW state and never mutates its argument, so the UI can
 * keep the previous quarter around to diff against and show the player what
 * changed.
 */

import type { GameState, Plant } from '../types.ts'
import { Rng } from '../rng.ts'
import { formatQuarter } from '../time.ts'
import { plantType } from '../../data/plants.ts'
import { capacitySummary, pushLog, countyApproval } from '../state.ts'

/** Annualised cost of carrying a negative cash balance. */
const FINANCING_RATE_PER_QUARTER = 0.0155

/**
 * Construction spending follows an S-curve: slow at first while the site is
 * prepared, heavy through the middle, tapering at commissioning. Straight-line
 * spending would misprice the decision to cancel a project halfway.
 */
function spendCurve(fractionComplete: number): number {
  // Derivative of a smoothstep, normalised so the whole curve integrates to 1.
  const x = Math.min(1, Math.max(0, fractionComplete))
  return 6 * x * (1 - x)
}

function advancePlant(plant: Plant, state: GameState, rng: Rng): void {
  const t = plantType(plant.typeId)

  if (plant.status === 'permitting') {
    // A hostile county does not deny the permit outright — it just takes
    // longer, every time, which is far harder to plan around.
    const approval = countyApproval(state, plant.countyFips)
    const stalls = approval < 35 && rng.chance(approval < 20 ? 0.45 : 0.22)
    if (stalls) {
      pushLog(
        state, 'politics',
        `${plant.name}: permit review extended another quarter in ${countyName(state, plant.countyFips)} County.`,
      )
      return
    }

    plant.quartersRemaining -= 1
    if (plant.quartersRemaining <= 0) {
      plant.status = 'construction'
      plant.quartersRemaining = t.buildQuarters
      pushLog(state, 'build', `${plant.name}: permits issued, construction begins.`, true)
    }
    return
  }

  if (plant.status === 'construction') {
    const done = t.buildQuarters - plant.quartersRemaining
    const fraction = done / t.buildQuarters
    const spend = Math.min(
      plant.capexTotal - plant.capexSpent,
      (plant.capexTotal * spendCurve(fraction)) / t.buildQuarters,
    )
    plant.capexSpent += spend
    state.cash -= spend

    plant.quartersRemaining -= 1
    if (plant.quartersRemaining <= 0) {
      // Settle any rounding so the books close exactly.
      const remainder = plant.capexTotal - plant.capexSpent
      plant.capexSpent = plant.capexTotal
      state.cash -= remainder
      plant.status = 'online'
      plant.commissionedQuarter = state.quarter
      pushLog(
        state, 'build',
        `${plant.name} is online — ${plant.nameplateMw} MW nameplate, ` +
        `${Math.round(plant.nameplateMw * t.firmCapacityFraction)} MW firm.`,
        true,
      )
    }
  }
}

function countyName(state: GameState, fips: string): string {
  return state.counties[fips]?.name ?? fips
}

/** Release developer capital for any milestone whose trigger is now satisfied. */
function releaseMilestones(state: GameState): void {
  const c = state.contract
  const anyPermitted = state.plants.some((p) => p.status !== 'permitting')
  const halfBuilt = state.plants.length > 0 && state.plants.every((p) => {
    if (p.status === 'online') return true
    if (p.status !== 'construction') return false
    return p.capexSpent >= p.capexTotal * 0.5
  })

  for (const m of c.milestones) {
    if (m.released) continue
    const met =
      m.trigger === 'signed' ? c.status === 'accepted'
      : m.trigger === 'permits-issued' ? anyPermitted
      : m.trigger === 'construction-half' ? halfBuilt
      : state.energizedQuarter !== null

    if (!met) continue
    m.released = true
    const amount = c.capexAdvance * m.fraction
    state.cash += amount
    pushLog(
      state, 'money',
      `${c.developer} released $${(amount / 1e6).toFixed(0)}M — ${m.label.toLowerCase()}.`,
      true,
    )
  }
}

/** True once online firm capacity covers the contracted load. */
function checkEnergized(state: GameState): void {
  if (state.energizedQuarter !== null) return
  const cap = capacitySummary(state)
  if (cap.onlineFirmMw + 1e-6 < state.contract.contractedMw) return

  state.energizedQuarter = state.quarter
  state.contract.status = 'served'
  const late = state.quarter - state.contract.inServiceQuarter
  pushLog(
    state, 'grid',
    late <= 0
      ? `${state.contract.name} is energized at ${state.contract.contractedMw} MW — ${
          late === 0 ? 'on the deadline' : `${-late} quarter${late === -1 ? '' : 's'} early`}.`
      : `${state.contract.name} is energized at ${state.contract.contractedMw} MW, ${late} quarter${late === 1 ? '' : 's'} late.`,
    true,
  )
}

export interface QuarterResult {
  state: GameState
  /** What changed, for the end-of-quarter summary card. */
  headlines: string[]
}

export function endQuarter(prev: GameState): QuarterResult {
  const state: GameState = structuredClone(prev)
  const rng = new Rng(state.rngState)
  const logStart = state.log.length

  // 1. Construction and permitting advance, burning capital as they go.
  for (const plant of state.plants) advancePlant(plant, state, rng)

  // 2. Did that bring enough firm capacity online to serve the contract?
  checkEnergized(state)

  // 3. The developer pays against milestones — including, possibly, the one
  //    that just became true.
  releaseMilestones(state)

  // 4. Late penalties. These accrue every quarter past the date, not once.
  if (state.energizedQuarter === null && state.quarter >= state.contract.inServiceQuarter) {
    const penalty = state.contract.latePenaltyPerQuarter
    state.penaltiesAccrued += penalty
    state.cash -= penalty
    pushLog(
      state, 'money',
      `Late penalty: $${(penalty / 1e6).toFixed(0)}M owed to ${state.contract.developer}.`,
      true,
    )
  }

  // 5. Carrying a negative balance costs money, which is how overcommitting
  //    early quietly compounds into a problem later.
  if (state.cash < 0) {
    const interest = -state.cash * FINANCING_RATE_PER_QUARTER
    state.financingCost += interest
    state.cash -= interest
  }

  // 6. Time passes.
  state.quarter += 1
  state.rngState = rng.state

  const headlines = state.log.slice(logStart).filter((e) => e.important).map((e) => e.text)
  return { state, headlines }
}

/** Accept the offered contract. Returns a new state. */
export function acceptContract(prev: GameState): GameState {
  const state: GameState = structuredClone(prev)
  if (state.contract.status !== 'offered') return state
  state.contract.status = 'accepted'
  pushLog(
    state, 'deal',
    `Signed: ${state.contract.contractedMw} MW to ${state.contract.name} by ${formatQuarter(state.contract.inServiceQuarter)}.`,
    true,
  )
  releaseMilestones(state)
  return state
}
