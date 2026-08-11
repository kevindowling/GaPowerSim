/**
 * Things breaking.
 *
 * Reliability is a first-class system here rather than flavour, because it is
 * what turns earlier decisions into consequences. The choice between one circuit
 * and two is invisible and looks like waste for years — right up until a
 * thunderstorm walks down the right-of-way and takes out a structure. Deferred
 * maintenance saves real money every quarter and quietly raises the failure rate
 * the whole time.
 *
 * Southwest Georgia gets severe convective storms through spring and summer and
 * the occasional hurricane remnant in late season, so the weather model is
 * seasonal.
 */

import type { GameState, Corridor, Plant } from '../types.ts'
import { plantType } from '../../data/plants.ts'
import { lineClass } from '../../data/transmission.ts'
import type { Rng } from '../rng.ts'
import type { RealtimeState, Storm } from './types.ts'
import { TICKS_PER_HOUR, TICKS_PER_DAY } from './types.ts'
import { dayOfYear } from './load.ts'

/** Extra failure hazard from skipping maintenance. */
const DEFERRED_MAINTENANCE_MULTIPLIER = 2.2

/**
 * Per-tick probability that a running unit trips.
 *
 * Derived from its steady-state forced-outage rate and how long it takes to fix:
 * if a unit is unavailable a fraction q of the time and each repair takes T
 * hours, it must be failing about q/((1−q)·T) times per hour.
 */
export function tripProbability(forcedOutageRate: number, repairHours: number, deferred: boolean): number {
  const q = Math.min(0.5, Math.max(0, forcedOutageRate))
  const perHour = q / ((1 - q) * Math.max(1, repairHours))
  const perTick = perHour / TICKS_PER_HOUR
  return Math.min(0.25, perTick * (deferred ? DEFERRED_MAINTENANCE_MULTIPLIER : 1))
}

/** Repair hours for a plant, from its mean repair time in quarters. */
function plantRepairHours(plant: Plant): number {
  // meanRepairQuarters is a build-phase figure; a forced outage is hours to days.
  return 18 * plantType(plant.typeId).meanRepairQuarters
}

const STORM_NAMES = [
  'the line out of Alabama', 'the Muckalee cell', 'a squall off the Flint',
  'the Andersonville storm', 'a supercell south of Plains', 'the Chokee line',
  'an outflow boundary', 'the Kinchafoonee cell',
]

/**
 * Chance a new storm forms this tick.
 *
 * Peaks in late spring and summer. Georgia's severe weather season is real and
 * it is long.
 */
function stormFormationChance(tick: number): number {
  const d = dayOfYear(tick)
  const season = Math.exp(-(((d - 175) / 70) ** 2))
  // About one storm every few days at the height of the season.
  return (0.35 / TICKS_PER_DAY) * (0.25 + season)
}

export function spawnStorm(rng: Rng, tick: number, bounds: { minX: number; minY: number; maxX: number; maxY: number }): Storm {
  // Storms in the Southeast overwhelmingly track west to east.
  const y = rng.range(bounds.minY, bounds.maxY)
  const severity = rng.next() ** 1.6 // mostly ordinary, occasionally not
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

/**
 * Probability a storm damages a corridor it is sitting on top of.
 *
 * Vegetation management is the lever: most storm damage to distribution and
 * sub-transmission lines is trees falling into conductors, and money spent
 * keeping the right-of-way clear is money that stops outages before they start.
 */
export function stormDamageChance(storm: Storm, vegetationSpend: number, deferred: boolean): number {
  const base = 0.055 * storm.severity
  const vegetation = 1.35 - 0.8 * Math.min(1, Math.max(0, vegetationSpend))
  return Math.min(0.6, base * vegetation * (deferred ? 1.5 : 1))
}

export interface ReliabilityEvent {
  text: string
  severe: boolean
}

/**
 * Advance failures, weather and repairs by one interval.
 * Mutates `rt` and returns anything worth telling the player about.
 */
export function stepReliability(
  state: GameState,
  rt: RealtimeState,
  rng: Rng,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): ReliabilityEvent[] {
  const events: ReliabilityEvent[] = []
  const down = new Set(rt.outages.map((o) => o.assetId))

  // --- plants trip ---
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
      text: `${plant.name} tripped offline — ${plant.nameplateMw} MW lost.`,
      severe: true,
    })
  }

  // --- weather ---
  if (rng.chance(stormFormationChance(rt.tick))) {
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
      // A double-circuit line on shared structures usually loses one circuit,
      // not both. That is exactly what the extra money bought: the campus stays
      // up on the surviving circuit while the other is repaired.
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
      // A partial loss still leaves the corridor carrying, so it is not "down".
      if (total) down.add(corridor.id)
      events.push({
        text: total
          ? `${cls.name}: line down in ${storm.name}. No transfer capability.`
          : `${cls.name}: one circuit lost in ${storm.name}. The other is holding.`,
        severe: total,
      })
    }
  }
  rt.storms = rt.storms.filter(
    (s) => s.ticksRemaining > 0 && s.x < bounds.maxX + 60,
  )

  // --- repairs ---
  // Crews go to the biggest thing first: a downed line strands the whole campus,
  // a tripped turbine only costs its own megawatts.
  const priority = [...rt.outages].sort((a, b) => {
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
    // An unattended fault does not fix itself; a crewed one goes faster.
    outage.ticksRemaining -= outage.crews > 0 ? outage.crews : 0.15
  }

  const restored = rt.outages.filter((o) => o.ticksRemaining <= 0)
  for (const outage of restored) {
    const name = outage.kind === 'plant'
      ? state.plants.find((p) => p.id === outage.assetId)?.name ?? 'A unit'
      : corridorName(state.corridors, outage.assetId)
    events.push({ text: `${name} restored to service.`, severe: false })
  }
  rt.outages = rt.outages.filter((o) => o.ticksRemaining > 0)

  return events
}

function corridorName(corridors: readonly Corridor[], id: string): string {
  const c = corridors.find((x) => x.id === id)
  return c ? lineClass(c.classId).name : 'A line'
}

/** Assets completely out of service. */
export function outAssets(rt: RealtimeState): Set<string> {
  return new Set(rt.outages.filter((o) => o.capacityFraction <= 0).map((o) => o.assetId))
}

/**
 * Remaining capacity fraction per asset. An asset with two concurrent faults
 * takes the worse of them rather than multiplying into nonsense.
 */
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
