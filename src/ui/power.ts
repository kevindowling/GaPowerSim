import type { GameState, Plant } from '../engine/types.ts'
import type { PlantKind } from '../data/plants.ts'
import { lineClass } from '../data/transmission.ts'
import { TAP_CLASSES } from '../data/taps.ts'
import { formatQuarter } from '../engine/time.ts'
import { plantArrival, type PowerForecast } from '../engine/forecast.ts'
import { gearName } from '../engine/turn/equipment.ts'
import { equipmentType } from '../data/equipment.ts'
import {
  CAMPUS_TX, nodesRoutedToCampus, plantNode, poolMw, STORAGE_FIRM_SHARE, SUBSTATION_TX, type PowerLimit,
} from '../engine/realtime/network.ts'
import { mw } from './format.ts'

export const FIRM_MEANING = 'Firm power is what a plant can be counted on for at any hour. Only firm power counts toward the campus.'

/** Why a plant is not firm for its full size. */
export const FIRM_WHY: Partial<Record<PlantKind, string>> = {
  solar: 'Solar makes nothing at night, so 8% counts as firm.',
  battery: 'A battery runs four hours, so 60% counts as firm.',
}

export function limitText(game: GameState, limit: PowerLimit): string {
  switch (limit.kind) {
    case 'no-line': return 'No line to the campus yet.'
    case 'campus-full': return (game.customers ?? []).length > 0 ? 'Every data center it reaches already has its power.'
      : `The campus already gets its ${mw(game.contract.contractedMw)}.`
    case 'storage-cap': return `Batteries count for at most ${mw(game.contract.contractedMw * STORAGE_FIRM_SHARE)}.`
    case 'no-transformer': return limit.place === 'campus'
      ? `The campus has no ${limit.kv} kV transformer, so ${limit.kv} kV lines cannot serve it. Click the campus to order one.`
      : limit.place === 'customer'
        ? `${game.customers?.find((c) => c.id === limit.id)?.name ?? 'The campus'} has no ${limit.kv} kV transformer. Click it to order one.`
      : `${game.system.substationName} has no ${limit.kv} kV transformer. Click it to order one.`
    case 'lines': return `${limit.ids.map((id) => lineLimit(game, id)).join(' ')}`
  }
}

function lineLimit(game: GameState, id: string): string {
  if (id === 'tie') {
    return `It has to pass ${game.system.substationName}, and the tie from there to the campus carries ${mw(game.system.tieMw)}.`
  }
  if (id === 'region') return `The region can send only so much through ${game.system.substationName} after homes are served.`
  if (id.startsWith('pool:')) {
    const parts = id.split(':')
    const kv = Number(parts[parts.length - 1])
    const t = TAP_CLASSES.find((c) => c.kv === kv)
    const area = parts.length === 3 ? parts[1] : ''
    return `Existing ${kv} kV lines ${area ? `near ${game.customers?.find((c) => c.id === area)?.name ?? 'it'} ` : ''}have ${mw(t ? poolMw(game, t.kv, () => true, area) : 0)} to spare.`
  }
  if (id === CAMPUS_TX) return `The existing transformer at the campus passes ${mw(game.system.tieMw)}.`
  if ((SUBSTATION_TX as readonly string[]).includes(id)) {
    return `The existing transformers at ${game.system.substationName} pass ${mw(game.system.transformerMw ?? 0)}.`
  }
  const gear = game.equipment?.find((e) => e.id === id)
  if (gear) return `The ${gearName(game, gear)} passes ${mw(equipmentType(gear.typeId).mw)}.`
  const c = game.corridors.find((x) => x.id === id)
  return c ? `${c.name} carries ${mw(lineClass(c.classId).ratingMw)}.` : 'The line is full.'
}

export interface PowerNote { text: string; warn: boolean }

/** What reaches the campus from a plant today, and what will. */
export function plantPowerLines(game: GameState, forecast: PowerForecast, p: Plant): { now: string; notes: PowerNote[] } {
  const first = forecast.points[0].flow.plants.get(p.id)
  const last = forecast.points[forecast.points.length - 1].flow.plants.get(p.id)
  const nowMw = first?.arrivingMw ?? 0
  const notes: PowerNote[] = []
  const add = (text: string, warn: boolean): void => { notes.push({ text, warn }) }
  const routed = nodesRoutedToCampus(game).has(plantNode(p))

  if (first?.limit) {
    if (first.limit.kind === 'no-line' && routed) add('Its line to the campus is not in service yet.', false)
    else add(limitText(game, first.limit), first.limit.kind !== 'campus-full')
  }
  const later = plantArrival(forecast, p.id)
  if (later.mw > nowMw + 0.5 && later.quarter !== null) {
    add(`${mw(later.mw)} from ${formatQuarter(later.quarter)} if nothing slips.`, false)
  }
  const sameLimit = JSON.stringify(first?.limit) === JSON.stringify(last?.limit)
  if (last?.limit && !sameLimit) add(limitText(game, last.limit), last.limit.kind !== 'campus-full')
  return { now: mw(nowMw), notes }
}
