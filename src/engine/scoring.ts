/**
 * The scorecard.
 *
 * Deliberately not a single number with a win/lose attached. The game's whole
 * argument is that these projects trade off against each other — you can hit
 * every date and leave a county that will never trust you again, or keep
 * everyone happy and blow the deadline — so the scorecard reports all of the
 * currencies and lets the headline say the uncomfortable part out loud.
 */

import type { GameState, Outcome } from './types.ts'
import { formatQuarter } from './time.ts'
import { reliabilityIndices } from './realtime/operate.ts'

function money(v: number): string {
  const abs = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`
  return `${sign}$${Math.round(abs / 1e3)}K`
}

export interface ScoreParts {
  onTime: number
  capital: number
  community: number
  reliability: number
  restraint: number
}

/**
 * Five components, each 0–20.
 *
 * `restraint` is the count of parcels taken by force. It is scored separately
 * from community approval on purpose: a county can forgive you, and the record
 * of what you did still exists.
 */
export function scoreParts(state: GameState): ScoreParts {
  const c = state.contract
  const rt = state.realtime

  // On time: full marks for hitting the date, falling away per quarter late.
  const late = state.energizedQuarter === null
    ? Math.max(0, state.quarter - c.inServiceQuarter) + 4
    : Math.max(0, state.energizedQuarter - c.inServiceQuarter)
  const onTime = Math.max(0, 20 - late * 4)

  // Capital: what is left of the advance after everything.
  const spentRatio = Math.max(0, 1 - state.cash / Math.max(c.capexAdvance, 1))
  const capital = Math.max(0, Math.min(20, 20 * (1.35 - spentRatio)))

  // Community: approval across every county the project touched.
  const touched = Object.values(state.counties).filter(
    (s) => s.fips === c.countyFips || state.plants.some((p) => p.countyFips === s.fips),
  )
  const meanApproval = touched.length > 0
    ? touched.reduce((sum, s) => sum + s.approval, 0) / touched.length
    : 50
  const community = Math.max(0, Math.min(20, (meanApproval / 100) * 20))

  // Reliability: how much of the contracted energy actually arrived, and
  // whether the lights stayed on for everyone else.
  let reliability = 20
  if (rt) {
    const idx = reliabilityIndices(rt)
    reliability = Math.max(0, Math.min(20, idx.contractAvailability * 20))
    // Every megawatt-hour of customer load shed is a separate debt.
    reliability -= Math.min(8, rt.unservedCustomerMwh / 40)
    reliability = Math.max(0, reliability)
  }

  const condemnations = state.corridors.reduce((n, x) => n + x.condemnations, 0)
  const restraint = Math.max(0, 20 - condemnations * 6)

  return { onTime, capital, community, reliability, restraint }
}

function grade(score: number): string {
  if (score >= 88) return 'A'
  if (score >= 76) return 'B'
  if (score >= 62) return 'C'
  if (score >= 48) return 'D'
  return 'F'
}

/**
 * The headline.
 *
 * Picks the most interesting true thing about the run rather than the highest
 * number, because "you delivered, and Sumter County will never forgive you" is a
 * more honest summary than "82/100".
 */
function headlineFor(state: GameState, parts: ScoreParts, score: number): string {
  const condemnations = state.corridors.reduce((n, c) => n + c.condemnations, 0)
  const late = state.energizedQuarter !== null
    && state.energizedQuarter > state.contract.inServiceQuarter
  const shedCustomers = (state.realtime?.unservedCustomerMwh ?? 0) > 20

  if (state.energizedQuarter === null) {
    return 'The campus never energized. Liberty is still billing you for every quarter it waits.'
  }
  if (shedCustomers && parts.onTime >= 16) {
    return 'You met every date, and the people of Sumter County sat in the dark to make it happen.'
  }
  if (condemnations >= 3) {
    return `You took ${condemnations} properties by force. The line runs, and the county remembers.`
  }
  if (condemnations > 0 && parts.community < 10) {
    return 'Delivered — and you will not be welcome at the next county commission meeting.'
  }
  if (late && parts.community >= 15) {
    return 'Late, over budget, and you never took a single acre anyone did not sell you.'
  }
  if (late) {
    return 'The power arrived. It arrived after the date you promised, and that cost real money.'
  }
  if (score >= 88) {
    return 'On time, on budget, and nobody had to be forced off their land. That is rarer than it sounds.'
  }
  if (parts.capital < 8) {
    return 'The power is on. Getting there cost far more than the customer put up.'
  }
  return 'Four hundred megawatts, delivered. Now do it again, next county over.'
}

export function scoreScenario(state: GameState): Outcome {
  const parts = scoreParts(state)
  const score = Math.round(
    parts.onTime + parts.capital + parts.community + parts.reliability + parts.restraint,
  )

  const c = state.contract
  const condemnations = state.corridors.reduce((n, x) => n + x.condemnations, 0)
  const rowPaid = state.corridors.reduce((n, x) => n + x.rowPaid, 0)
  const legal = state.corridors.reduce((n, x) => n + x.legalCosts, 0)
  const rt = state.realtime
  const idx = rt ? reliabilityIndices(rt) : null

  const touched = Object.values(state.counties).filter(
    (s) => s.fips === c.countyFips || state.plants.some((p) => p.countyFips === s.fips),
  )
  const meanApproval = touched.length > 0
    ? touched.reduce((sum, s) => sum + s.approval, 0) / touched.length
    : 50

  const lines: Outcome['lines'] = [
    {
      label: 'Energized',
      value: state.energizedQuarter !== null ? formatQuarter(state.energizedQuarter) : 'never',
      tone: state.energizedQuarter === null ? 'bad'
        : state.energizedQuarter <= c.inServiceQuarter ? 'good' : 'bad',
    },
    {
      label: 'Against a deadline of',
      value: formatQuarter(c.inServiceQuarter),
      tone: 'plain',
    },
    { label: 'Cash remaining', value: money(state.cash), tone: state.cash < 0 ? 'bad' : 'good' },
    { label: 'Paid to landowners', value: money(rowPaid), tone: 'plain' },
    {
      label: 'Properties condemned',
      value: String(condemnations),
      tone: condemnations === 0 ? 'good' : 'bad',
    },
    {
      label: 'Legal fees',
      value: money(legal),
      tone: legal > 0 ? 'bad' : 'plain',
    },
    {
      label: 'Penalties',
      value: money(state.penaltiesAccrued),
      tone: state.penaltiesAccrued > 0 ? 'bad' : 'good',
    },
    {
      label: 'County approval',
      value: `${Math.round(meanApproval)}/100`,
      tone: meanApproval >= 50 ? 'good' : 'bad',
    },
  ]

  if (idx) {
    lines.push({
      label: 'Contract met',
      value: `${(idx.contractAvailability * 100).toFixed(2)}%`,
      tone: idx.contractAvailability > 0.999 ? 'good' : 'bad',
    })
    if ((rt?.unservedCustomerMwh ?? 0) > 0.5) {
      lines.push({
        label: 'Homes left unserved',
        value: `${Math.round(rt!.unservedCustomerMwh)} MWh`,
        tone: 'bad',
      })
    }
  }

  return {
    quarter: state.quarter,
    score,
    grade: grade(score),
    headline: headlineFor(state, parts, score),
    lines,
  }
}
