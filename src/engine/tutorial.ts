import type { GameState } from './types.ts'
import { capacitySummary } from './state.ts'
import { acquisitionComplete } from './turn/corridor.ts'
import { plannedByLinesMw, plannedFirmMw } from './realtime/network.ts'

export interface TutorialState {
  /** Index into BEATS. */
  beat: number
  /** True while the player has the hints hidden. */
  dismissed: boolean
  stormFired: boolean
  /** Operating tick the scripted storm arrives. Null until energized. */
  stormAtTick: number | null
}

export function createTutorialState(): TutorialState {
  return { beat: 0, dismissed: false, stormFired: false, stormAtTick: null }
}

export interface TutorialBeat {
  id: string
  title: string
  body: string[]
  /** Which panel the player needs. */
  focus: 'build' | 'grid' | 'land' | 'customers' | 'ops'
  isComplete: (state: GameState) => boolean
}

export const BEATS: readonly TutorialBeat[] = [
  {
    id: 'deal',
    title: 'Sign the contract',
    focus: 'customers',
    body: ['Click Liberty Americus Campus, read its terms and sign. Its due dates start that day. Customers lists the contracts you have signed and the others you can sign. More come up each year.'],
    isComplete: (s) => s.contract.status !== 'offered',
  },
  {
    id: 'generation',
    title: 'Build firm generation',
    focus: 'build',
    body: [
      'You need 400 MW of firm capacity. Firm means available at any hour. Solar counts for 8% of its nameplate.',
      'Pick a plant, then click the map. Rural sites cost less goodwill. Sites near the campus need a shorter line.',
    ],
    isComplete: (s) => {
      const cap = capacitySummary(s)
      return cap.onlineFirmMw + cap.underConstructionFirmMw >= s.contract.contractedMw
    },
  },
  {
    id: 'route',
    title: 'Connect it to the campus',
    focus: 'grid',
    body: [
      'Open Grid and plan a line. Click your plant and the campus, in either order, or drag between them. Click the map afterwards to bend the route.',
      'You can also tap an existing line, marked in blue while you plan. It needs less land, but it costs a station and has limited room.',
      'The route style changes who is affected. Following property lines avoids cutting farms in two.',
    ],
    isComplete: (s) => s.energizedQuarter !== null || plannedByLinesMw(s) + 1e-6 >= s.contract.contractedMw,
  },
  {
    id: 'transformer',
    title: 'Order transformers',
    focus: 'grid',
    body: [
      'A line can only serve the campus through a transformer of the same voltage. The campus has one for 120 MW at 115 kV.',
      'Click the campus and order one that fits your line. It takes ten quarters, or five from stock at a higher price.',
      'The substation has transformers too. Click it to see what limits it.',
    ],
    isComplete: (s) => !s.equipment || s.energizedQuarter !== null || plannedFirmMw(s) + 1e-6 >= s.contract.contractedMw,
  },
  {
    id: 'acquire',
    title: 'Make offers for the land',
    focus: 'land',
    body: [
      'Each owner has a price in mind that you cannot see. Offer by group, then end the quarter to hear back.',
      'What you pay becomes the going rate. A high first offer makes the remaining owners ask for more.',
    ],
    isComplete: (s) => s.corridors.some(
      (c) => acquisitionComplete(c)
        || Object.values(c.deals).some((d) => d.status === 'accepted' || d.status === 'condemned'),
    ),
  },
  {
    id: 'holdouts',
    title: 'Settle with the holdouts',
    focus: 'land',
    body: [
      'Raise the offer, condemn the parcel, or abandon the route and draw another.',
      'Condemning takes two to four quarters in court, costs goodwill, and raises every other owner\'s price on the line.',
    ],
    isComplete: (s) => s.corridors.some(acquisitionComplete),
  },
  {
    id: 'hearing',
    title: 'Answer the county commission',
    focus: 'customers',
    body: ['The commission wants to know who pays for the network upgrades.'],
    isComplete: (s) => s.hearing === 'resolved',
  },
  {
    id: 'energize',
    title: 'Finish construction',
    focus: 'customers',
    body: [
      'End quarters until the plants and the line are done. You can pay to expedite a plant under construction.',
      'Each phase of the campus turns on when its firm power arrives, and pays from the next quarter. The operating year starts with every phase on.',
    ],
    isComplete: (s) => s.energizedQuarter !== null,
  },
  {
    id: 'operate',
    title: 'Run the first month',
    focus: 'ops',
    body: [
      'Set a speed to start the clock. Every phase of the campus is on.',
      'Maintenance, line clearing and crews all cost money. Each one changes how often things fail or how long they stay down.',
    ],
    isComplete: (s) => (s.realtime?.tick ?? 0) >= 30 * 96,
  },
  {
    id: 'storm',
    title: 'Get through the summer',
    focus: 'ops',
    body: [
      'Summer heat raises demand, weakens turbines and shrinks imports. Storms take lines down.',
      'Set who loses power first before you need it. The year ends with your balance, which is your score.',
    ],
    isComplete: (s) => s.ending !== null,
  },
]

/** Advance the beat pointer as far as the state allows. */
export function advanceTutorial(state: GameState): boolean {
  const t = state.tutorial
  if (!t || t.beat >= BEATS.length) return false
  let moved = false
  while (t.beat < BEATS.length && BEATS[t.beat].isComplete(state)) {
    t.beat += 1
    moved = true
  }
  return moved
}

/** The step the player is on, or null when hidden or finished. */
export function currentBeat(state: GameState): TutorialBeat | null {
  const t = state.tutorial
  if (!t || t.dismissed) return null
  return BEATS[beatIndex(state)] ?? null
}

export function beatIndex(state: GameState): number {
  let i = state.tutorial?.beat ?? 0
  while (i < BEATS.length && BEATS[i].isComplete(state)) i += 1
  return i
}

export function tutorialFinished(state: GameState): boolean {
  return (state.tutorial?.beat ?? 0) >= BEATS.length
}
