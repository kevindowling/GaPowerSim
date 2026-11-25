import { readFileSync } from 'node:fs'
import { bareGame, sumterSurface } from '../helpers/play.ts'
import { fixtures } from '../helpers/loadFixtures.ts'
import { inflateSubstation } from '../../src/data/substations.ts'
import { areaSubstations, commitCorridor, condemn, networkNodes, offerAll, planCorridor } from '../../src/engine/turn/corridor.ts'
import { acceptContract, endQuarter } from '../../src/engine/turn/resolve.ts'
import { assignSpare, signBlocked, signCustomer, spareLeft } from '../../src/engine/customers.ts'
import { orderEquipment } from '../../src/engine/turn/equipment.ts'
import { assessSite, sitePlant } from '../../src/engine/turn/siting.ts'
import { programmesFor, runProgramme } from '../../src/engine/turn/community.ts'
import { resolveEvent } from '../../src/engine/events/events.ts'
import { dcNode, siteNode, subNode } from '../../src/engine/realtime/network.ts'
import { pointToCell } from '../../src/engine/geo/hex.ts'
import { project } from '../../src/engine/geo/projection.ts'
import type { PlantKind } from '../../src/data/plants.ts'
import type { LineClassId } from '../../src/data/transmission.ts'
import type { GameState } from '../../src/engine/types.ts'

export const CENTERS: any[] = JSON.parse(readFileSync('public/data/datacenters.json', 'utf8')).map((d: any) => {
  const [x, y] = project(d.lon, d.lat)
  return { ...d, x, y }
})
export const SUBS = JSON.parse(readFileSync('public/data/gis/substations.json', 'utf8')).map(inflateSubstation)

export interface Plan {
  names: string[]
  /** Lines to existing substations, by voltage. */
  grid: LineClassId[]
  rebuild: boolean
  /** Share of each contract set aside from spare power. */
  spare: number
  plants: Array<[PlantKind, number]>
  deliver: boolean
}

/** Supply data centers without the first one, to the end of 2034. */
export function playCustomers(seed: number, o: Plan): GameState {
  const { grid, counties } = fixtures()
  let g = acceptContract(bareGame(undefined, seed))
  g.contract.status = 'failed'
  g.cash = 0
  for (const n of o.names) {
    const dc = CENTERS.find((d) => d.name.includes(n))
    if (dc && signBlocked(g, dc) === null) g = signCustomer(g, dc, counties, grid)
  }
  g.substations = areaSubstations(g, grid, SUBS)
  if (o.deliver) for (const c of g.customers ?? []) {
    const link = (toId: string, cls: LineClassId): void => {
      const nodes = networkNodes(g, grid)
      const p = planCorridor(sumterSurface(), nodes.find((n) => n.id === dcNode(c.id))!, nodes.find((n) => n.id === toId)!, cls)
      if (p && p.blocked === 0) g = commitCorridor(g, p)
      const kv = cls === '115' ? '115' : cls === '500' ? '500' : '230'
      g = orderEquipment(g, `campus-${kv}`, false, dcNode(c.id))
      if (kv === '230' && cls === '230d') g = orderEquipment(g, 'campus-230', false, dcNode(c.id))
    }
    for (const cls of o.grid) {
      const kv = cls === '115' ? 115 : cls === '500' ? 500 : 230
      const near = g.substations!.filter((s) => s.kv === kv && s.area === c.id)
        .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0]
      if (near) link(subNode(near.id), cls)
      if (o.rebuild && near) g = orderEquipment(g, `area-${kv}` as 'area-230', false, dcNode(c.id))
    }
    if (o.plants.length > 0) {
      let cell = -1
      for (let r = 3; r < 14 && cell < 0; r++) {
        for (let a = 0; a < 12 && cell < 0; a++) {
          const [col, row] = pointToCell(grid.spec, c.x + r * Math.cos(a / 2), c.y + r * Math.sin(a / 2))
          const at = row * grid.spec.cols + col
          if (o.plants.every(([k]) => assessSite(g, k, at, grid).ok)) cell = at
        }
      }
      if (cell >= 0) {
        for (const [k, n] of o.plants) for (let i = 0; i < n; i++) g = sitePlant(g, k, cell, grid)
        link(siteNode(cell), o.plants.reduce((n, [, k]) => n + k, 0) > 2 ? '500' : '230d')
      }
    }
  }
  for (const c of g.customers ?? []) g = assignSpare(g, c.id, Math.min(c.contractedMw * o.spare, spareLeft(g)))
  for (let q = 0; q < 40 && g.phase === 'build'; q++) {
    for (const k of g.corridors) {
      if (k.status !== 'acquiring') continue
      if (q < 5) g = offerAll(g, k.id, 1.6 + 0.6 * q)
      else for (const [id, d] of Object.entries(k.deals)) if (d.status === 'holdout' || d.status === 'pending') g = condemn(g, k.id, id)
    }
    if (g.pendingEvent) g = resolveEvent(g, 0)
    for (const c of g.customers ?? []) {
      if (c.status !== 'signed' || !o.deliver) continue
      for (const p of programmesFor(g, c.countyFips)) {
        if (!p.blocked && (g.customers!.find((x) => x.id === c.id)!.approval ?? 50) < 40) g = runProgramme(g, c.countyFips, p.programme.id)
      }
    }
    if (o.spare > 0) for (const c of g.customers ?? []) {
      if (c.status === 'signed') g = assignSpare(g, c.id, Math.min(c.contractedMw * o.spare, c.spareMw + Math.max(0, spareLeft(g))))
    }
    g = endQuarter(g).state
  }
  return g
}

export function customerSummary(name: string, games: GameState[]): string {
  const cash = games.map((g) => g.cash / 1e6)
  const mean = cash.reduce((a, b) => a + b, 0) / cash.length
  const low = Math.min(...games.flatMap((g) => (g.cashHistory ?? []).map((h) => h.cash / 1e6)))
  const g = games[0]
  return `${name.padEnd(26)} mean ${mean.toFixed(0).padStart(6)} lowest ${low.toFixed(0)} end ${games.map((x) => x.ending ?? x.phase).join(',')} | ${g.customers!.map((c) => `${c.phasesOn}/${c.phaseCount}${c.status[0]}`).join(' ')}`
}
