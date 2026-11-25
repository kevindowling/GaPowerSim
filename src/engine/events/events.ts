import type { GameState, Plant } from '../types.ts'
import type { Rng } from '../rng.ts'
import { plantType } from '../../data/plants.ts'
import { pushLog } from '../state.ts'
import { changeApproval } from '../approval.ts'
import { TICKS_PER_DAY } from '../realtime/types.ts'

export interface EventOption {
  label: string
  /** What it costs and does, in numbers. */
  effect: string
  apply: (state: GameState) => void
}

export interface GameEvent {
  id: string
  phase: 'build' | 'operate'
  title: string
  body: (state: GameState) => string
  when: (state: GameState) => boolean
  /** The last option is what happens if nobody answers. */
  options: readonly EventOption[]
}

const M = 1_000_000

function spend(state: GameState, dollars: number): void {
  state.cash -= dollars
}

function approve(state: GameState, points: number): void {
  changeApproval(state, points, currentTitle)
}

/** Title of the event being applied, for the approval record. */
let currentTitle = ''

function grieve(state: GameState, text: string): void {
  state.counties[state.contract.countyFips]?.grievances.push(text)
}

const permitting = (s: GameState): Plant[] => s.plants.filter((p) => p.status === 'permitting')
const building = (s: GameState): Plant[] => s.plants.filter((p) => p.status === 'construction')
const isGas = (p: Plant): boolean => plantType(p.typeId).heatRate > 0 && p.typeId !== 'nuclear-uprate'
const countyOf = (s: GameState): string => s.counties[s.contract.countyFips]?.name ?? 'the county'

function delay(plants: readonly Plant[], quarters = 1): void {
  for (const p of plants) p.quartersRemaining += quarters
}

export const EVENTS: readonly GameEvent[] = [
  {
    id: 'moratorium',
    phase: 'build',
    title: 'Moratorium vote',
    body: (s) => `${countyOf(s)} County will vote on pausing new industrial permits until it has an ordinance.`,
    when: (s) => permitting(s).length > 0,
    options: [
      {
        label: 'Help write the ordinance',
        effect: '$3M, +6 approval',
        apply: (s) => { spend(s, 3 * M); approve(s, 6) },
      },
      {
        label: 'Argue against it',
        effect: '$1M, -8 approval',
        apply: (s) => { spend(s, M); approve(s, -8); grieve(s, 'Opposed the moratorium') },
      },
      {
        label: 'Wait it out',
        effect: 'Plants in permitting slip one quarter',
        apply: (s) => delay(permitting(s)),
      },
    ],
  },
  {
    id: 'turbine-slot',
    phase: 'build',
    title: 'Turbine delivery slot',
    body: () => 'The manufacturer is moving your delivery back. Another buyer is willing to trade slots.',
    when: (s) => building(s).some(isGas),
    options: [
      {
        label: 'Buy the earlier slot',
        effect: '$9M',
        apply: (s) => spend(s, 9 * M),
      },
      {
        label: 'Take the later date',
        effect: 'One gas plant slips a quarter',
        apply: (s) => delay(building(s).filter(isGas).slice(0, 1)),
      },
    ],
  },
  {
    id: 'water',
    phase: 'build',
    title: 'Cooling water',
    body: (s) => `Farmers in ${countyOf(s)} County want to know how much water your plants will take in a dry summer.`,
    when: (s) => s.plants.some((p) => plantType(p.typeId).waterGalPerMwh > 20),
    options: [
      {
        label: 'Use treated wastewater',
        effect: '$7M, +8 approval',
        apply: (s) => { spend(s, 7 * M); approve(s, 8) },
      },
      {
        label: 'Publish a usage cap',
        effect: '$3M, +2 approval',
        apply: (s) => { spend(s, 3 * M); approve(s, 2) },
      },
      {
        label: 'Say nothing',
        effect: '-7 approval',
        apply: (s) => { approve(s, -7); grieve(s, 'Would not answer on water use') },
      },
    ],
  },
  {
    id: 'tortoise',
    phase: 'build',
    title: 'Gopher tortoises',
    body: () => 'Surveyors found gopher tortoise burrows on the right-of-way. They have to be relocated before clearing.',
    when: (s) => s.corridors.some((c) => c.status === 'building'),
    options: [
      {
        label: 'Bring in a relocation crew',
        effect: '$4M',
        apply: (s) => spend(s, 4 * M),
      },
      {
        label: 'Wait for the state to schedule it',
        effect: 'The line slips one quarter',
        apply: (s) => {
          const c = s.corridors.find((x) => x.status === 'building')
          if (c) { c.buildQuartersRemaining += 1; c.delayQuarters += 1 }
        },
      },
    ],
  },
  {
    id: 'landowners',
    phase: 'build',
    title: 'Landowners hire a lawyer',
    body: () => 'Owners along the route have pooled money for a lawyer and want to negotiate together.',
    when: (s) => s.corridors.some((c) => c.status === 'acquiring'
      && Object.values(c.deals).filter((d) => d.status === 'pending' || d.status === 'holdout').length > 6),
    options: [
      {
        label: 'Pay their legal costs',
        effect: '$2M, +4 approval',
        apply: (s) => { spend(s, 2 * M); approve(s, 4) },
      },
      {
        label: 'Deal with them one by one',
        effect: '-5 approval',
        apply: (s) => { approve(s, -5); grieve(s, 'Refused to meet the landowner group') },
      },
    ],
  },
  {
    id: 'early-service',
    phase: 'build',
    title: 'The campus wants power sooner',
    body: () => 'The developer will pay a bonus now if you move the in-service date forward one quarter.',
    when: (s) => s.contract.inServiceQuarter - s.quarter >= 5 && s.plants.length > 0,
    options: [
      {
        label: 'Take the bonus',
        effect: '+$35M, every payment due one quarter sooner',
        apply: (s) => {
          s.cash += 35 * M
          s.contract.inServiceQuarter -= 1
          for (const m of s.contract.milestones) if (!m.released && m.dueQuarter !== undefined) m.dueQuarter -= 1
        },
      },
      {
        label: 'Keep the date',
        effect: 'No change',
        apply: () => {},
      },
    ],
  },
  {
    id: 'training',
    phase: 'build',
    title: 'Lineworker training',
    body: (s) => `The technical college asks for help starting a lineworker course in ${countyOf(s)} County.`,
    when: (s) => s.contract.status === 'accepted',
    options: [
      {
        label: 'Fund the course',
        effect: '$3M, +7 approval',
        apply: (s) => { spend(s, 3 * M); approve(s, 7) },
      },
      {
        label: 'Decline',
        effect: 'No change',
        apply: () => {},
      },
    ],
  },
  {
    id: 'steel',
    phase: 'build',
    title: 'Steel prices',
    body: () => 'Steel is up and your tower contract has not been fixed.',
    when: (s) => s.corridors.some((c) => c.status === 'acquiring' || c.status === 'building'),
    options: [
      {
        label: 'Fix the price today',
        effect: '$5M',
        apply: (s) => spend(s, 5 * M),
      },
      {
        label: 'Pay market price later',
        effect: 'Unbuilt line costs 14% more',
        apply: (s) => {
          for (const c of s.corridors) {
            if (c.status !== 'energized') c.capexTotal += (c.capexTotal - c.capexSpent) * 0.14
          }
        },
      },
    ],
  },
  {
    id: 'site-storm',
    phase: 'build',
    title: 'Storm at the construction site',
    body: () => 'A thunderstorm knocked over a crane and flooded the foundations.',
    when: (s) => building(s).length > 0,
    options: [
      {
        label: 'Add a second shift',
        effect: '$6M',
        apply: (s) => spend(s, 6 * M),
      },
      {
        label: 'Absorb the delay',
        effect: 'One plant slips a quarter',
        apply: (s) => delay(building(s).slice(0, 1)),
      },
    ],
  },
  {
    id: 'gas-lateral',
    phase: 'build',
    title: 'Gas pipeline capacity',
    body: () => 'The pipeline company needs a new lateral before it can guarantee fuel on cold mornings.',
    when: (s) => s.plants.filter(isGas).length > 0,
    options: [
      {
        label: 'Pay for the lateral',
        effect: '$10M',
        apply: (s) => spend(s, 10 * M),
      },
      {
        label: 'Accept interruptible supply',
        effect: 'Gas plants in progress slip one quarter',
        apply: (s) => delay([...permitting(s), ...building(s)].filter(isGas)),
      },
    ],
  },

  {
    id: 'demand-response',
    phase: 'operate',
    title: 'Campus offers to drop load',
    body: () => 'The campus can shut down 80 MW of computing on request, for up to 60 hours this year.',
    when: (s) => s.realtime?.demandResponse === null,
    options: [
      {
        label: 'Sign up',
        effect: '$2M now, $250 per MWh used',
        apply: (s) => {
          spend(s, 2 * M)
          if (s.realtime) s.realtime.demandResponse = { mw: 80, hoursLeft: 60 }
        },
      },
      { label: 'Decline', effect: 'No change', apply: () => {} },
    ],
  },
  {
    id: 'import-offer',
    phase: 'operate',
    title: 'Firm import offer',
    body: (s) => `A neighbouring utility will reserve 50 MW for you at the ${s.system.substationName} for the rest of the year.`,
    when: (s) => s.realtime !== null,
    options: [
      {
        label: 'Reserve it',
        effect: '$6M, +50 MW imports',
        apply: (s) => { spend(s, 6 * M); s.system.importLimitMw += 50 },
      },
      { label: 'Decline', effect: 'No change', apply: () => {} },
    ],
  },
  {
    id: 'boiler-inspection',
    phase: 'operate',
    title: 'Turbine inspection',
    body: () => 'The maker recommends opening up one turbine after similar units cracked blades elsewhere.',
    when: (s) => s.plants.some((p) => p.status === 'online' && isGas(p)),
    options: [
      {
        label: 'Inspect it now',
        effect: '$1M, one unit out for four days',
        apply: (s) => {
          spend(s, M)
          const p = s.plants.find((x) => x.status === 'online' && isGas(x))
          if (p && s.realtime) outage(s, p, 'inspection', 4)
        },
      },
      {
        label: 'Keep running',
        effect: 'One in three chance of losing a unit for 20 days',
        apply: (s) => {
          const p = s.plants.find((x) => x.status === 'online' && isGas(x))
          // Uses the seed cursor, so a replay gives the same result.
          if (p && s.realtime && Math.abs(s.rngState) % 3 === 0) outage(s, p, 'cracked blade', 20)
        },
      },
    ],
  },
  {
    id: 'mutual-aid',
    phase: 'operate',
    title: 'Request for crews',
    body: () => 'A coastal utility needs line crews for two weeks after a tropical storm.',
    when: (s) => (s.realtime?.crewsTotal ?? 0) > 1 && (s.realtime?.outages.length ?? 0) === 0,
    options: [
      {
        label: 'Send one crew',
        effect: '+$2M, one fewer crew until you rehire',
        apply: (s) => { s.cash += 2 * M; if (s.realtime) s.realtime.crewsTotal -= 1 },
      },
      { label: 'Keep them home', effect: 'No change', apply: () => {} },
    ],
  },
  {
    id: 'bill-complaints',
    phase: 'operate',
    title: 'Complaints about bills',
    body: (s) => `Households in ${countyOf(s)} County say the campus has raised their bills.`,
    when: (s) => (s.counties[s.contract.countyFips]?.grievances.length ?? 0) > 1,
    options: [
      {
        label: 'Give a one-time credit',
        effect: '$4M, +8 approval',
        apply: (s) => { spend(s, 4 * M); approve(s, 8) },
      },
      {
        label: 'Publish the numbers',
        effect: '-4 approval',
        apply: (s) => { approve(s, -4) },
      },
    ],
  },
]

function outage(s: GameState, plant: Plant, cause: string, days: number): void {
  if (!s.realtime || s.realtime.outages.some((o) => o.assetId === plant.id)) return
  s.realtime.outages.push({
    assetId: plant.id, kind: 'plant', cause,
    // Two crews work a fault at double speed.
    ticksRemaining: days * TICKS_PER_DAY * 2,
    capacityFraction: 0, crews: 0, startedTick: s.realtime.tick,
  })
}

export function eventById(id: string): GameEvent | null {
  return EVENTS.find((e) => e.id === id) ?? null
}

function draw(state: GameState, rng: Rng, phase: 'build' | 'operate'): boolean {
  const open = EVENTS.filter(
    (e) => e.phase === phase && !state.firedEvents.includes(e.id) && e.when(state))
  if (open.length === 0) return false
  const e = rng.pick(open)
  state.pendingEvent = { id: e.id }
  state.firedEvents.push(e.id)
  return true
}

/** Chance of a decision each build quarter. */
const BUILD_EVENT_CHANCE = 0.62

export function drawBuildEvent(state: GameState, rng: Rng): boolean {
  if (state.pendingEvent || state.hearing === 'called') return false
  return rng.chance(BUILD_EVENT_CHANCE) && draw(state, rng, 'build')
}

export function drawOperatingEvent(state: GameState, rng: Rng): boolean {
  return !state.pendingEvent && draw(state, rng, 'operate')
}

function applyOption(state: GameState, index: number): void {
  const e = state.pendingEvent && eventById(state.pendingEvent.id)
  state.pendingEvent = null
  const option = e?.options[index]
  if (!e || !option) return
  currentTitle = e.title
  option.apply(state)
  pushLog(state, 'politics', `${e.title}: ${option.label.toLowerCase()} (${option.effect}).`, true)
}

/** Answer the pending event. Returns a new state. */
export function resolveEvent(prev: GameState, index: number): GameState {
  if (!prev.pendingEvent) return prev
  const state = structuredClone(prev)
  applyOption(state, index)
  return state
}

/** Used when a quarter ends with a decision unanswered. Mutates. */
export function resolvePendingByDefault(state: GameState): void {
  const e = state.pendingEvent && eventById(state.pendingEvent.id)
  if (e) applyOption(state, e.options.length - 1)
}
