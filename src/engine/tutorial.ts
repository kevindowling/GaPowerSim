/**
 * The Americus tutorial.
 *
 * Nine beats, each gated on the previous one, and each taught by consequence
 * rather than by tooltip. The player is never told "solar will not work" — they
 * are shown firm capacity next to nameplate and allowed to find out. They are
 * never told "buy the second circuit" — they are offered it, and then, six beats
 * later, a storm arrives.
 *
 * The beat system only reads GameState, so a beat completes because the player
 * actually did the thing, not because they clicked past a dialog.
 */

import type { GameState } from './types.ts'
import { capacitySummary } from './state.ts'
import { acquisitionComplete } from './turn/corridor.ts'

export interface TutorialState {
  /** Index into BEATS. */
  beat: number
  /** True once the player has dismissed the coach for good. */
  dismissed: boolean
  /** Set when the county commission hearing has been held and answered. */
  hearingResolved: boolean
  /** Set once the scripted storm has been staged, so it only happens once. */
  stormFired: boolean
  /** Ticks of operation before the storm arrives. */
  stormAtTick: number
  /** Set when the player has seen the final scorecard. */
  debriefSeen: boolean
}

export function createTutorialState(): TutorialState {
  return {
    beat: 0,
    dismissed: false,
    hearingResolved: false,
    stormFired: false,
    // Roughly two days of operations: long enough to believe it is working.
    stormAtTick: 190,
    debriefSeen: false,
  }
}

export interface TutorialBeat {
  id: string
  title: string
  /** What the player should understand at this point. */
  body: string[]
  /** Which panel the player needs. */
  focus: 'contract' | 'generation' | 'transmission' | 'acquisition' | 'operations' | 'none'
  /** True once the player has done the thing. */
  isComplete: (state: GameState) => boolean
}

export const BEATS: readonly TutorialBeat[] = [
  {
    id: 'deal',
    title: 'The deal',
    focus: 'contract',
    body: [
      'Liberty Data Centers wants 400 megawatts outside Americus — four phases, about 100 each — drawing around the clock from the day it opens.',
      'They front the capital. You owe them power by the end of 2029, and a penalty every quarter you are late.',
      'Sign it.',
    ],
    isComplete: (s) => s.contract.status !== 'offered',
  },
  {
    id: 'generation',
    title: 'Something has to make it',
    focus: 'generation',
    body: [
      'You need 400 MW of firm capacity — power available at three in the morning in February, not power available on average.',
      'Every option shows firm megawatts next to nameplate. Look at the gap before you spend anything.',
      'Site enough generation to cover the contract, and mind how long each one takes to build.',
    ],
    isComplete: (s) => {
      const cap = capacitySummary(s)
      return cap.onlineFirmMw + cap.underConstructionFirmMw >= s.contract.contractedMw
    },
  },
  {
    id: 'route',
    title: 'Something has to carry it',
    focus: 'transmission',
    body: [
      'A power plant with nowhere to send its output serves nobody. You need a line from the plant to the campus.',
      'Plan a corridor. The route runs across real property, and the plan will tell you how many places it crosses — and how many it cuts in half.',
      'A line that follows property boundaries takes the same acres for far less money. Where you put it matters as much as how long it is.',
    ],
    isComplete: (s) => s.corridors.length > 0,
  },
  {
    id: 'acquire',
    title: 'Somebody owns all of it',
    focus: 'acquisition',
    body: [
      'Every parcel under that line has an owner, and each one has to agree.',
      'Offers are a multiple of appraised value. Most people will deal. Send some offers and end the quarter to see who signs.',
    ],
    isComplete: (s) => s.corridors.some(
      (c) => Object.values(c.deals).some((d) => d.status === 'accepted'),
    ),
  },
  {
    id: 'holdouts',
    title: 'And somebody will say no',
    focus: 'acquisition',
    body: [
      'You have three ways past a refusal, and all of them cost.',
      'Pay more, and every remaining holdout hears what you paid. Condemn, and you spend quarters in court, county goodwill, and the patience of everyone left on the line. Or reroute, and start the acquisition again somewhere longer.',
      'Settle every parcel. There is no fourth option.',
    ],
    isComplete: (s) => s.corridors.some(acquisitionComplete),
  },
  {
    id: 'hearing',
    title: 'Sumter County has questions',
    focus: 'none',
    body: [
      'The county commission has called a hearing. What you decide here about who pays for the network upgrades will follow you.',
    ],
    isComplete: (s) => s.tutorial?.hearingResolved ?? false,
  },
  {
    id: 'energize',
    title: 'Energize',
    focus: 'operations',
    body: [
      'Generation online, line built, right-of-way bought. End quarters until the power flows.',
      'When it does, the game stops being about deadlines.',
    ],
    isComplete: (s) => s.energizedQuarter !== null,
  },
  {
    id: 'operate',
    title: 'Now keep it on',
    focus: 'operations',
    body: [
      'Fifteen minutes an interval. The campus draws flat; the county peaks on summer evenings, which is exactly when your turbines are derated by the heat.',
      'Run the clock. Watch what it costs you an hour to keep the gap at zero.',
    ],
    isComplete: (s) => (s.realtime?.tick ?? 0) > 40,
  },
  {
    id: 'storm',
    title: 'The night it matters',
    focus: 'operations',
    body: [
      'A line of storms is crossing the service area.',
      'What happens next was decided the day you chose a voltage class.',
    ],
    isComplete: (s) => (s.tutorial?.stormFired ?? false)
      && (s.realtime?.outages.every((o) => o.kind !== 'corridor') ?? false),
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

/**
 * The beat the player is actually on.
 *
 * Recomputes rather than trusting the stored index, because plenty of actions
 * complete a beat without going through end-of-quarter — signing the contract,
 * siting a plant, committing a route. A coach that only refreshes on the turn
 * boundary spends most of the tutorial telling the player to do something they
 * have already done.
 */
export function currentBeat(state: GameState): TutorialBeat | null {
  const t = state.tutorial
  if (!t || t.dismissed) return null
  let i = t.beat
  while (i < BEATS.length && BEATS[i].isComplete(state)) i += 1
  return i < BEATS.length ? BEATS[i] : null
}

export function tutorialFinished(state: GameState): boolean {
  return (state.tutorial?.beat ?? 0) >= BEATS.length
}

// --- the hearing ---------------------------------------------------------

/**
 * Who pays for the network upgrades.
 *
 * This is the sharpest lever in the game and the cheapest one to pull badly:
 * assigning the cost to ratepayers is nearly free for the player's budget and
 * radioactive for everyone who lives there. It is also, in outline, a real fight
 * currently happening in front of the Georgia PSC.
 */
export interface HearingOption {
  id: string
  label: string
  detail: string
  /** Dollars the player absorbs. */
  cost: number
  /** Approval change in the scenario county. */
  approvalDelta: number
  /** Long-term memory: shown in the scorecard and carried into the campaign. */
  grievance: string | null
  /** How much of the shared cost was pushed onto ratepayers, 0–1. */
  ratepayerShare: number
}

export const HEARING_OPTIONS: readonly HearingOption[] = [
  {
    id: 'hyperscaler-pays',
    label: 'The data centre pays for all of it',
    detail:
      'You absorb the negotiation and Liberty covers the network upgrades. It costs you now, and nobody in Sumter County pays a cent for a line they did not ask for.',
    cost: 62_000_000,
    approvalDelta: 14,
    grievance: null,
    ratepayerShare: 0,
  },
  {
    id: 'split',
    label: 'Split it down the middle',
    detail:
      'Half to the customer, half spread across the rate base. Defensible, unremarkable, and nobody leaves happy.',
    cost: 31_000_000,
    approvalDelta: -4,
    grievance: 'Half the upgrade cost went to the rate base',
    ratepayerShare: 0.5,
  },
  {
    id: 'ratepayers-pay',
    label: 'Spread it across the rate base',
    detail:
      'The cheapest line on your budget. Every household in the state picks up a share of a line built for one customer, and the commission hearing will be on the news.',
    cost: 0,
    approvalDelta: -22,
    grievance: 'The county paid for a line built for somebody else',
    ratepayerShare: 1,
  },
]
