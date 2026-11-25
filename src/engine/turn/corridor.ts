import type { GameState, Corridor, GridSubstation } from '../types.ts'
import type { HexGrid } from '../geo/mapTypes.ts'
import type { Parcel, ParcelArchetype } from '../parcels/types.ts'
import { PROTECT } from '../geo/mapTypes.ts'
import { pointToCell } from '../geo/hex.ts'
import { centerlineLength, type Point } from '../geo/polygon.ts'
import { routeLeg, buildingsAlong, type RouteStyle, type RouteSurface } from '../geo/fineRoute.ts'
import { latticeAlong } from '../parcels/lattice.ts'
import { computeTakings, type CorridorTakings } from '../parcels/takings.ts'
import {
  newDeal, type ParcelDeal, condemnationQuarters, condemnationLegalCost, condemnationApprovalCost, MAX_OFFER,
} from '../parcels/negotiation.ts'
import { lineClass, lineCapex, lineBuildQuarters, type LineClassId } from '../../data/transmission.ts'
import { pushLog, nextId } from '../state.ts'
import {
  CAMPUS, SUBSTATION, siteNode, ownTapNode, gridTapNode, parseOwnTap, parseGridTap, parseSub, subNode, builtNode, dcNode, canJoin,
} from '../realtime/network.ts'
import { substationId } from '../../data/substations.ts'
import { OWN_TAP_COST, SUB_POSITION_COST, TAP_RANGE_KM, TAP_CLASSES, tapClassFor, type TapKv } from '../../data/taps.ts'
import { cellPoint } from './siting.ts'
import { withoutOwned } from './ownedLand.ts'
import { changeRating, ratingOf } from '../approval.ts'
import { Rng } from '../rng.ts'

/** "Nesmith Pecan Co." should not become "Nesmith Pecan Co..". */
function endSentence(name: string): string {
  return name.endsWith('.') ? name : `${name}.`
}

/** Nearest point on a polyline, and how far along it is. */
export function nearestOn(
  line: readonly Point[], x: number, y: number,
): { x: number; y: number; km: number; d: number } {
  let best = { x: 0, y: 0, km: 0, d: Infinity }
  let along = 0
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1]
    const dx = line[i][0] - ax
    const dy = line[i][1] - ay
    const len = Math.hypot(dx, dy)
    const t = len > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (len * len))) : 0
    const px = ax + dx * t
    const py = ay + dy * t
    const d = Math.hypot(x - px, y - py)
    if (d < best.d) best = { x: px, y: py, km: along + len * t, d }
    along += len
  }
  return best
}

/** Places existing lines and substations can feed: the first substation, then each customer. */
function centers(state: GameState, grid: HexGrid): Array<{ id: string; x: number; y: number }> {
  const [x, y] = cellPoint(grid, state.system.substationCell)
  return [{ id: '', x, y }, ...(state.customers ?? []).filter((c) => c.status !== 'cancelled').map((c) => ({ id: c.id, x: c.x, y: c.y }))]
}

/** Data center whose area a point is in. Empty for the first. */
export function areaAt(state: GameState, grid: HexGrid, x: number, y: number): string {
  let best = ''
  let least = Infinity
  for (const c of centers(state, grid)) {
    const d = Math.hypot(c.x - x, c.y - y)
    if (d < least) { best = c.id; least = d }
  }
  return best
}

/** Whether a point is close enough to a data center to feed it. */
export function inReach(state: GameState, grid: HexGrid, x: number, y: number): boolean {
  return centers(state, grid).some((c) => Math.hypot(c.x - x, c.y - y) <= TAP_RANGE_KM)
}

export interface ExistingLine { kv: number; points: readonly Point[] }

/** Existing lines close enough to the substation to feed this area. */
export function tappableLines(
  state: GameState, grid: HexGrid, lines: readonly ExistingLine[],
): ExistingLine[] {
  const at = centers(state, grid)
  return lines.filter((l) => tapClassFor(l.kv) !== null && at.some((c) => nearestOn(l.points, c.x, c.y).d <= TAP_RANGE_KM))
}

export interface MappedSubstation { kv: number; name: string | null; x: number; y: number }

/** Other substations of 115 kV or more that feed this area. */
export function areaSubstations(state: GameState, grid: HexGrid, list: readonly MappedSubstation[]): GridSubstation[] {
  const [sx, sy] = cellPoint(grid, state.system.substationCell)
  const cellAt = (x: number, y: number): number => {
    const [c, r] = pointToCell(grid.spec, x, y)
    return r * grid.spec.cols + c
  }
  const near = [...list]
    .map((s) => ({ ...s, km: Math.hypot(s.x - sx, s.y - sy) }))
    .filter((s) => s.kv >= 115 && s.km > 0.8 && inReach(state, grid, s.x, s.y))
    .sort((a, b) => a.km - b.km)
  const unnamed: Record<number, number> = {}
  return near.map((s) => {
    const n = s.name ? 0 : (unnamed[s.kv] = (unnamed[s.kv] ?? 0) + 1)
    return {
      id: substationId(s.kv, s.x, s.y),
      name: s.name ?? `${s.kv} kV substation ${n}`, kv: s.kv, x: s.x, y: s.y, cell: cellAt(s.x, s.y),
      area: areaAt(state, grid, s.x, s.y),
    }
  })
}

/** A tap on one of the player's lines, or an existing one, under a click. */
export function tapNear(
  state: GameState, grid: HexGrid, lines: readonly ExistingLine[], x: number, y: number, reachKm: number,
): NetNode | null {
  const cellAt = (px: number, py: number): number => {
    const [c, r] = pointToCell(grid.spec, px, py)
    return r * grid.spec.cols + c
  }
  let best: NetNode | null = null
  let least = reachKm
  for (const c of state.corridors) {
    const n = nearestOn(c.centerline, x, y)
    if (n.d > least || n.km < 0.3 || n.km > c.lengthKm - 0.3) continue
    least = n.d
    best = { id: ownTapNode(c.id, n.km), label: `tap on ${c.name}`, cell: cellAt(n.x, n.y), x: n.x, y: n.y }
  }
  if (best) return best
  for (const l of lines) {
    const n = nearestOn(l.points, x, y)
    const t = tapClassFor(l.kv)
    if (!t || n.d > least) continue
    least = n.d
    best = {
      id: gridTapNode(t.kv, n.x, n.y, areaAt(state, grid, n.x, n.y)), label: `existing ${t.kv} kV line`,
      cell: cellAt(n.x, n.y), x: n.x, y: n.y,
    }
  }
  return best
}

export interface NetNode {
  id: string
  label: string
  cell: number
  x: number
  y: number
}

/** Places a line can start or end. */
export function networkNodes(state: GameState, grid: HexGrid): NetNode[] {
  const make = (id: string, label: string, cell: number): NetNode => {
    const [x, y] = cellPoint(grid, cell)
    return { id, label, cell, x, y }
  }
  const out = [
    make(CAMPUS, state.contract.name, state.contract.siteCell),
    make(SUBSTATION, state.system.substationName, state.system.substationCell),
  ]
  for (const c of state.customers ?? []) {
    if (c.status !== 'cancelled') out.push({ id: dcNode(c.id), label: c.name, cell: c.cell, x: c.x, y: c.y })
  }
  for (const b of state.builtSubs ?? []) out.push({ id: builtNode(b.id), label: b.name, cell: b.cell, x: b.x, y: b.y })
  for (const s of state.substations ?? []) out.push({ id: subNode(s.id), label: s.name, cell: s.cell, x: s.x, y: s.y })
  const seen = new Set<number>()
  for (const p of state.plants) {
    if (p.typeId === 'nuclear-uprate' || seen.has(p.cell)) continue
    seen.add(p.cell)
    const here = state.plants.filter((q) => q.cell === p.cell && q.typeId !== 'nuclear-uprate')
    out.push(make(siteNode(p.cell), here.length > 1 ? `${here.length} units` : p.name, p.cell))
  }
  return out
}

/** The node nearest a point, if one is within reach. */
export function nodeNear(nodes: readonly NetNode[], x: number, y: number, reachKm: number): NetNode | null {
  let best: NetNode | null = null
  let d = reachKm
  for (const n of nodes) {
    const k = Math.hypot(n.x - x, n.y - y)
    if (k <= d) { best = n; d = k }
  }
  return best
}

export interface CorridorPlan {
  from: NetNode
  to: NetNode
  waypoints: Point[]
  style: RouteStyle
  centerline: Point[]
  lengthKm: number
  classId: LineClassId
  takings: CorridorTakings
  /** Every parcel the taking touches, loaded or stand-in. */
  parcels: Parcel[]
  /** Line construction cost, before right-of-way. */
  lineCapex: number
  /** Appraised right-of-way cost across every affected parcel. */
  rowAppraised: number
  buildQuarters: number
  /** Houses and other buildings within 150 m. */
  buildingsNear: number
  /** Rivers and lakes crossed. */
  waterCrossings: number
  /** Stations needed where the line joins another line. */
  taps: { cost: number; quarters: number; kv: TapKv[] }
  /** Parcels on the route that cannot be acquired. */
  blocked: number
}

/** A river span needs taller towers and a permit. */
const WATER_CROSSING_COST = 2_200_000

function tapWork(from: NetNode, to: NetNode): CorridorPlan['taps'] {
  const out: CorridorPlan['taps'] = { cost: 0, quarters: 0, kv: [] }
  for (const n of [from, to]) {
    if (parseOwnTap(n.id)) out.cost += OWN_TAP_COST
    if (parseSub(n.id) !== null || n.id.startsWith('nsub:')) out.cost += SUB_POSITION_COST
    const t = TAP_CLASSES.find((c) => c.kv === parseGridTap(n.id))
    if (!t) continue
    out.cost += t.cost
    out.quarters = Math.max(out.quarters, t.quarters)
    out.kv.push(t.kv)
  }
  return out
}

function countWaterCrossings(grid: HexGrid, line: readonly Point[]): number {
  let n = 0
  let wet = false
  for (let k = 1; k < line.length; k++) {
    const [ax, ay] = line[k - 1]
    const [bx, by] = line[k]
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.25))
    for (let s = 0; s <= steps; s++) {
      const [c, r] = pointToCell(grid.spec, ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps)
      const now = c >= 0 && r >= 0 && c < grid.spec.cols && r < grid.spec.rows
        && (grid.protection[r * grid.spec.cols + c] & (PROTECT.WATER | PROTECT.RIVER)) !== 0
      if (now && !wet) n += 1
      wet = now
    }
  }
  return n
}

/** Propose a route between two nodes, through any waypoints, and price it. */
export function planCorridor(
  surface: RouteSurface,
  from: NetNode,
  to: NetNode,
  classId: LineClassId,
  style: RouteStyle = 'balanced',
  waypoints: readonly Point[] = [],
): CorridorPlan | null {
  if (!canJoin(from.id, to.id)) return null

  const stops: Point[] = [[from.x, from.y], ...waypoints, [to.x, to.y]]
  const centerline: Point[] = []
  for (let i = 1; i < stops.length; i++) {
    const leg = routeLeg(surface, stops[i - 1], stops[i], style)
    if (!leg) return null
    centerline.push(...(i === 1 ? leg : leg.slice(1)))
  }
  return pricePlan(surface, from, to, classId, style, [...waypoints], centerline)
}

/** Re-price a route at another voltage without moving it. */
export function repricePlan(
  surface: RouteSurface, plan: CorridorPlan, classId: LineClassId,
): CorridorPlan {
  return pricePlan(surface, plan.from, plan.to, classId, plan.style, plan.waypoints, plan.centerline)
}

function pricePlan(
  surface: RouteSurface, from: NetNode, to: NetNode, classId: LineClassId,
  style: RouteStyle, waypoints: Point[], centerline: Point[],
): CorridorPlan {
  const cls = lineClass(classId)
  const lengthKm = centerlineLength(centerline)
  const covered = new Set(surface.parcels.length > 0 ? [surface.parcels[0].countyFips] : [])
  const candidates = [
    ...surface.parcels, ...latticeAlong(surface.grid, centerline, covered),
  ]
  const owned = surface.owned
  const takings = computeTakings(
    centerline, cls.rowHalfWidthKm, candidates,
    owned ? (buffer) => withoutOwned(buffer, centerline, owned, surface.grid) : undefined,
  )
  const touched = new Set(takings.takings.map((t) => t.parcelId))
  const parcels = candidates.filter((p) => touched.has(p.id))
  const waterCrossings = countWaterCrossings(surface.grid, centerline)
  const taps = tapWork(from, to)

  return {
    from, to, waypoints, style, centerline, lengthKm, classId, takings, parcels,
    lineCapex: lineCapex(cls, lengthKm) + waterCrossings * WATER_CROSSING_COST + taps.cost,
    rowAppraised: takings.totalAppraised,
    buildQuarters: lineBuildQuarters(cls, lengthKm) + taps.quarters,
    taps,
    buildingsNear: buildingsAlong(centerline, surface.buildings, 0.15),
    waterCrossings,
    blocked: parcels.filter((p) => newDeal(p).status === 'blocked').length,
  }
}

/** Commit a planned route and start acquiring the right-of-way. */
export function commitCorridor(prev: GameState, plan: CorridorPlan): GameState {
  if (prev.phase === 'ended') return prev
  const state: GameState = structuredClone(prev)
  const cls = lineClass(plan.classId)
  const n = nextId(state.corridors, 'corridor')

  const byId = new Map(plan.parcels.map((p) => [p.id, p]))
  const deals: Corridor['deals'] = {}
  const takings: Corridor['takings'] = {}
  const parcels: Corridor['parcels'] = {}
  for (const t of plan.takings.takings) {
    const p = byId.get(t.parcelId)
    if (!p) continue
    takings[t.parcelId] = t
    deals[t.parcelId] = newDeal(p)
    parcels[t.parcelId] = {
      id: p.id, owner: p.owner, archetype: p.archetype, countyFips: p.countyFips, acres: p.acres,
    }
  }

  const corridor: Corridor = {
    id: `corridor-${n}`,
    name: `${cls.shortName} to ${plan.to.label}`,
    classId: plan.classId,
    fromNode: plan.from.id,
    toNode: plan.to.id,
    centerline: plan.centerline,
    lengthKm: plan.lengthKm,
    status: 'acquiring',
    deals,
    takings,
    parcels,
    condemnations: 0,
    legalCosts: 0,
    rowPaid: 0,
    capexTotal: plan.lineCapex,
    capexSpent: 0,
    buildQuartersRemaining: plan.buildQuarters,
    filedQuarter: state.quarter,
    delayQuarters: 0,
  }

  state.corridors.push(corridor)
  for (const fips of new Set(Object.values(parcels).map((p) => p.countyFips))) {
    const severed = plan.takings.takings.filter(
      (t) => t.severed && parcels[t.parcelId]?.countyFips === fips).length
    changeRating(state, fips, -Math.min(8, severed * 0.12), `${corridor.name} filed`)
  }

  pushLog(
    state, 'grid',
    `${corridor.name} filed: ${plan.lengthKm.toFixed(1)} km across ` +
    `${plan.takings.parcelsAffected} parcels, ${plan.takings.parcelsSevered} of them cut in two.`,
    true,
  )
  if (plan.blocked > 0) {
    pushLog(
      state, 'politics',
      `${plan.blocked} protected parcel${plan.blocked === 1 ? '' : 's'} on this route cannot be acquired. Abandon it and draw another.`,
      true,
    )
  }
  return state
}

/** Whether another line joins this one partway along. */
export function isTapped(state: GameState, corridorId: string): boolean {
  return state.corridors.some((c) =>
    [c.fromNode, c.toNode].some((n) => parseOwnTap(n)?.corridorId === corridorId))
}

export function abandonCorridor(prev: GameState, corridorId: string): GameState {
  const state: GameState = structuredClone(prev)
  const idx = state.corridors.findIndex((c) => c.id === corridorId)
  if (idx < 0) return prev
  const corridor = state.corridors[idx]
  if (corridor.status === 'energized' || isTapped(prev, corridorId)) return prev

  state.corridors.splice(idx, 1)
  state.record.routesAbandoned += 1
  const sunk = corridor.rowPaid + corridor.legalCosts + corridor.capexSpent
  pushLog(
    state, 'grid',
    sunk > 0
      ? `${corridor.name} abandoned. $${(sunk / 1e6).toFixed(1)}M already spent is lost.`
      : `${corridor.name} abandoned before any money was committed.`,
    true,
  )
  return state
}

/** Put an offer on the table for one parcel, at a multiple of appraised value. */
export function setOffer(
  prev: GameState, corridorId: string, parcelId: string, multiple: number,
): GameState {
  const state: GameState = structuredClone(prev)
  const corridor = state.corridors.find((c) => c.id === corridorId)
  const deal = corridor?.deals[parcelId]
  if (!corridor || !deal) return prev
  if (deal.status === 'accepted' || deal.status === 'condemned' || deal.status === 'blocked') return prev
  if (deal.status === 'condemning') return prev

  deal.offerMultiple = Math.max(1, Math.min(MAX_OFFER, multiple))
  deal.status = 'offered'
  return state
}

/** Whether sending this owner a multiple would tell the player anything new. */
export function wouldReceive(deal: ParcelDeal, multiple: number): boolean {
  if (deal.status !== 'pending' && deal.status !== 'holdout' && deal.status !== 'offered') return false
  return multiple > deal.refusedAt + 1e-9
}

/** Offer one multiple to every owner still to settle, or to one owner type. */
export function offerAll(
  prev: GameState, corridorId: string, multiple: number, archetype?: ParcelArchetype,
): GameState {
  const state: GameState = structuredClone(prev)
  const corridor = state.corridors.find((c) => c.id === corridorId)
  if (!corridor) return prev
  const m = Math.max(1, Math.min(MAX_OFFER, multiple))

  let count = 0
  for (const [parcelId, deal] of Object.entries(corridor.deals)) {
    if (archetype && corridor.parcels[parcelId]?.archetype !== archetype) continue
    if (!wouldReceive(deal, m)) continue
    deal.offerMultiple = m
    deal.status = 'offered'
    count += 1
  }
  if (count === 0) return prev
  pushLog(
    state, 'money',
    `${count} offer${count === 1 ? '' : 's'} at ${m.toFixed(2)}× appraised value on ${corridor.name}.`,
  )
  return state
}

export function condemn(prev: GameState, corridorId: string, parcelId: string): GameState {
  const state: GameState = structuredClone(prev)
  const corridor = state.corridors.find((c) => c.id === corridorId)
  const deal = corridor?.deals[parcelId]
  const parcel = corridor?.parcels[parcelId]
  if (!corridor || !deal || !parcel || deal.status === 'blocked') return prev
  if (deal.status === 'accepted' || deal.status === 'condemned' || deal.status === 'condemning') return prev

  const rng = new Rng(state.rngState)
  deal.status = 'condemning'
  deal.condemnationQuarters = condemnationQuarters(parcel, rng)
  state.rngState = rng.state

  const legal = condemnationLegalCost(corridor.takings[parcelId])
  corridor.legalCosts += legal
  state.record.legalCosts += legal
  state.cash -= legal

  const county = state.counties[parcel.countyFips]
  const before = ratingOf(state, parcel.countyFips)
  if (county) {
    changeRating(state, parcel.countyFips, -condemnationApprovalCost(parcel), `${parcel.owner} condemned`)
    county.grievances.push(`${parcel.owner} condemned for ${corridor.name}`)
  }

  corridor.condemnations += 1
  state.record.condemnations += 1
  const drop = before === null ? 0 : before - (ratingOf(state, parcel.countyFips) ?? 0)
  const dropText = drop < 0.5 ? ''
    : ` ${parcel.countyFips === state.contract.countyFips ? 'Data center' : `${county?.name} County`} approval drops ${Math.round(drop)} points.`

  pushLog(
    state, 'politics',
    `Condemnation filed against ${endSentence(parcel.owner)} ` +
    `${deal.condemnationQuarters} quarters in court and $${(legal / 1e6).toFixed(1)}M in fees.${dropText}`,
    true,
  )

  const remaining = Object.values(corridor.deals).filter(
    (d) => d.status === 'pending' || d.status === 'holdout' || d.status === 'offered',
  ).length
  if (remaining > 0) {
    pushLog(
      state, 'politics',
      `${remaining} landowner${remaining === 1 ? '' : 's'} still to settle on ${corridor.name} now want more.`,
    )
  }
  return state
}

export function acquisitionComplete(corridor: Corridor): boolean {
  return Object.values(corridor.deals).every(
    (d) => d.status === 'accepted' || d.status === 'condemned',
  )
}

/** Parcels that are refusing and have no proceedings under way. */
export function outstandingHoldouts(corridor: Corridor): string[] {
  return Object.entries(corridor.deals)
    .filter(([, d]) => d.status === 'holdout' || d.status === 'pending')
    .map(([id]) => id)
}
