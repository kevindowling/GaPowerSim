import type { BuiltSubstation, Corridor, Equipment, GameState, GridSubstation, Plant } from '../types.ts'
import { equipmentType } from '../../data/equipment.ts'
import { TAP_CLASSES, type TapKv } from '../../data/taps.ts'
import { customerLoadForPopulation } from './load.ts'
import { plantType } from '../../data/plants.ts'
import { lineClass } from '../../data/transmission.ts'

export const CAMPUS = 'campus'
export const SUBSTATION = 'substation'

/** Storage can count for at most this share of the contract as firm capacity. */
export const STORAGE_FIRM_SHARE = 0.2

export function siteNode(cell: number): string {
  return `site:${cell}`
}

/** Where a plant's output enters the network. */
export function plantNode(plant: Pick<Plant, 'typeId' | 'cell'>): string {
  return plant.typeId === 'nuclear-uprate' ? SUBSTATION : siteNode(plant.cell)
}

/** Small max-flow network. Node counts here are in the tens. */
export class FlowNet {
  private ids = new Map<string, number>()
  private adj: number[][] = []
  private to: number[] = []
  private cap: number[] = []

  node(id: string): number {
    let n = this.ids.get(id)
    if (n === undefined) {
      n = this.adj.length
      this.ids.set(id, n)
      this.adj.push([])
    }
    return n
  }

  /** Add an arc and return its handle. Pass `back` for an undirected line. */
  arc(from: string, to: string, cap: number, back = 0): number {
    const a = this.node(from)
    const b = this.node(to)
    const h = this.to.length
    this.to.push(b, a)
    this.cap.push(cap, back)
    this.adj[a].push(h)
    this.adj[b].push(h + 1)
    return h
  }

  residual(h: number): number { return this.cap[h] }
  setResidual(h: number, v: number): void { this.cap[h] = v }

  /** Nodes that could still receive more from here, without passing through `block`. */
  spareFrom(id: string, block: readonly string[]): Set<string> {
    const names = [...this.ids.keys()]
    const shut = new Set(block.map((b) => this.ids.get(b)))
    const seen = new Set([this.node(id)])
    for (const n of seen) {
      for (const h of this.adj[n]) {
        if (this.cap[h] > 1e-9 && !shut.has(this.to[h])) seen.add(this.to[h])
      }
    }
    return new Set([...seen].map((n) => names[n]))
  }

  /** Push as much as possible from s to t. Returns what was pushed. */
  push(sId: string, tId: string, limit = Infinity): number {
    const s = this.node(sId)
    const t = this.node(tId)
    let total = 0
    const via = new Int32Array(this.adj.length)

    while (total < limit - 1e-9) {
      via.fill(-1)
      via[s] = -2
      const queue = [s]
      for (let qi = 0; qi < queue.length && via[t] === -1; qi++) {
        for (const h of this.adj[queue[qi]]) {
          if (this.cap[h] > 1e-9 && via[this.to[h]] === -1) {
            via[this.to[h]] = h
            queue.push(this.to[h])
          }
        }
      }
      if (via[t] === -1) break

      let amount = limit - total
      for (let n = t; n !== s; n = this.to[via[n] ^ 1]) amount = Math.min(amount, this.cap[via[n]])
      for (let n = t; n !== s; n = this.to[via[n] ^ 1]) {
        this.cap[via[n]] -= amount
        this.cap[via[n] ^ 1] += amount
      }
      total += amount
    }
    return total
  }
}

export interface LineArc { id: string; handle: number; capMw: number; from: string; to: string }

/** Node on one of the player's lines, at a distance from its start. */
export function ownTapNode(corridorId: string, km: number): string {
  return `tap:${corridorId}@${km.toFixed(3)}`
}

export function parseOwnTap(node: string): { corridorId: string; km: number } | null {
  const m = /^tap:(.+)@([\d.]+)$/.exec(node)
  return m ? { corridorId: m[1], km: Number(m[2]) } : null
}

/** Node at one of the other substations. */
export function subNode(id: string): string {
  return `gsub:${id}`
}

export function parseSub(node: string): string | null {
  return node.startsWith('gsub:') ? node.slice(5) : null
}

/** Voltages a substation has. */
export function subVoltages(kv: number): TapKv[] {
  return kv >= 500 ? [500, 230] : kv >= 230 ? [230, 115] : [115]
}

/** A customer's campus. */
export function dcNode(id: string): string {
  return `dc:${id}`
}

/** A substation the player built. */
export function builtNode(id: string): string {
  return `nsub:${id}`
}

/** Node on an existing line, in the area of a data center. */
export function gridTapNode(kv: TapKv, x: number, y: number, area = ''): string {
  return `grid:${kv}:${x.toFixed(2)},${y.toFixed(2)}${area && `@${area}`}`
}

export function tapArea(node: string): string {
  return node.split('@')[1] ?? ''
}

const poolNode = (area: string, kv: TapKv): string => (area ? `pool:${area}:${kv}` : `pool:${kv}`)
/** The wider grid, where spare power comes from. */
const BULK = 'bulk'

export function parseGridTap(node: string): TapKv | null {
  const m = /^grid:(\d+):/.exec(node)
  return m ? (Number(m[1]) as TapKv) : null
}

/** Whether two plant sites touch, directly or through others. */
export function sitesTouch(state: GameState, a: string, b: string): boolean {
  const seen = new Set([a])
  const queue = [a]
  for (let i = 0; i < queue.length; i++) {
    for (const [p, q] of state.siteLinks ?? []) {
      for (const [x, y] of [[p, q], [q, p]]) {
        if (siteNode(x) === queue[i] && !seen.has(siteNode(y))) {
          seen.add(siteNode(y))
          queue.push(siteNode(y))
        }
      }
    }
  }
  return seen.has(b)
}

/** Whether a new line between two nodes would connect anything. */
export function canJoin(a: string, b: string): boolean {
  if (a === b) return false
  const own = parseOwnTap(a)
  if (own && own.corridorId === parseOwnTap(b)?.corridorId) return false
  const ka = parseGridTap(a)
  const kb = parseGridTap(b)
  if (ka !== null && (ka === kb || b === SUBSTATION)) return false
  return !(kb !== null && a === SUBSTATION)
}

const ends = (state: GameState): string[] => state.corridors.flatMap((c) => [c.fromNode, c.toNode])

/** Nodes along a corridor in order: its start, every tap on it, its end. */
function nodesAlong(state: GameState, c: Corridor): string[] {
  const taps = [...new Set(ends(state))]
    .map((n) => ({ n, tap: parseOwnTap(n) }))
    .filter((t) => t.tap?.corridorId === c.id)
    .sort((p, q) => p.tap!.km - q.tap!.km)
    .map((t) => t.n)
  return [c.fromNode, ...taps, c.toNode]
}

/** Side of the substation or campus a line of one voltage ends on. */
function bus(state: GameState, node: string, kv: number): string {
  if (/^(gsub|dc|nsub):/.test(node)) return `${node}:${kv}`
  if (!state.equipment || (node !== CAMPUS && node !== SUBSTATION)) return node
  return `${node}:${kv}`
}

/** Where homes draw power. */
export function homesNode(state: GameState): string {
  return bus(state, SUBSTATION, 115)
}

/** Where power from the region arrives. */
export function importNode(state: GameState): string {
  return bus(state, SUBSTATION, 230)
}

/** Where a plant's output enters the network, by voltage side. */
export function sourceNode(state: GameState, plant: Pick<Plant, 'typeId' | 'cell'>): string {
  const n = plantNode(plant)
  return n === SUBSTATION ? importNode(state) : n
}

/** Transformers already at the campus, on the tie. */
export const CAMPUS_TX = 'tx-campus'
/** The substation's existing pair. */
export const SUBSTATION_TX = ['tx-sub-1', 'tx-sub-2'] as const

const installed = (e: Equipment): boolean => e.status === 'installed'

const inService = (b: BuiltSubstation): boolean => b.status === 'in-service'

/** Room to spare on existing lines of one voltage, in the area of a data center. */
export function poolMw(
  state: GameState, kv: TapKv, on: (e: Equipment) => boolean = installed, area = '',
): number {
  const site = area ? dcNode(area) : undefined
  const base = TAP_CLASSES.find((t) => t.kv === kv)?.spareMw ?? 0
  return (state.equipment ?? []).reduce(
    (n, e) => n + (e.typeId === `area-${kv}` && e.siteId === site && on(e) ? equipmentType(e.typeId).mw : 0), base)
}

/** What the region can send to the first substation before heat cuts it. */
export function regionMw(state: GameState, on: (e: Equipment) => boolean = installed): number {
  return (state.equipment ?? []).reduce(
    (n, e) => n + (on(e) && e.siteId === undefined ? equipmentType(e.typeId).importMw ?? 0 : 0), state.system.importLimitMw)
}

/** Homes at the first substation use this much of what the region sends, at their peak. */
function homesPeakMw(state: GameState): number {
  return customerLoadForPopulation(state.system.servedPopulation) * 1.6
}

/** What is left of it for spare power. */
export function spareRoomMw(state: GameState, on: (e: Equipment) => boolean = installed): number {
  return Math.max(0, regionMw(state, on) - homesPeakMw(state))
}

/** Add every working line and transformer to a network. */
export function addLines(
  net: FlowNet, state: GameState, derates: ReadonlyMap<string, number>,
  built: (c: Corridor) => boolean = (c) => c.status === 'energized',
  gearOn: (e: Equipment) => boolean = installed,
  subOn: (b: BuiltSubstation) => boolean = inService,
): LineArc[] {
  const out: LineArc[] = []
  const join = (id: string, from: string, to: string, rating: number): void => {
    const cap = rating * (derates.get(id) ?? 1)
    out.push({ id, handle: net.arc(from, to, cap, cap), capMw: cap, from, to })
  }
  const pools = new Map<string, { area: string; kv: TapKv }>()
  const pool = (area: string, kv: TapKv): string => {
    const id = poolNode(area, kv)
    pools.set(id, { area, kv })
    return id
  }
  const joined = new Set<string>()
  const joinSub = (sub: GridSubstation): void => {
    if (joined.has(sub.id)) return
    joined.add(sub.id)
    for (const kv of subVoltages(sub.kv)) net.arc(`${subNode(sub.id)}:${kv}`, pool(sub.area ?? '', kv), 1e6, 1e6)
  }
  const subs = (state.builtSubs ?? []).filter(subOn)
  for (const b of subs) {
    if (b.looped) net.arc(`${builtNode(b.id)}:${b.kv}`, pool(b.area, b.kv), 1e6, 1e6)
  }
  // A transformer at another substation joins two voltages there.
  for (const e of state.equipment ?? []) {
    if (!e.siteId || !gearOn(e)) continue
    const t = equipmentType(e.typeId)
    const sub = state.substations?.find((x) => x.id === e.siteId)
    const own = subs.find((x) => x.id === e.siteId)
    if (sub) joinSub(sub)
    const at = sub ? subNode(sub.id) : own ? builtNode(own.id) : null
    if (at && t.id === 'sub-230-115') join(e.id, `${at}:230`, `${at}:115`, t.mw)
    if (at && t.id === 'sub-500-230') join(e.id, `${at}:500`, `${at}:230`, t.mw)
    if (e.siteId.startsWith('dc:') && t.place === 'campus') join(e.id, `${e.siteId}:${t.id.slice(7)}`, e.siteId, t.mw)
  }
  const waiting = new Set((state.builtSubs ?? []).filter((b) => !subOn(b)).map((b) => builtNode(b.id)))
  for (const c of state.corridors) {
    if (!built(c) || waiting.has(c.fromNode) || waiting.has(c.toNode)) continue
    const cls = lineClass(c.classId)
    const path = nodesAlong(state, c).map((n) => bus(state, n, cls.kv))
    for (let i = 1; i < path.length; i++) join(c.id, path[i - 1], path[i], cls.ratingMw)
    for (const n of [c.fromNode, c.toNode]) {
      const kv = parseGridTap(n)
      if (kv !== null) net.arc(n, pool(tapArea(n), kv), 1e6, 1e6)
      const sub = state.substations?.find((x) => x.id === parseSub(n))
      if (sub) joinSub(sub)
    }
  }
  for (const [a, b] of state.siteLinks ?? []) net.arc(siteNode(a), siteNode(b), 1e6, 1e6)
  for (const [id, { area, kv }] of pools) {
    join(id, id, area ? BULK : bus(state, SUBSTATION, kv === 115 ? 115 : 230), poolMw(state, kv, gearOn, area))
  }
  if (state.equipment) join('region', BULK, importNode(state), spareRoomMw(state, gearOn))
  join('tie', homesNode(state), bus(state, CAMPUS, 115), state.system.tieMw)
  if (!state.equipment) return out

  const low = `${SUBSTATION}:115`
  const high = `${SUBSTATION}:230`
  for (const id of SUBSTATION_TX) join(id, high, low, (state.system.transformerMw ?? 0) / SUBSTATION_TX.length)
  join(CAMPUS_TX, `${CAMPUS}:115`, CAMPUS, state.system.tieMw)
  for (const e of state.equipment) {
    if (!gearOn(e) || e.siteId) continue
    const t = equipmentType(e.typeId)
    if (t.place === 'campus') join(e.id, `${CAMPUS}:${t.id.slice(7)}`, CAMPUS, t.mw)
    else if (t.id === 'sub-230-115') join(e.id, high, low, t.mw)
    else if (t.id === 'sub-500-230') join(e.id, `${SUBSTATION}:500`, high, t.mw)
  }
  return out
}

/** Why a plant's firm power does not all arrive. */
export type PowerLimit =
  | { kind: 'no-line' }
  | { kind: 'campus-full' }
  | { kind: 'storage-cap' }
  | { kind: 'no-transformer'; place: 'campus' | 'substation' | 'customer'; kv: number; id?: string }
  | { kind: 'lines'; ids: string[] }

export interface PlantPower { firmMw: number; arrivingMw: number; limit: PowerLimit | null }

export interface PowerFlow {
  /** Firm MW reaching the first data center, at most its contract. */
  totalMw: number
  plants: Map<string, PlantPower>
  /** Firm MW reaching each data center. The first is 'main'. */
  loads: Map<string, number>
  /** Spare power each one uses. */
  spare: Map<string, number>
  /** MW on each line, transformer and group of existing lines. */
  lines: Map<string, number>
}

/** Data centers being supplied, in the order they signed. */
export function loadsOf(state: GameState): Array<{ id: string; node: string; mw: number; spareMw: number; baseMw: number }> {
  // Games from before the company budget plan for the first data center before signing it.
  const skip = state.contract.status === 'failed' || (state.started && state.contract.status === 'offered')
  const out = skip ? [] : [
    { id: 'main', node: CAMPUS, mw: state.contract.contractedMw, spareMw: state.equipment ? state.mainSpareMw ?? 0 : 0, baseMw: 0 },
  ]
  for (const c of state.customers ?? []) {
    if (c.status !== 'cancelled') out.push({ id: c.id, node: dcNode(c.id), mw: c.contractedMw, spareMw: c.spareMw, baseMw: c.baseMw ?? 0 })
  }
  return out
}

/** Firm power reaching each data center from what is built. */
export function firmFlow(
  state: GameState,
  plantOn: (p: Plant) => boolean = (p) => p.status === 'online',
  lineOn: (c: Corridor) => boolean = (c) => c.status === 'energized',
  gearOn: (e: Equipment) => boolean = installed,
  subOn: (b: BuiltSubstation) => boolean = inService,
): PowerFlow {
  const net = new FlowNet()
  const lines = addLines(net, state, new Map(), lineOn, gearOn, subOn)
  const wanted = loadsOf(state)
  net.arc('S', 'STORE', wanted.reduce((n, l) => n + l.mw, 0) * STORAGE_FIRM_SHARE)
  const on = state.plants.filter(plantOn).map((p) => {
    const t = plantType(p.typeId)
    const firmMw = p.nameplateMw * t.firmCapacityFraction
    const handle = net.arc(t.id === 'battery' ? 'STORE' : 'S', sourceNode(state, p), firmMw)
    return { p, firmMw, handle }
  })
  const loads = new Map<string, number>()
  const spare = new Map<string, number>()
  const taken: Array<{ l: (typeof wanted)[number]; t: number }> = []
  for (const l of wanted) {
    // What already reaches it does not use the player's lines.
    const t = net.arc(l.node, 'T', Math.max(0, l.mw - l.baseMw))
    net.push('S', 'T')
    if (l.spareMw > 0) {
      // Its own plants first, then spare power.
      const s = net.arc('S', BULK, l.spareMw)
      // It is set aside for this one, so the others are shut while it flows.
      const room = taken.map((x) => net.residual(x.t))
      taken.forEach((x) => net.setResidual(x.t, 0))
      net.push('S', 'T')
      taken.forEach((x, i) => net.setResidual(x.t, room[i]))
      spare.set(l.id, l.spareMw - net.residual(s))
      net.setResidual(s, 0)
    }
    taken.push({ l, t })
  }
  for (const { l, t } of taken) loads.set(l.id, Math.min(l.mw, l.baseMw) + Math.max(0, l.mw - l.baseMw) - net.residual(t))

  const plants = new Map<string, PlantPower>()
  for (const { p, firmMw, handle } of on) {
    const arrivingMw = firmMw - net.residual(handle)
    const limit = arrivingMw > firmMw - 0.01 ? null : limitAt(net, lines, sourceNode(state, p), wanted.map((l) => l.node))
    plants.set(p.id, { firmMw, arrivingMw, limit })
  }
  const used = new Map<string, number>()
  for (const l of lines) used.set(l.id, Math.max(used.get(l.id) ?? 0, Math.abs(l.capMw - net.residual(l.handle))))
  return { totalMw: loads.get('main') ?? 0, plants, loads, spare, lines: used }
}

function limitAt(net: FlowNet, lines: readonly LineArc[], node: string, campuses: readonly string[]): PowerLimit {
  const open = net.spareFrom(node, ['S', 'STORE'])
  if (open.has('T')) return { kind: 'storage-cap' }
  if (campuses.some((c) => open.has(c))) return { kind: 'campus-full' }
  for (const place of campuses) {
    for (const kv of [115, 230, 500]) {
      const here = `${place}:${kv}`
      if (!open.has(here) || lines.some((l) => [l.from, l.to].includes(here) && [l.from, l.to].includes(place))) continue
      return place === CAMPUS ? { kind: 'no-transformer', place: 'campus', kv }
        : { kind: 'no-transformer', place: 'customer', kv, id: place.slice(3) }
    }
  }
  const high = `${SUBSTATION}:500`
  if (open.has(high) && !lines.some((l) => [l.from, l.to].includes(high) && [l.from, l.to].every((n) => n.startsWith(`${SUBSTATION}:`)))) {
    return { kind: 'no-transformer', place: 'substation', kv: 500 }
  }
  const ids = lines.filter((l) => open.has(l.from) !== open.has(l.to)).map((l) => l.id)
  return ids.length > 0 ? { kind: 'lines', ids: [...new Set(ids)] } : { kind: 'no-line' }
}

const always = (): boolean => true

/** Firm generation that can reach the campus today. Energization waits on this. */
export function firmDeliverableMw(state: GameState): number {
  return firmFlow(state).totalMw
}

/** Planned power at the first data center with its largest plant out. */
export function plannedWithoutLargest(state: GameState): { name: string; mw: number } | null {
  const flow = plannedFlow(state)
  const largest = state.plants.reduce<Plant | null>((best, p) =>
    ((flow.plants.get(p.id)?.arrivingMw ?? 0) > (best ? flow.plants.get(best.id)?.arrivingMw ?? 0 : 0.5) ? p : best), null)
  if (!largest) return null
  return { name: largest.name, mw: plannedFlow({ ...state, plants: state.plants.filter((p) => p !== largest) }).totalMw }
}

/** Every data center's power once everything under way is finished. */
export function plannedFlow(state: GameState): PowerFlow {
  return firmFlow(state, always, always, always, always)
}

/** The same once every plant and line under way is finished. */
export function plannedFirmMw(state: GameState): number {
  return plannedFlow(state).totalMw
}

/** What lines alone would allow, with transformers everywhere. */
export function plannedByLinesMw(state: GameState): number {
  const spare = ['campus-115', 'campus-230', 'campus-500', 'sub-230-115', 'sub-500-230'] as const
  return plannedFirmMw(!state.equipment ? state : {
    ...state,
    equipment: [...state.equipment, ...spare.flatMap((typeId) => [1, 2].map((n): Equipment => ({
      id: `spare-${typeId}-${n}`, typeId, status: 'installed', quartersRemaining: 0,
      capexTotal: 0, capexSpent: 0, rush: false,
    })))],
  })
}

/** Planned power at every data center with one more line. */
export function plannedWithLine(
  state: GameState, line: Pick<Corridor, 'fromNode' | 'toNode' | 'classId'>,
): PowerFlow {
  const extra = { ...line, id: 'corridor-new' } as Corridor
  return plannedFlow({ ...state, corridors: [...state.corridors, extra] })
}

/** Nodes joined to the campus by any committed line, built or not. */
export function nodesRoutedToCampus(state: GameState): Set<string> {
  const seen = new Set<string>([CAMPUS, SUBSTATION, ...(state.customers ?? []).map((c) => dcNode(c.id))])
  const groups = state.corridors.map((c) => nodesAlong(state, c))
  const loopedNodes = new Set((state.builtSubs ?? []).filter((b) => b.looped).map((b) => builtNode(b.id)))
  for (const [a, b] of state.siteLinks ?? []) groups.push([siteNode(a), siteNode(b)])
  for (const g of groups) {
    for (const n of [...g]) if (parseGridTap(n) !== null || parseSub(n) !== null || loopedNodes.has(n)) g.push(SUBSTATION)
  }
  let grew = true
  while (grew) {
    grew = false
    for (const g of groups) {
      if (!g.some((n) => seen.has(n)) || g.every((n) => seen.has(n))) continue
      g.forEach((n) => seen.add(n))
      grew = true
    }
  }
  return seen
}
