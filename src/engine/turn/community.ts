import type { GameState } from '../types.ts'
import {
  CANCEL_BELOW, changeRating, DEFAULT_APPROVAL, homeOf, NO_PERMITS_BELOW, ratingOf, ratingRecord, SPREAD_ABOVE, SPREAD_BELOW, STALL_BELOW,
} from '../approval.ts'
import { pushLog } from '../state.ts'

export interface Programme {
  id: string
  label: string
  detail: string
  cost: number
  gain: number
  /** Quarters before it can be run again here. Infinity for once. */
  cooldown: number
  /** Why it cannot be run in a county, or null. */
  needs: (state: GameState, fips: string) => string | null
}

const plantsIn = (s: GameState, fips: string) => s.plants.filter((p) => p.countyFips === fips)
const linesIn = (s: GameState, fips: string) => s.corridors.filter(
  (c) => Object.values(c.parcels).some((p) => p.countyFips === fips))

export const PROGRAMMES: readonly Programme[] = [
  {
    id: 'meeting',
    label: 'Hold a public meeting',
    detail: 'Answer questions in person.',
    cost: 800_000, gain: 3, cooldown: 2,
    needs: () => null,
  },
  {
    id: 'screening',
    label: 'Plant a tree screen',
    detail: 'Hide your plants from the road.',
    cost: 2_500_000, gain: 4, cooldown: Infinity,
    needs: (s, f) => (plantsIn(s, f).length > 0 ? null : 'You have no plant here.'),
  },
  {
    id: 'roads',
    label: 'Repair roads and drainage',
    detail: 'Fix what the construction traffic broke.',
    cost: 4_000_000, gain: 4, cooldown: 6,
    needs: (s, f) => (plantsIn(s, f).some((p) => p.status !== 'permitting')
      || linesIn(s, f).some((c) => c.status === 'building' || c.status === 'energized')
      ? null : 'Nothing has been built here yet.'),
  },
  {
    id: 'local-hiring',
    label: 'Hire locally',
    detail: 'Pay a premium for county crews.',
    cost: 6_000_000, gain: 5, cooldown: Infinity,
    needs: (s, f) => (plantsIn(s, f).some((p) => p.status === 'construction')
      || linesIn(s, f).some((c) => c.status === 'building')
      ? null : 'Nothing is under construction here.'),
  },
  {
    id: 'bill-credit',
    label: 'Give a bill credit',
    detail: 'A one-time credit for every household.',
    cost: 8_000_000, gain: 7, cooldown: 4,
    needs: () => null,
  },
  {
    id: 'fund',
    label: 'Endow a community fund',
    detail: 'Schools, fire stations and parks.',
    cost: 12_000_000, gain: 9, cooldown: Infinity,
    needs: () => null,
  },
]

/** Programmes cannot lift approval past this. */
export const PROGRAMME_CAP = 85
/** Each repeat is worth this much of the one before. */
const REPEAT = 0.6

export interface ProgrammeOffer {
  programme: Programme
  gain: number
  /** Why it is unavailable, or null. */
  blocked: string | null
}

export function programmesFor(state: GameState, fips: string): ProgrammeOffer[] {
  const rating = ratingOf(state, fips)
  const runs = ratingRecord(state, fips).programmes
  return PROGRAMMES.map((programme) => {
    const run = runs?.[programme.id]
    const gain = Math.min(
      programme.gain * REPEAT ** (run?.times ?? 0),
      Math.max(0, PROGRAMME_CAP - (rating ?? DEFAULT_APPROVAL)),
    )
    const wait = run ? run.last + programme.cooldown - state.quarter : 0
    const blocked = rating === null ? 'No approval rating here.'
      : state.phase === 'ended' ? 'The scenario is over.'
      : run && programme.cooldown === Infinity ? 'Already done here.'
      : wait > 0 ? `Again in ${wait} ${wait === 1 ? 'quarter' : 'quarters'}.`
      : programme.needs(state, fips)
        ?? (gain < 0.5 ? 'Approval is as high as this can take it.'
          : state.cash + state.creditLimit < programme.cost ? 'You cannot afford it.' : null)
    return { programme, gain, blocked }
  })
}

/** Run a programme in a county. Returns a new state, or the same one if it cannot be run. */
export function runProgramme(prev: GameState, fips: string, id: string): GameState {
  const offer = programmesFor(prev, fips).find((o) => o.programme.id === id)
  if (!offer || offer.blocked) return prev
  const state = structuredClone(prev)
  state.cash -= offer.programme.cost
  const made = changeRating(state, fips, offer.gain, offer.programme.label, { cap: PROGRAMME_CAP })
  const owner = homeOf(state, fips)
  const record = owner === 'main' ? state.contract : owner ?? state.counties[fips]
  const runs = (record.programmes ??= {})
  runs[id] = { last: state.quarter, times: (runs[id]?.times ?? 0) + 1 }
  pushLog(
    state, 'politics',
    `${state.counties[fips]?.name} County: ${offer.programme.label.toLowerCase()}. ` +
    `$${(offer.programme.cost / 1e6).toFixed(1)}M, approval up ${made.toFixed(0)}.`,
    true,
  )
  return state
}

/** What a rating is doing to the project. */
export function approvalEffects(state: GameState, fips: string): string[] {
  const a = ratingOf(state, fips) ?? 50
  const owner = homeOf(state, fips)
  const home = owner !== null
  const out: string[] = []
  if (home && a < CANCEL_BELOW && (owner === 'main' ? state.phase === 'build' : owner.status === 'signed')) out.push('The data center is cancelled if the quarter ends here.')
  out.push(!home && a < NO_PERMITS_BELOW ? 'No new permits.'
    : a < STALL_BELOW ? 'Permits stall about one quarter in five.'
    : 'Permits run on schedule.')
  const pct = Math.round(((50 - a) / 180) * 100)
  out.push(Math.abs(pct) < 2 ? 'Landowners ask their usual price.'
    : `Landowners ask ${Math.abs(pct)}% ${pct > 0 ? 'more' : 'less'} than usual.`)
  if (!home) {
    out.push(a < SPREAD_BELOW ? 'Opposition here can lower the data center\'s approval.'
      : a >= SPREAD_ABOVE ? 'Support here can raise the data center\'s approval.'
      : `Below ${SPREAD_BELOW} it can lower the data center's approval, and from ${SPREAD_ABOVE} it can raise it.`)
  }
  return out
}

/** Choices ahead that will move a rating. */
export function approvalAdvice(state: GameState, fips: string): string[] {
  const out: string[] = []
  const home = fips === state.contract.countyFips
  const acquiring = linesIn(state, fips).some((c) => c.status === 'acquiring')
  if (acquiring) out.push('Buy rather than condemn. A homestead condemned costs 10, a farm 6, a church 18.')
  if (home && state.hearing !== 'resolved') out.push('Pay for the network upgrades yourself at the hearing: +14.')
  if (home && state.phase === 'operate') out.push('Keep homes powered. Each hour without power costs up to 1.')
  if (state.phase === 'build') {
    if (plantsIn(state, fips).length === 0) out.push('Site plants away from towns. Near people they cost up to seven times as much approval.')
    if (linesIn(state, fips).length === 0) out.push('Route along property lines. Each parcel cut in two costs a little.')
  }
  return out
}
