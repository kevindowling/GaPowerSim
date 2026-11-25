import { bareGame, sumterSurface } from '../helpers/play.ts'
import { fixtures } from '../helpers/loadFixtures.ts'
import { CENTERS, SUBS } from './customers.ts'
import { areaSubstations, commitCorridor, condemn, networkNodes, offerAll, planCorridor } from '../../src/engine/turn/corridor.ts'
import { endQuarter } from '../../src/engine/turn/resolve.ts'
import { assignSpare, beginCompany, openOffers, signCustomer, spareLeft } from '../../src/engine/customers.ts'
import { orderEquipment } from '../../src/engine/turn/equipment.ts'
import { programmesFor, runProgramme } from '../../src/engine/turn/community.ts'
import { dcNode, subNode } from '../../src/engine/realtime/network.ts'
import type { LineClassId } from '../../src/data/transmission.ts'
import type { GameState } from '../../src/engine/types.ts'

export interface CompanyPlan {
  /** How many of the customers waiting for power to connect, biggest due payments first. */
  connect: number
  grid: LineClassId[]
  rebuild: boolean
  spare: boolean
  /** New contracts to sign, as they come up. */
  sign: number
}

/** Play Georgia Power, without the first data center, to the end of 2034. */
export function playCompany(seed: number, o: CompanyPlan): GameState {
  const { grid, counties } = fixtures()
  let g = beginCompany(bareGame(undefined, seed), CENTERS, counties, grid)
  g.substations = areaSubstations(g, grid, SUBS)
  const waiting: Array<{ id: string }> = []
  let signed = 0
  const ages = new Map<string, number>()
  const connect = (): void => {
   const next = g.customers!.filter((c) => c.status === 'signed' && !waiting.some((w) => w.id === c.id))
     .sort((a, b) => b.contractedMw - a.contractedMw).slice(0, o.connect - waiting.length)
   for (const c of next) {
    waiting.push({ id: c.id })
    for (const cls of o.grid) {
      const kv = cls === '115' ? 115 : cls === '500' ? 500 : 230
      const near = g.substations!.filter((s) => s.kv === kv && s.area === c.id)
        .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0]
      if (!near) continue
      const nodes = networkNodes(g, grid)
      const p = planCorridor(sumterSurface(), nodes.find((n) => n.id === dcNode(c.id))!, nodes.find((n) => n.id === subNode(near.id))!, cls)
      if (!p || p.blocked > 0 || p.lengthKm > 30) continue
      g = commitCorridor(g, p)
      g = orderEquipment(g, `campus-${kv}` as 'campus-230', false, dcNode(c.id))
      if (cls === '230d') g = orderEquipment(g, 'campus-230', false, dcNode(c.id))
      if (o.rebuild) g = orderEquipment(g, `area-${kv}` as 'area-230', false, dcNode(c.id))
    }
   }
  }
  for (let q = 0; q < 40 && g.phase === 'build'; q++) {
    for (const x of openOffers(g)) {
      if (signed >= o.sign) break
      g = signCustomer(g, CENTERS.find((d) => d.id === x.id), counties, grid)
      signed++
    }
    g.substations = areaSubstations(g, grid, SUBS)
    connect()
    for (const k of g.corridors) {
      if (k.status !== 'acquiring') continue
      const age = (ages.get(k.id) ?? -1) + 1
      ages.set(k.id, age)
      if (age < 5) g = offerAll(g, k.id, 1.6 + 0.6 * age)
      else for (const [id, d] of Object.entries(k.deals)) if (d.status === 'holdout' || d.status === 'pending') g = condemn(g, k.id, id)
    }
    for (const c of g.customers ?? []) {
      if (c.status !== 'signed') continue
      for (const p of programmesFor(g, c.countyFips)) {
        if (!p.blocked && (g.customers!.find((x) => x.id === c.id)!.approval ?? 50) < 38 && p.programme.cost < 9e6) g = runProgramme(g, c.countyFips, p.programme.id)
      }
      if (o.spare && waiting.some((w) => w.id === c.id)) {
        g = assignSpare(g, c.id, Math.min(c.contractedMw, c.spareMw + Math.max(0, spareLeft(g))))
      }
    }
    g = endQuarter(g).state
  }
  return g
}

export function companySummary(name: string, games: GameState[]): string {
  const mean = games.reduce((n, g) => n + g.cash / 1e6, 0) / games.length
  const low = Math.min(...games.flatMap((g) => (g.cashHistory ?? []).map((h) => h.cash / 1e6)))
  const g = games[0]
  const on = g.customers!.reduce((n, c) => n + c.phasesOn * c.phaseMw, 0)
  const at = (g.cashHistory ?? []).filter((_, i) => i % 6 === 5).map((h) => (h.cash / 1e6).toFixed(0)).join(' ')
  return `${name.padEnd(24)} mean ${mean.toFixed(0)} lowest ${low.toFixed(0)} on ${on.toFixed(0)} MW ends ${games.map((x) => x.ending).join(',')} | ${at}`
}
