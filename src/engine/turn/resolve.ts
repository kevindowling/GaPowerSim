import type { GameState, Plant, Corridor } from '../types.ts'
import { Rng } from '../rng.ts'
import { formatQuarter, quarterInYear } from '../time.ts'
import { plantType } from '../../data/plants.ts'
import { pushLog } from '../state.ts'
import {
  resolveOffer, condemnationAward, highestMultiplePaid, negotiationContext,
} from '../parcels/negotiation.ts'
import { acquisitionComplete } from './corridor.ts'
import { firmDeliverableMw, firmFlow } from '../realtime/network.ts'
import { drawBuildEvent, resolvePendingByDefault } from '../events/events.ts'
import { checkCancelled, checkEnding } from '../ending.ts'
import { approvalOf, CANCEL_BELOW, changeApproval, changeRating, ratingOf, STALL_BELOW } from '../approval.ts'
import { advanceCustomers, checkCustomers, mainOpen, reportOffers, settleCustomers, warnCustomers } from '../customers.ts'
import { advanceSubstations } from './substations.ts'
import { CREDIT_PER_MW } from '../../data/customerTerms.ts'
import { recordCash } from '../cashForecast.ts'
import { payInstallment } from '../payments.ts'
import { phasesOn, phasing, settlePhases, turnOnPhases } from '../phases.ts'
import { advanceEquipment, equipmentSpent } from './equipment.ts'
import { drawOutsideEvents } from '../events/outside.ts'
import { lineClass } from '../../data/transmission.ts'
import { createRealtimeState, QUARTER_TICKS, TICKS_PER_DAY, TICKS_PER_HOUR } from '../realtime/types.ts'
import { advanceTutorial } from '../tutorial.ts'
import type { HearingOption } from './hearing.ts'
import { batteryCapacityMwh } from '../realtime/dispatch.ts'

/** Interest per quarter on a negative cash balance. */
const FINANCING_RATE_PER_QUARTER = 0.0155

function spendCurve(fractionComplete: number): number {
  // Derivative of a smoothstep, normalised so the whole curve integrates to 1.
  const x = Math.min(1, Math.max(0, fractionComplete))
  return 6 * x * (1 - x)
}

function advancePlant(plant: Plant, state: GameState, rng: Rng): void {
  const t = plantType(plant.typeId)

  if (plant.status === 'permitting') {
    const stalls = (ratingOf(state, plant.countyFips) ?? 100) < STALL_BELOW && rng.chance(0.22)
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
      const remainder = plant.capexTotal - plant.capexSpent
      plant.capexSpent = plant.capexTotal
      state.cash -= remainder
      plant.status = 'online'
      plant.commissionedQuarter = state.quarter
      if (plant.typeId === 'battery') plant.socMwh = batteryCapacityMwh(plant)
    }
  }
}

function reportOnline(state: GameState, plants: readonly Plant[]): void {
  if (plants.length === 0) return
  const flow = firmFlow(state)
  for (const p of plants) {
    const power = flow.plants.get(p.id)
    if (!power) continue
    const why = power.limit?.kind === 'no-line' ? ' No line in service connects it.'
      : power.limit?.kind === 'no-transformer' ? ` There is no ${power.limit.kv} kV transformer in service at the ${power.limit.place}.`
      : power.limit?.kind === 'lines' ? ' The line is full.' : ''
    pushLog(
      state, 'build',
      `${p.name} is online: ${p.nameplateMw} MW, ${Math.round(power.firmMw)} MW firm. ` +
      `${Math.round(power.arrivingMw)} MW reaches the campus.${why}`,
      true,
    )
  }
}

function countyName(state: GameState, fips: string): string {
  return state.counties[fips]?.name ?? fips
}

/** Pay every installment that has been earned. The triggers other than signed and phase are in older saves. */
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
      : m.trigger === 'phase' ? phasesOn(state) >= (m.phase ?? 1)
      : m.trigger === 'permits-issued' ? anyPermitted
      : m.trigger === 'construction-half' ? halfBuilt
      : state.energizedQuarter !== null

    if (!met) continue
    const { amount, lost } = payInstallment(state, m, c.capexAdvance)
    pushLog(
      state, 'money',
      `${c.developer} paid $${(amount / 1e6).toFixed(0)}M: ${m.label}${lost > 0 ? `, ${lost}% less for being late` : ''}.`,
      true,
    )
  }
}

function advanceCorridor(corridor: Corridor, state: GameState, rng: Rng): void {
  if (corridor.status === 'acquiring') {
    let accepted = 0
    let refused = 0
    let stillInCourt = 0
    const bestPaid = highestMultiplePaid(corridor)

    for (const [parcelId, deal] of Object.entries(corridor.deals)) {
      const parcel = corridor.parcels[parcelId]
      const taking = corridor.takings[parcelId]
      if (!parcel || !taking) continue

      if (deal.status === 'offered') {
        const result = resolveOffer(
          parcel, taking, deal,
          negotiationContext(state, corridor, parcel.countyFips, bestPaid),
        )
        if (result.accepted) {
          corridor.rowPaid += result.amount
          state.record.rowPaid += result.amount
          state.cash -= result.amount
          accepted += 1
        } else {
          refused += 1
        }
      } else if (deal.status === 'condemning') {
        deal.condemnationQuarters -= 1
        if (deal.condemnationQuarters <= 0) {
          const award = condemnationAward(taking, rng)
          deal.status = 'condemned'
          deal.paid = award
          corridor.rowPaid += award
          state.record.rowPaid += award
          state.cash -= award
          pushLog(
            state, 'politics',
            `The court awards ${parcel.owner} $${(award / 1e3).toFixed(0)}K for ${taking.takenAcres.toFixed(1)} acres.`,
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
      if (state.hearing === 'not-called') {
        state.hearing = 'called'
        pushLog(state, 'politics', 'The county commission has called a hearing on who pays for the network upgrades.', true)
      }
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
        `${corridor.name} is in service, rated ${lineClass(corridor.classId).ratingMw} MW.`,
        true,
      )
    }
  }
}

function checkEnergized(state: GameState): void {
  if (state.energizedQuarter !== null || state.contract.status !== 'accepted') return
  if (firmDeliverableMw(state) + 1e-6 < state.contract.contractedMw) return

  state.energizedQuarter = state.quarter
  state.contract.status = 'served'
  state.contract.phasesOn = phasing(state).count
  // Operations start on the first day of the next quarter.
  const startTick = quarterInYear(state.quarter + 1) === 1
    ? 0
    : (quarterInYear(state.quarter + 1) - 1) * QUARTER_TICKS
  state.realtime = createRealtimeState(startTick)
  state.phase = 'operate'
  if (state.tutorial) state.tutorial.stormAtTick = tutorialStormTick(startTick)

  const late = state.quarter - state.contract.inServiceQuarter
  pushLog(
    state, 'grid',
    late <= 0
      ? `${state.contract.name} is energized ${
          late === 0 ? 'on the deadline' : `${-late} quarter${late === -1 ? '' : 's'} early`}.`
      : `${state.contract.name} is energized ${late} quarter${late === 1 ? '' : 's'} late.`,
    true,
  )
}

/** First mid-July evening at least three weeks after energization. */
function tutorialStormTick(startTick: number): number {
  const target = 195 * TICKS_PER_DAY + 18 * TICKS_PER_HOUR
  let delta = target - startTick
  if (delta < 21 * TICKS_PER_DAY) delta += 365 * TICKS_PER_DAY
  // A start after late June would push this past the end of the year.
  return Math.min(delta, 340 * TICKS_PER_DAY)
}

export function advanceProjects(state: GameState, rng: Rng): void {
  if (state.phase === 'build' && state.contract.status !== 'failed') settlePhases(state)
  settleCustomers(state)
  const waiting = new Set(state.plants.filter((p) => p.status !== 'online').map((p) => p.id))
  for (const plant of state.plants) advancePlant(plant, state, rng)
  for (const corridor of state.corridors) advanceCorridor(corridor, state, rng)
  advanceEquipment(state)
  advanceSubstations(state)
  reportOnline(state, state.plants.filter((p) => waiting.has(p.id) && p.status === 'online'))
  checkEnergized(state)
  if (state.phase === 'build' && state.contract.status === 'accepted') turnOnPhases(state)
  if (state.contract.status !== 'failed') releaseMilestones(state)
  advanceCustomers(state)

  for (const c of Object.values(state.counties)) {
    const rating = ratingOf(state, c.fips)
    if (rating !== null && rating < 50 && c.grievances.length > 0) {
      changeRating(state, c.fips, Math.min(0.6, 50 - rating), 'Time passing')
    }
  }

  if (state.cash < 0) {
    const interest = -state.cash * FINANCING_RATE_PER_QUARTER
    state.financingCost += interest
    state.cash -= interest
  }
}

function warnOfCancelling(state: GameState): void {
  const a = approvalOf(state)
  if (a >= STALL_BELOW) return
  pushLog(
    state, 'politics',
    a < CANCEL_BELOW
      ? `Data center approval is ${Math.round(a)}. Raise it to ${CANCEL_BELOW} this quarter or the data center is cancelled.`
      : `Data center approval is ${Math.round(a)}. Below ${CANCEL_BELOW} the data center is cancelled.`,
    true,
  )
}

export interface QuarterResult {
  state: GameState
  /** What changed, for the end-of-quarter summary. */
  headlines: string[]
}

export function endQuarter(prev: GameState): QuarterResult {
  const state: GameState = structuredClone(prev)
  if (state.phase !== 'build') return { state: prev, headlines: [] }

  resolvePendingByDefault(state)
  const rng = new Rng(state.rngState)
  const logStart = state.log.length

  advanceProjects(state, rng)

  // Only in saves from before installments.
  if (state.contract.latePenaltyPerQuarter > 0
    && state.energizedQuarter === null && state.contract.status === 'accepted'
    && state.quarter >= state.contract.inServiceQuarter) {
    const penalty = state.contract.latePenaltyPerQuarter
    state.penaltiesAccrued += penalty
    state.cash -= penalty
    pushLog(
      state, 'money',
      `Late penalty: $${(penalty / 1e6).toFixed(0)}M owed to ${state.contract.developer}.`,
      true,
    )
  }

  checkCancelled(state)
  checkCustomers(state)
  recordCash(state, state.quarter)
  state.quarter += 1
  if (state.phase === 'build') {
    if (state.contract.status === 'accepted') drawBuildEvent(state, rng)
    drawOutsideEvents(state)
    if (state.contract.status === 'accepted') warnOfCancelling(state)
    warnCustomers(state)
    reportOffers(state)
  }
  state.rngState = rng.state
  advanceTutorial(state)
  checkEnding(state)

  const headlines = state.log.slice(logStart).filter((e) => e.important).map((e) => e.text)
  return { state, headlines }
}

/** Answer the county commission on who pays for the network upgrades. */
export function resolveHearing(prev: GameState, option: HearingOption): GameState {
  if (prev.hearing === 'resolved') return prev
  const state: GameState = structuredClone(prev)

  if (state.equipment) {
    state.ratepayerShare = option.ratepayerShare
    state.cash += equipmentSpent(state) * option.ratepayerShare
  } else {
    state.cash -= option.cost
  }
  const county = state.counties[state.contract.countyFips]
  if (county) {
    changeApproval(state, option.approvalDelta, 'Hearing on network upgrades')
    if (option.grievance) county.grievances.push(option.grievance)
  }

  pushLog(
    state, 'politics',
    option.ratepayerShare === 0
      ? 'You pay for the network upgrades.'
      : option.ratepayerShare === 1
        ? 'The network upgrades go to the rate base. Every customer in the state pays a share.'
        : 'The network upgrade cost is split between you and the rate base.',
    true,
  )

  state.hearing = 'resolved'
  advanceTutorial(state)
  return state
}

export function acceptContract(prev: GameState): GameState {
  const state: GameState = structuredClone(prev)
  if (!mainOpen(state)) return state
  // Dates run from the day it signs.
  const shift = state.quarter - state.startQuarter
  state.contract.inServiceQuarter += shift
  for (const m of state.contract.milestones) if (m.dueQuarter !== undefined) m.dueQuarter += shift
  state.contract.status = 'accepted'
  if (state.started) state.creditLimit += state.contract.contractedMw * CREDIT_PER_MW
  pushLog(
    state, 'deal',
    `Signed: ${state.contract.contractedMw} MW to ${state.contract.name} by ${formatQuarter(state.contract.inServiceQuarter)}.`,
    true,
  )
  releaseMilestones(state)
  return state
}
