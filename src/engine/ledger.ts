import type { GameState } from './types.ts'
import { activeCustomers } from './customers.ts'
import { CAMPUS, dcNode, firmFlow } from './realtime/network.ts'
import { allUnpaid, customerUnpaid, unpaidAdvance } from './payments.ts'

export interface LedgerRow { label: string; amount: number }

export interface DataCenterMoney {
  id: string
  name: string
  /** Paid by the developer, power sold, and payments still to come. */
  paid: number
  sold: number
  /** Its lines, transformers, power, spare power, and its share of the plants that serve it. */
  spent: number
  toCome: number
}

/** Every dollar so far, by what it was for. The rows add up to cash. */
export function ledger(state: GameState): { received: LedgerRow[]; spent: LedgerRow[]; perCenter: DataCenterMoney[]; shared: number; toCome: number } {
  const c = state.contract
  const paidBy = (list: typeof c.milestones, advance: number): number =>
    list.reduce((n, m) => n + (m.released ? m.paid ?? advance * m.fraction : 0), 0)
  const others = state.customers ?? []
  const flow = firmFlow(state)
  const own = (id: string): number => (flow.loads.get(id) ?? 0) - (flow.spare.get(id) ?? 0)
  const served = [...flow.loads.keys()].reduce((n, id) => n + own(id), 0)
  const plantMoney = state.plants.reduce((n, p) => {
    const f = flow.plants.get(p.id)
    return n + (f && f.firmMw > 0 ? (p.capexSpent + p.landCost) * (f.arrivingMw / f.firmMw) : 0)
  }, 0)
  const spentOn = (id: string, node: string): number => {
    const lines = state.corridors.filter((x) => x.fromNode === node || x.toNode === node)
      .reduce((n, x) => n + x.capexSpent + x.rowPaid + x.legalCosts, 0)
    const site = id === 'main' ? undefined : node
    const gear = (state.equipment ?? []).filter((e) => e.siteId === site)
      .reduce((n, e) => n + e.capexSpent, 0) * (1 - (state.ratepayerShare ?? 0))
    return lines + gear + (served > 0.5 ? plantMoney * (own(id) / served) : 0)
  }
  const perCenter: DataCenterMoney[] = [
    { id: 'main', name: c.name, paid: paidBy(c.milestones, c.capexAdvance) - (state.refunded ?? 0), sold: state.revenue, toCome: unpaidAdvance(state),
      spent: spentOn('main', CAMPUS) + (state.phaseEnergyCost ?? 0) + (state.realtime?.fuelCost ?? 0) + (state.realtime?.marketCost ?? 0) + (state.mainSpareCost ?? 0) + state.penaltiesAccrued },
    ...others.map((x) => ({ id: x.id, name: x.name, paid: paidBy(x.milestones, x.advance) - (x.refunded ?? 0), sold: x.revenue, toCome: customerUnpaid(state, x),
      spent: spentOn(x.id, dcNode(x.id)) + (x.spentBefore ?? 0) + x.energyCost + (x.spareCost ?? 0) })),
  ]
  const received: LedgerRow[] = [
    { label: 'Starting budget', amount: state.startingBudget ?? 0 },
    { label: 'Paid by developers', amount: perCenter.reduce((n, r) => n + r.paid, 0) },
    { label: 'Power sold', amount: perCenter.reduce((n, r) => n + r.sold, 0) },
  ]
  const rt = state.realtime
  const spent: LedgerRow[] = [
    { label: 'Connecting phases before 2026 Q3', amount: others.reduce((n, x) => n + (x.spentBefore ?? 0), 0) },
    { label: 'Plants', amount: state.plants.reduce((n, p) => n + p.capexSpent + p.landCost, 0) },
    { label: 'Lines', amount: state.corridors.reduce((n, x) => n + x.capexSpent, 0) },
    { label: 'Landowners and courts', amount: state.record.rowPaid + state.record.legalCosts },
    {
      label: 'Transformers and line upgrades',
      amount: (state.equipment ?? []).reduce((n, e) => n + e.capexSpent, 0) * (1 - (state.ratepayerShare ?? 0)),
    },
    { label: 'Substations', amount: (state.builtSubs ?? []).reduce((n, b) => n + b.capexSpent + b.landCost, 0) },
    {
      label: 'Fuel and power bought',
      amount: (state.phaseEnergyCost ?? 0) + (rt?.fuelCost ?? 0) + (rt?.marketCost ?? 0) + others.reduce((n, x) => n + x.energyCost, 0),
    },
    { label: 'Spare power', amount: state.spareCost ?? 0 },
    { label: 'Plant upkeep and crews', amount: state.operatingCost },
    { label: 'Penalties', amount: state.penaltiesAccrued },
    { label: 'Interest', amount: state.financingCost },
  ]
  const known = received.reduce((n, r) => n + r.amount, 0) - spent.reduce((n, r) => n + r.amount, 0)
  spent.push({ label: 'Community, events and withdrawn sites', amount: known - state.cash })
  return {
    received: received.filter((r) => Math.abs(r.amount) > 500),
    spent: spent.filter((r) => Math.abs(r.amount) > 500),
    perCenter, toCome: allUnpaid(state),
    shared: perCenter.reduce((n, r) => n + r.paid + r.sold - r.spent, 0) + (state.startingBudget ?? 0) - state.cash,
  }
}

export const suppliedCount = (state: GameState): number => activeCustomers(state).length + (state.contract.status === 'failed' ? 0 : 1)
