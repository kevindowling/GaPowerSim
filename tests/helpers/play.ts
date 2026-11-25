import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixtures, cellAtLonLat } from './loadFixtures.ts'
import { AMERICUS, type Scenario } from '../../src/data/scenarios.ts'
import { createGame } from '../../src/engine/state.ts'
import { acceptContract, endQuarter, resolveHearing } from '../../src/engine/turn/resolve.ts'
import { HEARING_OPTIONS } from '../../src/engine/turn/hearing.ts'
import { sitePlant } from '../../src/engine/turn/siting.ts'
import {
  planCorridor, commitCorridor, offerAll, condemn, networkNodes, acquisitionComplete,
  type CorridorPlan, type NetNode,
} from '../../src/engine/turn/corridor.ts'
import type { RouteStyle, RouteSurface } from '../../src/engine/geo/fineRoute.ts'
import { inflateParcel, type Parcel, type ParcelFile } from '../../src/engine/parcels/types.ts'
import { ownerNameFor } from '../../src/engine/parcels/owners.ts'
import type { GisFile } from '../../src/engine/geo/basemapTypes.ts'
import { project } from '../../src/engine/geo/projection.ts'
import { approvalOf } from '../../src/engine/approval.ts'
import { programmesFor, runProgramme } from '../../src/engine/turn/community.ts'
import type { GameState } from '../../src/engine/types.ts'
import type { PlantKind } from '../../src/data/plants.ts'
import type { LineClassId } from '../../src/data/transmission.ts'
import { stepRealtime } from '../../src/engine/realtime/operate.ts'
import { resolvePendingByDefault } from '../../src/engine/events/events.ts'
import { nodesRoutedToCampus } from '../../src/engine/realtime/network.ts'

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/data')

export const BOUNDS = { minX: -300, minY: -300, maxX: 300, maxY: 300 }
export const RURAL = () => cellAtLonLat(-84.12, 32.04)
export const CAMPUS_CELL = () => cellAtLonLat(AMERICUS.contract.site.lon, AMERICUS.contract.site.lat)

let parcels: Parcel[] | null = null
export function sumterParcels(): Parcel[] {
  if (!parcels) {
    const file = JSON.parse(readFileSync(resolve(DATA, 'parcels/13261.json'), 'utf8')) as ParcelFile
    parcels = file.parcels.map((w) => inflateParcel(w, file.countyFips, ownerNameFor))
  }
  return parcels
}

let surface: RouteSurface | null = null
export function sumterSurface(): RouteSurface {
  if (!surface) {
    const gis = JSON.parse(readFileSync(resolve(DATA, 'gis/13261.json'), 'utf8')) as GisFile
    surface = {
      grid: fixtures().grid,
      parcels: sumterParcels(),
      buildings: gis.buildings.map(([lon, lat]) => project(lon, lat)),
      powerLines: gis.power.map((l) => ({ kv: l.kv, points: l.p.map(([lon, lat]) => project(lon, lat)) })),
    }
  }
  return surface
}

/** A game as a player starts it, with no transformers ordered. */
export function bareGame(sc: Scenario = AMERICUS, seed?: number): GameState {
  const { counties } = fixtures()
  return createGame(
    sc, cellAtLonLat(sc.contract.site.lon, sc.contract.site.lat), counties,
    cellAtLonLat(sc.system.site.lon, sc.system.site.lat), seed,
  )
}

/** Transformers everywhere, already paid for, so a test can be about something else. */
export function withTransformers(g: GameState): GameState {
  const ids = ['campus-115', 'campus-230', 'campus-500', 'sub-230-115', 'sub-500-230'] as const
  g.equipment = ids.flatMap((typeId) => [1, 2, 3].map((n) => ({
    id: `gear-${typeId}-${n}`, typeId, status: 'installed' as const, quartersRemaining: 0, capexTotal: 1e5, capexSpent: 1e5, rush: false,
  })))
  return g
}

export const newGame = (sc: Scenario = AMERICUS, seed?: number): GameState => withTransformers(bareGame(sc, seed))

export const signed = (seed?: number): GameState => acceptContract(newGame(AMERICUS, seed))

/** End quarters, answering anything pending with its default. */
export function run(state: GameState, n: number): GameState {
  let s = state
  for (let i = 0; i < n && s.phase === 'build'; i++) s = endQuarter(s).state
  return s
}

export function site(state: GameState, type: PlantKind, count = 1, cell = RURAL()): GameState {
  let s = state
  for (let i = 0; i < count; i++) s = sitePlant(s, type, cell, fixtures().grid)
  return s
}

export function node(state: GameState, id: string): NetNode {
  const n = networkNodes(state, fixtures().grid).find((x) => x.id === id)
  if (!n) throw new Error(`no node ${id}`)
  return n
}

export function plantNodeOf(state: GameState): NetNode {
  return networkNodes(state, fixtures().grid).find((n) => n.id.startsWith('site:'))!
}

export function plan(
  state: GameState, classId: LineClassId = '230', style: RouteStyle = 'balanced',
): CorridorPlan {
  return planCorridor(sumterSurface(), plantNodeOf(state), node(state, 'campus'), classId, style)!
}

/** Spend on the community whenever approval is getting near the cancelling point. */
export function defend(state: GameState, floor = 40): GameState {
  let s = state
  const fips = s.contract.countyFips
  for (const p of programmesFor(s, fips)) {
    if (approvalOf(s) >= floor) break
    if (!p.blocked) s = runProgramme(s, fips, p.programme.id)
  }
  return s
}

/** Offer in rising steps, then condemn whoever is left. */
export function acquire(state: GameState, steps = [1.5, 2, 2.6, 3.4]): GameState {
  let s = state
  for (const m of steps) {
    const c = s.corridors[s.corridors.length - 1]
    if (c.status !== 'acquiring' || acquisitionComplete(c)) break
    s = run(defend(offerAll(s, c.id, m)), 1)
  }
  const c = s.corridors[s.corridors.length - 1]
  for (const [id, d] of Object.entries(c.deals)) {
    if (d.status === 'holdout' || d.status === 'pending') s = condemn(s, c.id, id)
  }
  return defend(s)
}

export interface PlayOptions {
  plants?: Array<[PlantKind, number]>
  classId?: LineClassId
  style?: RouteStyle
  steps?: number[]
  hearing?: number
  seed?: number
}

/** Play the build phase until it ends, one way or another. */
export function build(o: PlayOptions = {}): GameState {
  let s = signed(o.seed)
  for (const [type, n] of o.plants ?? [['gas-ct', 3]]) s = site(s, type, n)
  s = commitCorridor(s, plan(s, o.classId ?? '230', o.style))
  s = acquire(s, o.steps)
  for (let i = 0; i < 40 && s.phase === 'build'; i++) {
    if (s.hearing === 'called') s = resolveHearing(s, HEARING_OPTIONS[o.hearing ?? 0])
    s = run(defend(s), 1)
  }
  return s
}

export interface OperateOptions { ticks?: number; onTick?: (s: GameState) => void }

/** Run the operating year. Mutates and returns the same state. */
export function operate(state: GameState, o: OperateOptions = {}): GameState {
  const limit = o.ticks ?? 366 * 96
  for (let i = 0; i < limit && state.phase === 'operate'; i++) {
    resolvePendingByDefault(state)
    stepRealtime(state, BOUNDS)
    o.onTick?.(state)
  }
  return state
}

export { nodesRoutedToCampus }
