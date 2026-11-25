import type { GameState, Outcome } from './types.ts'
import { formatQuarter } from './time.ts'
import { owedAdvance } from './payments.ts'
import { phasesOn, phasing } from './phases.ts'
import { approvalOf } from './approval.ts'
import { reliabilityIndices } from './realtime/operate.ts'

function money(v: number): string {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`
  return `${sign}$${Math.round(abs / 1e3)}K`
}

function headlineFor(state: GameState): string {
  const county = state.counties[state.contract.countyFips]?.name ?? 'The county'
  const { condemnations } = state.record
  const late = state.energizedQuarter !== null
    && state.energizedQuarter > state.contract.inServiceQuarter
  const homesMwh = state.realtime?.unservedCustomerMwh ?? 0

  if (state.ending === 'insolvent') return 'Lenders cut you off. You ran out of money.'
  if (state.ending === 'cancelled') return 'The data center lost local approval and was cancelled.'
  if (state.contract.status === 'offered') {
    const on = (state.customers ?? []).reduce((n, x) => n + x.phasesOn * x.phaseMw, 0)
    return `You supplied ${Math.round(on).toLocaleString()} MW to data centers.`
  }
  if (state.contract.status === 'failed' && state.ending === 'completed') {
    return `${state.contract.name} was lost. You supplied the others to the end.`
  }
  if (state.ending === 'terminated' || state.energizedQuarter === null) {
    const on = phasesOn(state)
    return on === 0 ? 'The customer cancelled. The campus never energized.'
      : `The customer cancelled with ${on} of ${phasing(state).count} phases on.`
  }
  if (homesMwh > 400) {
    return `Homes in ${county} County lost power so the campus could keep it.`
  }
  if (condemnations >= 4) {
    return `The line was built after ${condemnations} condemnations in ${county} County.`
  }
  const rt = state.realtime
  if (rt && rt.tick > 0 && reliabilityIndices(rt, state.system.servedPopulation).contractAvailability < 0.98) {
    return 'The campus lost power too often to meet its contract.'
  }
  if (late) {
    const q = state.energizedQuarter! - state.contract.inServiceQuarter
    return `The campus got its power ${q} quarter${q === 1 ? '' : 's'} late.`
  }
  if (state.cash < 0) return 'The campus is running and you are in debt.'
  if (condemnations > 0) {
    return `On time, with ${condemnations} propert${condemnations === 1 ? 'y' : 'ies'} taken in court.`
  }
  return 'On time, with every easement bought by agreement.'
}

export function scoreScenario(state: GameState): Outcome {
  const c = state.contract
  const rt = state.realtime
  const approval = approvalOf(state)
  const { record } = state

  const lines: Outcome['lines'] = [
    {
      label: 'Energized',
      value: state.energizedQuarter !== null ? formatQuarter(state.energizedQuarter) : 'never',
      tone: state.energizedQuarter !== null && state.energizedQuarter <= c.inServiceQuarter ? 'good' : 'bad',
    },
    { label: 'Deadline', value: formatQuarter(c.inServiceQuarter), tone: 'plain' },
    { label: 'Revenue', value: money(state.revenue), tone: 'plain' },
    {
      label: 'Fuel and purchases',
      value: money((rt?.fuelCost ?? 0) + (rt?.marketCost ?? 0) + (state.phaseEnergyCost ?? 0)),
      tone: 'plain',
    },
    { label: 'Penalties', value: money(state.penaltiesAccrued), tone: state.penaltiesAccrued > 0 ? 'bad' : 'good' },
    { label: 'Paid to landowners', value: money(record.rowPaid), tone: 'plain' },
    { label: 'Legal fees', value: money(record.legalCosts), tone: record.legalCosts > 0 ? 'bad' : 'plain' },
    {
      label: 'Properties condemned',
      value: String(record.condemnations),
      tone: record.condemnations === 0 ? 'good' : 'bad',
    },
    { label: 'Data center approval', value: `${Math.round(approval)}/100`, tone: approval >= 50 ? 'good' : 'bad' },
  ]
  const cut = c.milestones.reduce((n, m) => n + (m.paid === undefined ? 0 : c.capexAdvance * m.fraction - m.paid), 0)
  if (cut > 0.5) lines.push({ label: 'Lost to late payments', value: money(cut), tone: 'bad' })
  const others = state.customers ?? []
  if (others.length > 0) {
    const on = others.reduce((n, x) => n + x.phasesOn * x.phaseMw, 0)
    lines.push({ label: 'Other data centers signed', value: String(others.length), tone: 'plain' })
    lines.push({ label: 'Power on for them', value: `${Math.round(on).toLocaleString()} MW`, tone: on > 0 ? 'good' : 'bad' })
    const lost = others.filter((x) => x.status === 'cancelled').length
    if (lost > 0) lines.push({ label: 'Cancelled', value: String(lost), tone: 'bad' })
  }
  const unpaid = owedAdvance(state)
  if (state.energizedQuarter === null && unpaid > 0) {
    lines.push({ label: 'Never paid', value: money(unpaid), tone: 'bad' })
  }
  if (rt && rt.tick > 0) {
    const idx = reliabilityIndices(rt, state.system.servedPopulation)
    lines.push({
      label: 'Campus availability',
      value: `${(idx.contractAvailability * 100).toFixed(2)}%`,
      tone: idx.contractAvailability > 0.998 ? 'good' : 'bad',
    })
    lines.push({
      label: 'Home outages (SAIDI)',
      value: `${Math.round(idx.saidiMinutes)} min/yr`,
      tone: idx.saidiMinutes < 60 ? 'good' : 'bad',
    })
  }

  return { quarter: state.quarter, score: Math.round(state.cash), headline: headlineFor(state), lines }
}
