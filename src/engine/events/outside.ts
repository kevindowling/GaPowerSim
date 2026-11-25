import type { GameState } from '../types.ts'
import { Rng, deriveSeed } from '../rng.ts'
import { quarterInYear } from '../time.ts'
import {
  changeRating, neighbours, ratingOf, SPREAD_ABOVE, SPREAD_BELOW,
} from '../approval.ts'
import { pushLog } from '../state.ts'

// DATA STATUS: every event here is invented.

export interface OutsideEvent {
  id: string
  /** {county} is the neighbouring county it happens in. */
  text: string
  delta: number
  /** Where it lands: the data center itself, or a neighbouring county. */
  where: 'home' | 'neighbour'
  when?: (state: GameState) => boolean
}

const building = (s: GameState): boolean => s.phase === 'build'
const operating = (s: GameState): boolean => s.phase === 'operate'

export const OUTSIDE_EVENTS: readonly OutsideEvent[] = [
  { id: 'petition', where: 'home', delta: -6, when: building, text: 'A petition for a moratorium passes 2,000 signatures.' },
  { id: 'rate-increase', where: 'home', delta: -7, text: 'The Public Service Commission approves a rate increase.' },
  { id: 'dry-summer', where: 'home', delta: -5, when: (s) => [2, 3].includes(quarterInYear(s.quarter)), text: 'The county asks homes to limit watering in a dry summer.' },
  { id: 'noise', where: 'home', delta: -4, text: 'A video of fan noise at a data center in another state spreads here.' },
  { id: 'tax-break', where: 'home', delta: -6, when: building, text: 'A newspaper reports the size of the developer\'s tax break.' },
  { id: 'campaign', where: 'home', delta: -4, text: 'A commission candidate campaigns against the data center.' },
  { id: 'lawsuit', where: 'home', delta: -5, when: building, text: 'Neighbors sue the county over the rezoning.' },
  { id: 'truck-crash', where: 'home', delta: -4, when: building, text: 'A contractor\'s truck crashes on a school route.' },
  { id: 'few-jobs', where: 'home', delta: -5, text: 'The developer cuts its job estimate.' },

  { id: 'local-hires', where: 'home', delta: 5, text: 'The developer hires 40 county residents.' },
  { id: 'tax-payment', where: 'home', delta: 6, text: 'The developer pays the school district a year early.' },
  { id: 'layoffs', where: 'home', delta: 4, text: 'A factory nearby closes, and the campus jobs look better.' },
  { id: 'rate-freeze', where: 'home', delta: 5, text: 'The Public Service Commission freezes base rates for a year.' },
  { id: 'cost-law', where: 'home', delta: 6, when: building, text: 'A state law makes data centers pay their own grid costs.' },
  { id: 'farm-bureau', where: 'home', delta: 4, text: 'The farm bureau endorses the developer\'s water plan.' },
  { id: 'smaller-site', where: 'home', delta: 5, when: building, text: 'The developer moves its buildings away from homes.' },
  { id: 'scholarships', where: 'home', delta: 4, text: 'The developer pays for 25 scholarships.' },
  { id: 'storm-shelter', where: 'home', delta: 5, when: operating, text: 'The campus lends generators to the county shelter after a storm.' },

  { id: 'n-moratorium', where: 'neighbour', delta: -14, text: '{county} County passes a moratorium on data centers.' },
  { id: 'n-wells', where: 'neighbour', delta: -11, text: '{county} County farmers report low wells and blame data centers.' },
  { id: 'n-line', where: 'neighbour', delta: -10, when: building, text: 'A rumor spreads that a power line will cross {county} County.' },
  { id: 'n-paper', where: 'neighbour', delta: -10, text: 'The {county} County paper runs a series on data center water use.' },
  { id: 'n-supplier', where: 'neighbour', delta: 11, text: 'A supplier to the campus opens in {county} County.' },
  { id: 'n-crews', where: 'neighbour', delta: 10, when: building, text: 'The developer hires building crews from {county} County.' },
  { id: 'n-roads', where: 'neighbour', delta: 9, text: 'The developer pays for road repairs in {county} County.' },
  { id: 'n-fire', where: 'neighbour', delta: 9, text: 'The developer buys {county} County a fire truck.' },
]

/** Chances each quarter. Invented. */
const EVENT_CHANCE = 0.55
const SPREAD_CHANCE = 0.45

const points = (n: number): string => `${n >= 0 ? '+' : ''}${Math.round(n)}`
const nameOf = (s: GameState, fips: string): string => s.counties[fips]?.name ?? ''

function stream(state: GameState, label: string): Rng {
  // Separate from the game's stream, so nothing else shifts.
  return new Rng(deriveSeed(state.seed, `${label}:${state.quarter}`))
}

function report(state: GameState, text: string): string {
  pushLog(state, 'politics', text, true)
  return text
}

/** A data center and the counties round it. */
interface Place { key: string; name: string; fips: string; near: readonly string[] }

function places(state: GameState): Place[] {
  const out: Place[] = []
  const c = state.contract
  if (c.status === 'accepted' || c.status === 'served') out.push({ key: '', name: 'Data center', fips: c.countyFips, near: neighbours(state) })
  for (const x of state.customers ?? []) {
    // One with all its power no longer needs anyone's approval.
    if (x.status === 'signed') out.push({ key: `${x.id}:`, name: x.name, fips: x.countyFips, near: x.neighbours })
  }
  return out
}

function drawEvent(state: GameState, at: Place, others: number): string | null {
  const rng = stream(state, `outside${at.key}`)
  // Less often for each of many, so the news stays readable.
  if (!rng.chance(at.key ? Math.min(EVENT_CHANCE / 2, 0.8 / Math.max(1, others)) : EVENT_CHANCE)) return null
  const open = OUTSIDE_EVENTS.filter((e) => !state.firedEvents.includes(`outside:${at.key}${e.id}`)
    && (e.where === 'home' || at.near.length > 0) && (e.when?.(state) ?? true))
  if (open.length === 0) return null
  const e = rng.pick(open)
  state.firedEvents.push(`outside:${at.key}${e.id}`)
  const prefix = at.key ? `${at.name}: ` : ''
  if (e.where === 'home') {
    const made = changeRating(state, at.fips, e.delta, e.text, { outside: true })
    return report(state, `${prefix}${e.text} ${at.key ? 'Approval' : 'Data center approval'} ${points(made)}, now ${Math.round(ratingOf(state, at.fips) ?? 0)}.`)
  }
  const fips = rng.pick(at.near)
  const text = e.text.replace('{county}', nameOf(state, fips))
  const made = changeRating(state, fips, e.delta, text, { outside: true })
  return report(state, `${text} Approval there ${points(made)}, now ${Math.round(ratingOf(state, fips) ?? 0)}.`)
}

const OPPOSED = [
  '{county} County commissioners vote to oppose the data center.',
  '{county} County residents speak against the data center at a {home} County hearing.',
]
const SUPPORTIVE = [
  '{county} County commissioners write in support of the data center.',
  '{county} County residents speak for the data center at a {home} County hearing.',
]

/** How much a neighbouring county's opinion moves the data center's when it spreads. */
export function spreadDelta(rating: number): number {
  if (rating < SPREAD_BELOW) return -Math.min(6, 2 + (SPREAD_BELOW - rating) / 5)
  if (rating >= SPREAD_ABOVE) return Math.min(5, 2 + (rating - SPREAD_ABOVE) / 5)
  return 0
}

function drawSpread(state: GameState, at: Place, others: number): string | null {
  const rng = stream(state, `spread${at.key}`)
  if (!rng.chance(at.key ? Math.min(SPREAD_CHANCE, 1 / Math.max(1, others)) : SPREAD_CHANCE)) return null
  const loud = at.near.filter((f) => spreadDelta(ratingOf(state, f) ?? 50) !== 0)
  if (loud.length === 0) return null
  const fips = rng.pick(loud)
  const delta = spreadDelta(ratingOf(state, fips)!)
  const text = rng.pick(delta < 0 ? OPPOSED : SUPPORTIVE)
    .replace('{county}', nameOf(state, fips)).replace('{home}', nameOf(state, at.fips))
  const made = changeRating(state, at.fips, delta, text, { outside: true })
  return report(state, `${at.key ? `${at.name}: ` : ''}${text} ${at.key ? 'Approval' : 'Data center approval'} ${points(made)}, now ${Math.round(ratingOf(state, at.fips) ?? 0)}.`)
}

/** What happens this quarter that the player cannot control. Mutates. */
export function drawOutsideEvents(state: GameState): string[] {
  const list = places(state)
  const others = list.filter((p) => p.key).length
  return list.flatMap((p) => [drawEvent(state, p, others), drawSpread(state, p, others)]).filter((t): t is string => t !== null)
}
