import type { GameState, Corridor, Plant } from '../types.ts'
import { plantType } from '../../data/plants.ts'
import { lineClass } from '../../data/transmission.ts'
import { MAJOR_FAILURES_PER_YEAR, REPLACE_DAYS, TRIPS_PER_YEAR } from '../../data/equipment.ts'
import { CAMPUS_TX, SUBSTATION_TX } from './network.ts'
import { gearName } from '../turn/equipment.ts'
import { Rng, deriveSeed } from '../rng.ts'
import type { RealtimeState, Storm } from './types.ts'
import { TICKS_PER_HOUR, TICKS_PER_DAY } from './types.ts'
import { dayOfYear } from './load.ts'

/** Extra failure hazard from skipping maintenance. */
const DEFERRED_MAINTENANCE_MULTIPLIER = 2.2

export function tripProbability(forcedOutageRate: number, repairHours: number, deferred: boolean): number {
  const q = Math.min(0.5, Math.max(0, forcedOutageRate))
  const perHour = q / ((1 - q) * Math.max(1, repairHours))
  const perTick = perHour / TICKS_PER_HOUR
  return Math.min(0.25, perTick * (deferred ? DEFERRED_MAINTENANCE_MULTIPLIER : 1))
}

/** Repair hours for a plant, from its mean repair time in quarters. */
function plantRepairHours(plant: Plant): number {
  // meanRepairQuarters is a build-phase figure. A forced outage is days.
  return 60 * plantType(plant.typeId).meanRepairQuarters
}

const STORM_NAMES = [
  'the line out of Alabama', 'the Muckalee cell', 'a squall off the Flint',
  'the Andersonville storm', 'a supercell south of Plains', 'the Chokee line',
  'an outflow boundary', 'the Kinchafoonee cell',
]

function stormFormationChance(tick: number): number {
  const d = dayOfYear(tick)
  const season = Math.exp(-(((d - 175) / 70) ** 2))
  // About one storm every few days at the height of the season.
  return (0.30 / TICKS_PER_DAY) * (0.2 + season)
}

export function spawnStorm(rng: Rng, tick: number, bounds: { minX: number; minY: number; maxX: number; maxY: number }): Storm {
  // Storms in the Southeast overwhelmingly track west to east.
  const y = rng.range(bounds.minY, bounds.maxY)
  const severity = rng.next() ** 1.6
  return {
    id: `storm-${tick}-${Math.floor(rng.next() * 1e6)}`,
    x: bounds.minX - 10,
    y,
    vx: rng.range(1.2, 3.4),
    vy: rng.range(-0.5, 0.5),
    radiusKm: 8 + severity * 26,
    severity: 0.25 + severity * 0.75,
    ticksRemaining: Math.round(rng.range(6, 30)),
    name: rng.pick(STORM_NAMES),
  }
}

/** Shortest distance from a point to a polyline, in km. */
export function distanceToCenterline(
  x: number, y: number, centerline: ReadonlyArray<readonly [number, number]>,
): number {
  let best = Infinity
  for (let i = 0; i < centerline.length - 1; i++) {
    const [ax, ay] = centerline[i]
    const [bx, by] = centerline[i + 1]
    const dx = bx - ax
    const dy = by - ay
    const lenSq = dx * dx + dy * dy
    let t = lenSq > 0 ? ((x - ax) * dx + (y - ay) * dy) / lenSq : 0
    t = t < 0 ? 0 : t > 1 ? 1 : t
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)))
  }
  return best
}

export function stormDamageChance(storm: Storm, vegetationSpend: number, deferred: boolean): number {
  const base = 0.055 * storm.severity
  const vegetation = 1.35 - 0.8 * Math.min(1, Math.max(0, vegetationSpend))
  return Math.min(0.6, base * vegetation * (deferred ? 1.5 : 1))
}

export interface ReliabilityEvent {
  text: string
  severe: boolean
}

export function stepReliability(
  state: GameState,
  rt: RealtimeState,
  rng: Rng,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): ReliabilityEvent[] {
  const events: ReliabilityEvent[] = []
  const down = new Set(rt.outages.map((o) => o.assetId))

  for (const plant of state.plants) {
    if (plant.status !== 'online' || down.has(plant.id)) continue
    const t = plantType(plant.typeId)
    const p = tripProbability(t.forcedOutageRate, plantRepairHours(plant), rt.maintenanceDeferred)
    if (!rng.chance(p)) continue

    const hours = plantRepairHours(plant) * rng.range(0.5, 1.8)
    rt.outages.push({
      assetId: plant.id,
      kind: 'plant',
      cause: rng.pick([
        'turbine trip', 'generator protection operated', 'fuel supply upset',
        'transformer fault', 'control system failure', 'tube leak',
      ]),
      ticksRemaining: Math.max(2, Math.round(hours * TICKS_PER_HOUR)),
      capacityFraction: 0,
      crews: 0,
      startedTick: rt.tick,
    })
    down.add(plant.id)
    events.push({
      text: `${plant.name} tripped offline. ${plant.nameplateMw} MW lost.`,
      severe: false,
    })
  }

  // Once a day, on their own stream.
  const daily = new Rng(deriveSeed(state.seed, `transformers:${rt.startTick + rt.tick}`))
  for (const id of rt.tick % TICKS_PER_DAY === 0 ? transformers(state) : []) {
    if (down.has(id)) continue
    const major = daily.chance(MAJOR_FAILURES_PER_YEAR / 365)
    if (!major && !daily.chance((TRIPS_PER_YEAR / 365) * (rt.maintenanceDeferred ? DEFERRED_MAINTENANCE_MULTIPLIER : 1))) continue
    rt.outages.push({
      assetId: id, kind: 'transformer',
      cause: major ? 'failed, waiting for a replacement' : daily.pick(['protection tripped it', 'oil temperature alarm', 'bushing fault']),
      ticksRemaining: Math.round(major ? REPLACE_DAYS * TICKS_PER_DAY : daily.range(6, 30) * TICKS_PER_HOUR),
      capacityFraction: 0, crews: 0, startedTick: rt.tick,
    })
    down.add(id)
    events.push({ text: `${transformerName(state, id)} is out of service.`, severe: major })
  }

  const calendarTick = rt.startTick + rt.tick
  if (rng.chance(stormFormationChance(calendarTick))) {
    rt.storms.push(spawnStorm(rng, rt.tick, bounds))
  }

  for (const storm of rt.storms) {
    storm.x += storm.vx
    storm.y += storm.vy
    storm.ticksRemaining -= 1

    for (const corridor of state.corridors) {
      if (corridor.status !== 'energized' || down.has(corridor.id)) continue
      if (distanceToCenterline(storm.x, storm.y, corridor.centerline) > storm.radiusKm) continue
      if (!rng.chance(stormDamageChance(storm, rt.vegetationSpend, rt.maintenanceDeferred))) continue

      const cls = lineClass(corridor.classId)
      const total = cls.circuits === 1 || rng.chance(0.18)
      const hours = rng.range(4, 30) * (total ? 1.4 : 1)

      rt.outages.push({
        assetId: corridor.id,
        kind: 'corridor',
        cause: rng.pick([
          'structure down', 'conductor on the ground', 'tree into the line',
          'lightning strike', 'insulator failure', 'crossarm broken',
        ]),
        ticksRemaining: Math.max(4, Math.round(hours * TICKS_PER_HOUR)),
        capacityFraction: total ? 0 : 1 / cls.circuits,
        crews: 0,
        startedTick: rt.tick,
      })
      if (total) down.add(corridor.id)
      events.push({
        text: total
          ? `${corridor.name}: line down in ${storm.name}.`
          : `${corridor.name}: one circuit lost in ${storm.name}. The other is still in service.`,
        severe: false,
      })
    }
  }
  rt.storms = rt.storms.filter(
    (s) => s.ticksRemaining > 0 && s.x < bounds.maxX + 60,
  )

  const priority = [...rt.outages].sort((a, b) => {
    if (Boolean(a.priority) !== Boolean(b.priority)) return a.priority ? -1 : 1
    if (a.kind !== b.kind) return a.kind === 'corridor' ? -1 : 1
    return a.startedTick - b.startedTick
  })
  let crewsLeft = rt.crewsTotal
  for (const outage of priority) {
    outage.crews = 0
    if (crewsLeft <= 0) continue
    const assign = Math.min(crewsLeft, 2)
    outage.crews = assign
    crewsLeft -= assign
  }

  for (const outage of rt.outages) {
    outage.ticksRemaining -= outage.crews > 0 ? outage.crews : 0.15
  }

  const restored = rt.outages.filter((o) => o.ticksRemaining <= 0)
  for (const outage of restored) {
    const name = outage.kind === 'plant'
      ? state.plants.find((p) => p.id === outage.assetId)?.name ?? 'A unit'
      : outage.kind === 'transformer' ? transformerName(state, outage.assetId)
      : corridorName(state.corridors, outage.assetId)
    events.push({ text: `${name} restored to service.`, severe: false })
  }
  rt.outages = rt.outages.filter((o) => o.ticksRemaining > 0)

  return events
}

/** Transformers in service, by asset id. */
export function transformers(state: GameState): string[] {
  if (!state.equipment) return []
  return [
    ...SUBSTATION_TX, CAMPUS_TX,
    ...state.equipment.filter((e) => e.status === 'installed' && !e.typeId.startsWith('area-')).map((e) => e.id),
  ]
}

export function transformerName(state: GameState, id: string): string {
  if (id === CAMPUS_TX) return `Existing transformer at ${state.contract.name}`
  const n = (SUBSTATION_TX as readonly string[]).indexOf(id)
  if (n >= 0) return `Existing transformer ${n + 1} at ${state.system.substationName}`
  const e = state.equipment?.find((x) => x.id === id)
  return e ? gearName(state, e) : 'Transformer'
}

function corridorName(corridors: readonly Corridor[], id: string): string {
  if (id === 'tie') return 'The substation tie'
  return corridors.find((x) => x.id === id)?.name ?? 'A line'
}

/** Assets completely out of service. */
export function outAssets(rt: RealtimeState): Set<string> {
  return new Set(rt.outages.filter((o) => o.capacityFraction <= 0).map((o) => o.assetId))
}

export function capacityDerates(rt: RealtimeState): Map<string, number> {
  const derates = new Map<string, number>()
  for (const o of rt.outages) {
    const current = derates.get(o.assetId)
    if (current === undefined || o.capacityFraction < current) {
      derates.set(o.assetId, o.capacityFraction)
    }
  }
  return derates
}
