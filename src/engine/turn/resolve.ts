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

import type { GameState, Plant, Corridor } from '../types.ts'
import { Rng } from '../rng.ts'
import { formatQuarter } from '../time.ts'
import { plantType } from '../../data/plants.ts'
import { capacitySummary, pushLog, countyApproval } from '../state.ts'
import type { Parcel } from '../parcels/types.ts'
import { resolveOffer, condemnationAward } from '../parcels/negotiation.ts'
import { acquisitionComplete } from './corridor.ts'
import { lineClass } from '../../data/transmission.ts'

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

/**
 * Advance right-of-way acquisition and line construction.
 *
 * Offers made during the quarter resolve here, all at once, which gives the
 * acquisition phase its rhythm: make offers, end the quarter, find out who said
 * no, decide what to do about them.
 */
function advanceCorridor(
  corridor: Corridor, state: GameState, rng: Rng, parcels: Map<string, Parcel>,
): void {
  if (corridor.status === 'acquiring') {
    let accepted = 0
    let refused = 0
    let stillInCourt = 0

    for (const [parcelId, deal] of Object.entries(corridor.deals)) {
      const parcel = parcels.get(parcelId)
      const taking = corridor.takings[parcelId]
      if (!parcel || !taking) continue

      if (deal.status === 'offered') {
        const result = resolveOffer(
          parcel, taking, deal,
          countyApproval(state, parcel.countyFips),
          corridor.condemnations,
          rng,
        )
        if (result.accepted) {
          corridor.rowPaid += result.amount
          state.cash -= result.amount
          accepted += 1
        } else {
          refused += 1
        }
      } else if (deal.status === 'condemning') {
        deal.condemnationQuarters -= 1
        if (deal.condemnationQuarters <= 0) {
          // The court sets the price, and it is not a discount for taking by force.
          const award = condemnationAward(taking, rng)
          deal.status = 'condemned'
          deal.paid = award
          corridor.rowPaid += award
          state.cash -= award
          pushLog(
            state, 'politics',
            `Court awards ${parcel.owner} $${(award / 1e3).toFixed(0)}K for ${taking.takenAcres.toFixed(1)} acres. The land is taken.`,
            true,
          )
        } else {
          stillInCourt += 1
        }
      }
    }

    if (accepted > 0 || refused > 0) {
      pushLog(
        state, 'money',
        `${corridor.name}: ${accepted} signed, ${refused} refused.`,
        refused > 0,
      )
    }
    if (stillInCourt > 0) corridor.delayQuarters += 1

    if (acquisitionComplete(corridor)) {
      corridor.status = 'building'
      pushLog(state, 'grid', `${corridor.name}: right-of-way complete, construction begins.`, true)
    }
    return
  }

  if (corridor.status === 'building') {
    const spend = Math.min(
      corridor.capexTotal - corridor.capexSpent,
      corridor.capexTotal / Math.max(1, corridor.buildQuartersRemaining),
    )
    corridor.capexSpent += spend
    state.cash -= spend

    corridor.buildQuartersRemaining -= 1
    if (corridor.buildQuartersRemaining <= 0) {
      const remainder = corridor.capexTotal - corridor.capexSpent
      corridor.capexSpent = corridor.capexTotal
      state.cash -= remainder
      corridor.status = 'energized'
      pushLog(
        state, 'grid',
        `${corridor.name} is energized — ${lineClass(corridor.classId).ratingMw} MW of transfer capability.`,
        true,
      )
    }
  }
}

/** Transfer capability into the campus from energized corridors. */
export function deliverableMw(state: GameState): number {
  return state.corridors
    .filter((c) => c.status === 'energized')
    .reduce((sum, c) => sum + lineClass(c.classId).ratingMw, 0)
}

/**
 * True once the load can actually be served — which takes BOTH firm generation
 * and a wire to carry it. Generation alone is a power plant with nowhere to send
 * its output.
 */
function checkEnergized(state: GameState): void {
  if (state.energizedQuarter !== null) return
  const cap = capacitySummary(state)
  if (cap.onlineFirmMw + 1e-6 < state.contract.contractedMw) return
  if (deliverableMw(state) + 1e-6 < state.contract.contractedMw) return

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

export interface TurnContext {
  /** Parcels for any county a corridor touches, keyed by id. */
  parcels?: Map<string, Parcel>
}

export function endQuarter(prev: GameState, ctx: TurnContext = {}): QuarterResult {
  const state: GameState = structuredClone(prev)
  const rng = new Rng(state.rngState)
  const logStart = state.log.length
  const parcels = ctx.parcels ?? new Map<string, Parcel>()

  // 1. Construction and permitting advance, burning capital as they go.
  for (const plant of state.plants) advancePlant(plant, state, rng)

  // 2. Right-of-way offers resolve, condemnations tick, line construction runs.
  for (const corridor of state.corridors) advanceCorridor(corridor, state, rng, parcels)

  // 3. Is there now both enough firm generation and a wire to carry it?
  checkEnergized(state)

  // 4. The developer pays against milestones — including, possibly, the one
  //    that just became true.
  releaseMilestones(state)

  // 5. Late penalties. These accrue every quarter past the date, not once.
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

  // 6. Carrying a negative balance costs money, which is how overcommitting
  //    early quietly compounds into a problem later.
  if (state.cash < 0) {
    const interest = -state.cash * FINANCING_RATE_PER_QUARTER
    state.financingCost += interest
    state.cash -= interest
  }

  // 7. Time passes.
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
