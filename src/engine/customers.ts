import type { ContractOffer, Customer, GameState } from './types.ts'
import type { CountiesFile } from './geo/mapTypes.ts'
import type { HexGrid } from './geo/mapTypes.ts'
import { pointToCell } from './geo/hex.ts'
import { adjacentCounties } from './geo/adjacency.ts'
import { deriveSeed, Rng } from './rng.ts'
import { formatQuarter, quarterOf, yearOf, type QuarterIndex } from './time.ts'
import { byGeorgiaPower, inGeorgia, isActive, utilityNamed, type DataCenter } from '../data/dataCenters.ts'
import {
  ADVANCE_PER_MW, BUY_LIMIT_MW, CREDIT_PER_MW, CUSTOMER_RATE, DRAW, DUE_STEP, FIRST_DUE, HORIZON_YEAR, LATE_LIMIT, MAIN_OPEN, MINIMUM_SHARE,
  OFFER_OPEN, OFFER_SPAN, OFFERS_AT_START, phasesFor, SPARE_ENERGY, SPARE_PER_MW_QUARTER, STARTING_BUDGET, STARTING_CREDIT,
} from '../data/customerTerms.ts'
import { assumedMw } from '../data/assumedMw.ts'
import { poolAt } from '../data/sparePower.ts'
import { plantType } from '../data/plants.ts'
import { CANCEL_BELOW, DEFAULT_APPROVAL, STALL_BELOW } from './approval.ts'
import { installments, payInstallment, SIGNING_SHARE } from './payments.ts'
import { recordCash } from './cashForecast.ts'
import { pushLog } from './state.ts'
import { firmFlow, type PowerFlow } from './realtime/network.ts'
import { standingCosts } from './realtime/operate.ts'
import { phasesOn } from './phases.ts'

const HOURS = 2190
/** Most quarters a due date moves to avoid another. */
const SPREAD_QUARTERS = 8

export const active = (c: Customer): boolean => c.status !== 'cancelled'
export const activeCustomers = (state: GameState): Customer[] => (state.customers ?? []).filter(active)

/** Last quarter a data center waits before going elsewhere. Invented. */
export function waitsUntil(state: GameState, dc: DataCenter): QuarterIndex {
  const o = state.offers?.find((x) => x.id === dc.id)
  if (o) return o.closes
  return state.startQuarter + new Rng(deriveSeed(state.seed, `waits:${dc.id}`)).int(6, 26)
}

/** Customers with a contract when the game begins. */
export const isExisting = (d: DataCenter): boolean => inGeorgia(d) && (byGeorgiaPower(d) || !utilityNamed(d))
  && startedMw(d) !== null && ['under construction', 'operating'].includes(d.status)

/** Published size, or the one assumed for a data center that has started. */
const startedMw = (d: DataCenter): number | null => d.mw ?? assumedMw(d.name)?.mw ?? null

/** Phases on when the game begins: all if it operates, one if its first published year has come. */
function phasesBefore(d: DataCenter, count: number, start: QuarterIndex): number {
  if (d.status === 'operating') return count
  const year = Number(/20\d\d/.exec(d.target ?? '')?.[0] ?? 9999)
  return year <= yearOf(start) ? 1 : 0
}

/** What the contracts signed before the game paid, and what was spent on the phases that are on. */
export function openingMoney(list: readonly DataCenter[], start: QuarterIndex): { mw: number; connected: number; paid: number; spent: number } {
  const out = { mw: 0, connected: 0, paid: 0, spent: 0 }
  for (const d of list.filter(isExisting)) {
    const mw = startedMw(d)!
    const { count } = phasesFor(mw)
    const on = phasesBefore(d, count, start) / count
    out.mw += mw
    out.connected += mw * on
    out.paid += mw * ADVANCE_PER_MW * (SIGNING_SHARE + (1 - SIGNING_SHARE) * on)
    out.spent += mw * ADVANCE_PER_MW * on
  }
  return out
}

/** Due quarters for phases not yet on, spread over the years a data center has published. Invented. */
export function dueDates(start: QuarterIndex, phases: number, target: string | null): QuarterIndex[] {
  const years = (target ?? '').match(/20\d\d/g)?.map(Number) ?? []
  const end = quarterOf(HORIZON_YEAR, 4)
  const first = Math.min(end, Math.max(start + FIRST_DUE, ...(years.length > 1 ? [quarterOf(years[0], 4)] : [])))
  const last = Math.min(end, Math.max(first + (phases - 1) * DUE_STEP, ...years.map((y) => quarterOf(y, 4))))
  return Array.from({ length: phases }, (_, i) => Math.round(phases === 1 ? first : first + ((last - first) * i) / (phases - 1)))
}

/** Move due quarters apart from phases already due. */
function spreadOut(state: GameState, due: readonly QuarterIndex[]): QuarterIndex[] {
  const end = quarterOf(HORIZON_YEAR, 4)
  const taken = new Map<QuarterIndex, number>()
  const main = state.contract.status === 'accepted' ? state.contract.milestones : []
  for (const m of [...main, ...activeCustomers(state).flatMap((c) => c.milestones)]) {
    if (!m.released && m.dueQuarter !== undefined) taken.set(m.dueQuarter, (taken.get(m.dueQuarter) ?? 0) + 1)
  }
  let prev = -1
  return due.map((d) => {
    const from = Math.min(end, Math.max(d, prev + 1))
    let best = from
    for (let q = from; q <= Math.min(end, from + SPREAD_QUARTERS); q++) {
      if ((taken.get(q) ?? 0) < (taken.get(best) ?? 0)) best = q
    }
    taken.set(best, (taken.get(best) ?? 0) + 1)
    prev = best
    return best
  })
}

function makeCustomer(
  state: GameState, dc: DataCenter, counties: CountiesFile, grid: HexGrid, due: QuarterIndex[], size = dc.mw,
): Customer | null {
  const name = (dc.county ?? '').replace(/ County$/, '')
  const county = counties.counties.find((c) => c.name.toLowerCase() === name.toLowerCase())
  if (!county || size === null) return null
  const [col, row] = pointToCell(grid.spec, dc.x, dc.y)
  const { count, mwEach } = phasesFor(size)
  const neighbours = adjacentCounties(counties, county.fips)
  for (const f of neighbours) {
    const n = state.counties[f]
    if (!n || n.adjacent) continue
    n.adjacent = true
    n.approval ??= DEFAULT_APPROVAL
  }
  return {
    id: dc.id, name: dc.name, developer: dc.developer ?? 'The developer', countyFips: county.fips,
    x: dc.x, y: dc.y, cell: row * grid.spec.cols + col,
    contractedMw: size, phaseCount: count, phaseMw: mwEach, phasesOn: 0,
    advance: size * ADVANCE_PER_MW, milestones: installments(count, mwEach, due), ratePerMwh: CUSTOMER_RATE,
    signedQuarter: state.quarter, status: 'signed', neighbours, spareMw: 0, revenue: 0, energyCost: 0,
    approval: DEFAULT_APPROVAL + new Rng(deriveSeed(state.seed, `approval:${dc.id}`)).int(-6, 8), history: [], programmes: {},
  }
}

/** Open the game as Georgia Power: its own money, and the customers it has. Returns a new state. */
export function beginCompany(
  prev: GameState, list: readonly DataCenter[], counties: CountiesFile, grid: HexGrid,
): GameState {
  if (prev.started) return prev
  const state = structuredClone(prev)
  state.started = true
  state.startingBudget = STARTING_BUDGET
  state.cash += STARTING_BUDGET
  state.creditLimit = STARTING_CREDIT
  const out: Customer[] = []
  state.customers = out
  for (const dc of list.filter(isExisting)) {
    // The first data center has its own contract.
    if (dc.id.startsWith('liberty-data-centers-americus')) continue
    const size = startedMw(dc)!
    const { count } = phasesFor(size)
    const on = phasesBefore(dc, count, state.quarter)
    const left = count - on
    const due = spreadOut(state, dueDates(state.quarter, left, dc.target))
    const c = makeCustomer(state, dc, counties, grid, [...Array<QuarterIndex>(on).fill(state.quarter), ...due], size)
    if (!c) continue
    c.existing = true
    c.phasesOn = on
    c.baseMw = on * c.phaseMw
    c.status = left === 0 ? 'served' : 'signed'
    if (dc.mw === null) c.assumed = assumedMw(dc.name)!.why
    for (const m of c.milestones) {
      if (m.trigger !== 'signed' && (m.phase ?? 0) > on) continue
      m.released = true
      m.paid = c.advance * m.fraction
      state.cash += m.paid
    }
    c.spentBefore = c.advance * (on / count)
    state.cash -= c.spentBefore
    out.push(c)
  }
  state.offers = makeOffers(state, list)
  state.mainCloses = state.quarter + MAIN_OPEN
  recordCash(state, state.quarter - 1)
  return state
}

/** Contracts in the order they come up: sooner published years and firmer status first. */
function makeOffers(state: GameState, list: readonly DataCenter[]): ContractOffer[] {
  const rank = (d: DataCenter): number => (d.status === 'rezoning' ? 1 : d.status === 'proposed' ? 2 : byGeorgiaPower(d) ? -1 : 0)
  const rows = list
    .filter((d) => cannotSupply(d) === null && !isExisting(d)
      && !(state.scenarioId === 'americus-400' && d.id.startsWith('liberty-data-centers-americus')))
    .map((d) => {
      const rng = new Rng(deriveSeed(state.seed, `offer:${d.id}`))
      const year = Number(/20\d\d/.exec(d.target ?? '')?.[0] ?? 2030)
      return { d, key: Math.min(2034, year) + rank(d) + rng.int(0, 2), stays: rng.int(...OFFER_OPEN) }
    })
    .sort((a, b) => a.key - b.key || a.d.id.localeCompare(b.d.id))
  const later = Math.max(1, rows.length - OFFERS_AT_START)
  return rows.map(({ d, stays }, i) => {
    const opens = state.quarter + (i < OFFERS_AT_START ? 0 : Math.ceil(((i - OFFERS_AT_START + 1) / later) * OFFER_SPAN))
    return { id: d.id, name: d.name, mw: d.mw!, x: d.x, y: d.y, opens, closes: opens + stays }
  })
}

/** The customer whose next phase is due soonest. */
export function firstDue(state: GameState): Customer | null {
  const due = (c: Customer): number => c.milestones.find((m) => !m.released && m.dueQuarter !== undefined)?.dueQuarter ?? Infinity
  return activeCustomers(state).filter((c) => c.status === 'signed').sort((a, b) => due(a) - due(b) || b.contractedMw - a.contractedMw)[0] ?? null
}

/** Whether the first data center can still be signed. */
export const mainOpen = (state: GameState): boolean =>
  state.contract.status === 'offered' && (state.mainCloses === undefined || state.quarter <= state.mainCloses)

/** Contracts that can be signed now. */
export function openOffers(state: GameState): ContractOffer[] {
  const signed = new Set((state.customers ?? []).map((c) => c.id))
  return (state.offers ?? []).filter((o) => o.opens <= state.quarter && state.quarter <= o.closes && !signed.has(o.id))
}

/** Report contracts that came up or went elsewhere this quarter. Mutates. */
export function reportOffers(state: GameState): void {
  const signed = new Set((state.customers ?? []).map((c) => c.id))
  if (state.contract.status === 'offered' && state.mainCloses !== undefined && state.quarter === state.mainCloses + 1) {
    pushLog(state, 'deal', `${state.contract.name} went to another supplier.`, true)
    // The guide is about it.
    state.tutorial = null
  }
  for (const o of state.offers ?? []) {
    if (signed.has(o.id)) continue
    if (o.opens === state.quarter) {
      pushLog(state, 'deal', `${o.name} offers a contract for ${Math.round(o.mw).toLocaleString()} MW. Sign by ${formatQuarter(o.closes)}.`, true)
    } else if (o.closes + 1 === state.quarter) {
      pushLog(state, 'deal', `${o.name} went to another supplier.`)
    }
  }
}

/** Why a data center can never be supplied, or null. */
function cannotSupply(dc: DataCenter): string | null {
  if (!inGeorgia(dc)) return `It is in ${dc.state}. The land, parcels and lines in the game cover Georgia.`
  if (!byGeorgiaPower(dc) && utilityNamed(dc)) return 'Another utility supplies it.'
  if (!isActive(dc)) return 'It is not going ahead.'
  if (dc.status === 'operating') return 'It already has its power.'
  if (dc.mw === null) return 'It has not published how much power it wants.'
  return null
}

/** Why a data center cannot be signed, or null. */
export function signBlocked(state: GameState, dc: DataCenter): string | null {
  if (state.customers?.some((c) => c.id === dc.id)) return 'Already signed.'
  if (state.phase === 'ended') return 'The scenario is over.'
  if (!state.started && state.contract.status === 'offered') return 'Sign the first contract first.'
  if (!state.equipment) return 'This saved game is from before other data centers. Start a new game.'
  const never = cannotSupply(dc)
  if (never) return never
  if (state.offers) {
    const o = state.offers.find((x) => x.id === dc.id)
    if (!o) return 'It is not looking for a supplier.'
    if (state.quarter < o.opens) return `Its contract comes up in ${formatQuarter(o.opens)}.`
  }
  if (state.quarter > waitsUntil(state, dc)) return 'It went to another supplier.'
  return null
}

export interface Terms {
  mw: number
  phaseCount: number
  phaseMw: number
  advance: number
  due: QuarterIndex[]
}

/** What signing would mean today. */
export function termsFor(state: GameState, dc: DataCenter): Terms {
  const mw = dc.mw ?? 0
  const { count, mwEach } = phasesFor(mw)
  return {
    mw, phaseCount: count, phaseMw: mwEach, advance: mw * ADVANCE_PER_MW,
    due: spreadOut(state, dueDates(state.quarter, count, dc.target)),
  }
}

/** Sign a data center. Returns a new state, or the same one if it cannot be signed. */
export function signCustomer(prev: GameState, dc: DataCenter, counties: CountiesFile, grid: HexGrid): GameState {
  if (signBlocked(prev, dc)) return prev
  const state = structuredClone(prev)
  const t = termsFor(state, dc)
  const c = makeCustomer(state, dc, counties, grid, t.due)
  if (!c) return prev
  const list = (state.customers ??= [])
  list.push(c)
  state.creditLimit += t.mw * CREDIT_PER_MW
  const { amount } = payInstallment(state, c.milestones[0], c.advance)
  pushLog(
    state, 'deal',
    `Signed: ${Math.round(t.mw).toLocaleString()} MW to ${c.name}. ${c.developer} paid $${(amount / 1e6).toFixed(0)}M.`, true,
  )
  return state
}

/** Spare power set aside for every data center. */
export function spareAssigned(state: GameState): number {
  return activeCustomers(state).reduce((n, c) => n + c.spareMw, state.contract.status === 'failed' ? 0 : state.mainSpareMw ?? 0)
}

/** Spare power not set aside for anyone. Negative when some has to be bought. */
export function spareLeft(state: GameState): number {
  return poolAt(state.quarter) - spareAssigned(state)
}

/** Set spare power aside for a data center. 'main' is the first. */
export function assignSpare(prev: GameState, id: string, mw: number): GameState {
  if (!prev.equipment || prev.phase === 'ended') return prev
  const state = structuredClone(prev)
  const c = state.customers?.find((x) => x.id === id && active(x))
  const most = id === 'main' ? state.contract.contractedMw : Math.max(0, (c?.contractedMw ?? 0) - (c?.baseMw ?? 0))
  const now = id === 'main' ? state.mainSpareMw ?? 0 : c?.spareMw ?? 0
  const limit = Math.max(now, now + Math.max(0, spareLeft(state)))
  const next = Math.max(0, Math.min(most, limit, Math.round(mw)))
  if (id === 'main') state.mainSpareMw = next
  else if (c) c.spareMw = next
  else return prev
  return state
}

/** Quarterly cost of a data center's spare power: what it holds, for the phases that are on. */
export function spareCharge(spareMw: number, onMw: number): number {
  return Math.min(spareMw, onMw) * SPARE_PER_MW_QUARTER
}

export interface CustomerQuarter { mw: number; revenue: number; energyCost: number; spareCost: number }

export function customerQuarter(state: GameState, c: Customer, flow: PowerFlow): CustomerQuarter | null {
  if (!active(c) || c.phasesOn === 0) return null
  const mw = c.phasesOn * c.phaseMw
  const mwh = mw * DRAW * HOURS
  const base = Math.min(c.baseMw ?? 0, mw)
  const spare = Math.min(flow.spare.get(c.id) ?? 0, Math.max(0, mw - base) * DRAW)
  // Average running cost of the plants that deliver anywhere.
  let cost = 0
  let total = 0
  for (const p of state.plants) {
    const got = flow.plants.get(p.id)?.arrivingMw ?? 0
    cost += got * plantType(p.typeId).variableCostPerMwh
    total += got
  }
  const own = total > 0 ? cost / total : SPARE_ENERGY
  return {
    mw,
    revenue: Math.max(mwh, mw * MINIMUM_SHARE * HOURS) * c.ratePerMwh,
    // What already reaches it costs the same as spare power.
    energyCost: ((spare + base * DRAW) * SPARE_ENERGY + Math.max(0, (mw - base) * DRAW - spare) * own) * HOURS + base * SPARE_PER_MW_QUARTER,
    spareCost: spareCharge(c.spareMw, mw - base),
  }
}

/** Bill every data center for the quarter, and pay for spare power. Mutates. */
export function settleCustomers(state: GameState): void {
  const list = activeCustomers(state)
  const flow = firmFlow(state)
  let spareCost = 0
  for (const c of list) {
    const q = customerQuarter(state, c, flow)
    if (!q) continue
    c.revenue += q.revenue
    c.energyCost += q.energyCost
    spareCost += q.spareCost
    c.spareCost = (c.spareCost ?? 0) + q.spareCost
    state.cash += q.revenue - q.energyCost
    pushLog(state, 'money', `${c.name} paid $${(q.revenue / 1e6).toFixed(1)}M for ${Math.round(q.mw).toLocaleString()} MW. Power cost $${(q.energyCost / 1e6).toFixed(1)}M.`)
  }
  if (state.contract.status !== 'failed') {
    const main = spareCharge(state.mainSpareMw ?? 0, mainOnMw(state))
    spareCost += main
    state.mainSpareCost = (state.mainSpareCost ?? 0) + main
  }
  // Anything over the pool is bought from neighbouring utilities at twice the price.
  const over = Math.min(BUY_LIMIT_MW, Math.max(0, -spareLeft(state)))
  spareCost += over * SPARE_PER_MW_QUARTER
  if (spareCost > 0) {
    state.cash -= spareCost
    state.spareCost = (state.spareCost ?? 0) + spareCost
    pushLog(state, 'money', `Spare power cost $${(spareCost / 1e6).toFixed(1)}M.${over > 0 ? ` ${Math.round(over).toLocaleString()} MW is beyond the pool and was bought.` : ''}`, over > 0)
  }
  // Plant upkeep is charged with the first data center's phases when any are on.
  if (list.some((c) => c.phasesOn > 0) && phasesOn(state) === 0) {
    const { fixedOm, maintenance } = standingCosts(state)
    state.operatingCost += (fixedOm + maintenance) / 4
    state.cash -= (fixedOm + maintenance) / 4
  }
}

function mainOnMw(state: GameState): number {
  const c = state.contract
  return c.phasesOn === undefined ? 0 : Math.min(c.contractedMw, (c.contractedMw / phaseCountOf(state)) * c.phasesOn)
}

function phaseCountOf(state: GameState): number {
  return Math.max(1, state.contract.milestones.filter((m) => m.trigger === 'phase').length)
}

/** Turn on phases that have power, and pay what they earn. Mutates. */
export function advanceCustomers(state: GameState): void {
  const flow = firmFlow(state)
  const reserved: Record<string, number> = {}
  for (const c of activeCustomers(state)) {
    const mw = flow.loads.get(c.id) ?? 0
    const now = Math.max(c.phasesOn, Math.min(c.phaseCount, Math.floor((mw + 1e-6) / c.phaseMw)))
    if (now > c.phasesOn) {
      c.phasesOn = now
      pushLog(state, 'grid', `${c.name}: ${now} of ${c.phaseCount} phases on, ${Math.round(now * c.phaseMw).toLocaleString()} MW. It pays from ${formatQuarter(state.quarter + 1)}.`, true)
      if (now === c.phaseCount) c.status = 'served'
    }
    for (const m of c.milestones) {
      if (m.released || c.phasesOn < (m.phase ?? 1)) continue
      const { amount, lost } = payInstallment(state, m, c.advance)
      pushLog(state, 'money', `${c.developer} paid $${(amount / 1e6).toFixed(0)}M for ${c.name}: ${m.label}${lost > 0 ? `, ${lost}% less for being late` : ''}.`, true)
    }
  }
  // The first data center's dispatch cannot use what the others are using.
  const main = flow.loads.get('main') ?? 0
  const base = new Map(activeCustomers(state).map((c) => [c.id, Math.min(c.baseMw ?? 0, c.contractedMw)]))
  const others = [...flow.loads].reduce((n, [id, v]) => n + (id === 'main' ? 0 : v - (flow.spare.get(id) ?? 0) - (base.get(id) ?? 0)), 0)
  const used = main - (flow.spare.get('main') ?? 0) + others
  if (others > 0.5 && used > 0) {
    for (const [id, p] of flow.plants) reserved[id] = (p.arrivingMw / p.firmMw) * (others / used)
  }
  state.reserved = reserved
}

/** What would be given back if a data center were cancelled now: the signing payment, for phases not on. */
export function refundDue(c: Customer): number {
  return (c.milestones[0].paid ?? 0) * (1 - c.phasesOn / c.phaseCount)
}

/** At the end of the game, give back signing money for phases never turned on. Mutates. */
export function settleUp(state: GameState): void {
  let total = 0
  for (const c of activeCustomers(state)) {
    if (c.status !== 'signed') continue
    c.refunded = refundDue(c)
    state.cash -= c.refunded
    total += c.refunded
  }
  if (total > 0) pushLog(state, 'money', `You give back $${(total / 1e6).toFixed(0)}M for phases that were never turned on.`, true)
}

function cancel(state: GameState, c: Customer, why: string): void {
  const refund = refundDue(c)
  const lostMw = (c.phaseCount - c.phasesOn) * c.phaseMw
  c.refunded = refund
  state.cash -= refund
  if (!c.existing) state.creditLimit -= lostMw * CREDIT_PER_MW
  const spareBefore = c.spareMw
  if (c.phasesOn > 0) {
    // The phases that are on stay.
    c.status = 'served'
    c.contractedMw = c.phasesOn * c.phaseMw
    c.phaseCount = c.phasesOn
    c.milestones = c.milestones.filter((m) => m.released)
    c.spareMw = Math.min(c.spareMw, Math.max(0, c.contractedMw - (c.baseMw ?? 0)))
  } else {
    c.status = 'cancelled'
    c.spareMw = 0
  }
  const freed = Math.round(spareBefore - c.spareMw)
  pushLog(
    state, 'politics',
    `${c.name} ${why}. You give back $${(refund / 1e6).toFixed(0)}M.`
    + `${c.phasesOn > 0 ? ` It keeps the ${c.phasesOn} ${c.phasesOn === 1 ? 'phase' : 'phases'} that are on.` : ''}`
    + `${freed > 0 ? ` ${freed.toLocaleString()} MW of spare power is free again.` : ''}`, true,
  )
}

/** Cancel data centers that have lost approval or waited too long. Mutates. */
export function checkCustomers(state: GameState): void {
  for (const c of activeCustomers(state)) {
    if (c.status !== 'signed') continue
    const next = c.milestones.find((m) => !m.released && m.dueQuarter !== undefined)
    if ((c.approval ?? DEFAULT_APPROVAL) < CANCEL_BELOW) cancel(state, c, 'lost local approval and was cancelled')
    else if (next && state.quarter - next.dueQuarter! >= LATE_LIMIT) cancel(state, c, `waited ${LATE_LIMIT} quarters for power and gave up on the rest`)
  }
}

export function warnCustomers(state: GameState): void {
  for (const c of activeCustomers(state)) {
    const a = c.approval ?? DEFAULT_APPROVAL
    if (c.status !== 'signed' || a >= STALL_BELOW) continue
    pushLog(state, 'politics', a < CANCEL_BELOW
      ? `${c.name}: approval is ${Math.round(a)}. Raise it to ${CANCEL_BELOW} this quarter or it is cancelled.`
      : `${c.name}: approval is ${Math.round(a)}. Below ${CANCEL_BELOW} it is cancelled.`, true)
  }
}
