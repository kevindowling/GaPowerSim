import { bareGame, node, plantNodeOf, site, sumterSurface, BOUNDS } from '../helpers/play.ts'
import { commitCorridor, condemn, offerAll, planCorridor } from '../../src/engine/turn/corridor.ts'
import { acceptContract, endQuarter, resolveHearing } from '../../src/engine/turn/resolve.ts'
import { HEARING_OPTIONS } from '../../src/engine/turn/hearing.ts'
import { orderEquipment } from '../../src/engine/turn/equipment.ts'
import { programmesFor, runProgramme } from '../../src/engine/turn/community.ts'
import { approvalOf } from '../../src/engine/approval.ts'
import { resolveEvent } from '../../src/engine/events/events.ts'
import { stepRealtime } from '../../src/engine/realtime/operate.ts'
import { expeditePlant, canExpedite } from '../../src/engine/turn/siting.ts'
import type { GameState } from '../../src/engine/types.ts'
import type { PlantKind } from '../../src/data/plants.ts'
import type { LineClassId } from '../../src/data/transmission.ts'

export interface Style {
  plants: Array<[PlantKind, number]>
  line: LineClassId
  lines?: number
  transformers?: number
  hearing: number
  events: 'first' | 'last'
  defend: number
  /** Offer rounds before condemning. */
  rounds: number
  expedite?: boolean
  vegetation?: number
  crews?: number
  defer?: boolean
}

export const CAREFUL: Style = {
  plants: [['gas-ct', 3]], line: '230d', transformers: 2, hearing: 0, events: 'first', defend: 45, rounds: 5,
}

/** Play the first data center to the end of its year. */
export function playAmericus(seed: number, o: Style): GameState {
  let s = acceptContract(bareGame(undefined, seed))
  for (const [k, n] of o.plants) s = site(s, k, n)
  for (let i = 0; i < (o.lines ?? 1); i++) {
    const p = planCorridor(sumterSurface(), plantNodeOf(s), node(s, 'campus'), o.line, i === 0 ? 'balanced' : 'homes')
    if (p) s = commitCorridor(s, p)
  }
  const gear = o.line === '500' ? 'campus-500' : o.line === '115' ? 'campus-115' : 'campus-230'
  for (let i = 0; i < (o.transformers ?? 1); i++) s = orderEquipment(s, gear)
  for (let q = 0; q < 32 && s.phase === 'build'; q++) {
    for (const c of s.corridors) {
      if (c.status !== 'acquiring') continue
      if (q < o.rounds) s = offerAll(s, c.id, Math.min(6, 1.5 + 0.55 * q))
      else for (const [id, d] of Object.entries(c.deals)) if (d.status === 'holdout' || d.status === 'pending') s = condemn(s, c.id, id)
    }
    if (s.pendingEvent) s = resolveEvent(s, o.events === 'first' ? 0 : 9)
    if (s.pendingEvent) s = resolveEvent(s, 1)
    s.pendingEvent = null
    if (s.hearing === 'called') s = resolveHearing(s, HEARING_OPTIONS[o.hearing])
    for (const p of programmesFor(s, '13261')) if (!p.blocked && approvalOf(s) < o.defend) s = runProgramme(s, '13261', p.programme.id)
    if (o.expedite) for (const p of s.plants) if (canExpedite(p) && p.acceleratedQuarters < 1) s = expeditePlant(s, p.id)
    s = endQuarter(s).state
  }
  if (s.phase !== 'operate') return s
  if (s.realtime) {
    s.realtime.vegetationSpend = o.vegetation ?? 0.5
    s.realtime.crewsTotal = o.crews ?? 3
    s.realtime.maintenanceDeferred = o.defer ?? false
  }
  for (let i = 0; i < 366 * 96 && s.phase === 'operate'; i++) {
    if (s.pendingEvent) {
      const speed = s.realtime!.speed
      s = resolveEvent(s, o.events === 'first' ? 0 : 1)
      if (s.realtime) s.realtime.speed = speed
    }
    stepRealtime(s, BOUNDS)
  }
  return s
}

export function summary(name: string, games: GameState[]): string {
  const ends: Record<string, number> = {}
  for (const g of games) { const e = g.ending ?? g.phase; ends[e] = (ends[e] ?? 0) + 1 }
  const cash = games.map((g) => g.cash / 1e6).sort((a, b) => a - b)
  const mean = cash.reduce((a, b) => a + b, 0) / cash.length
  const short = games.reduce((n, g) => n + (g.realtime?.unservedContractMwh ?? 0), 0) / games.length
  const pen = games.reduce((n, g) => n + g.penaltiesAccrued, 0) / games.length / 1e6
  const app = games.reduce((n, g) => n + (g.contract.approval ?? 0), 0) / games.length
  return `${name.padEnd(22)} mean ${mean.toFixed(0).padStart(5)} p10 ${cash[Math.floor(cash.length * 0.1)].toFixed(0)} p90 ${cash[Math.floor(cash.length * 0.9)].toFixed(0)} | short ${short.toFixed(0)} pen ${pen.toFixed(0)} appr ${app.toFixed(0)} | ${JSON.stringify(ends)}`
}
