/**
 * Scenario definitions.
 *
 * DATA STATUS — read this before adding or editing a project.
 *
 * Americus is now a VERIFIED project (M6 pass). Liberty Data Centers has a
 * signed agreement with the Sumter County Development Authority for a four-phase
 * campus in the Frank Meyers Industrial Park, ~100 MW per phase to a maximum of
 * four phases — the 400 MW this scenario was built around. Sources are attached
 * to the scenario itself, not just to this comment, and the briefing card shows
 * them to the player.
 *
 * The rule that produced the earlier fictional developer still stands for
 * anything unverified: a scenario we cannot source stays `basedOn: 'projection'`
 * with an invented developer, because attaching a real company's name to a
 * project we cannot confirm they announced would put a false claim about a real
 * company into a public game.
 *
 * Separating fact from game construct, because the two sit side by side here:
 *
 *   REAL      developer, campus location, county, phase structure and MW,
 *             capital investment range, jobs and wages, tax estimate, the water
 *             and sewer restrictions, the permitting status.
 *   INVENTED  the utility-side deal terms — capexAdvance, milestone schedule,
 *             latePenaltyPerQuarter, takeOrPayMw, inServiceQuarter. No such
 *             contract between Georgia Power and Liberty is public, and these
 *             numbers exist to make a game work. They are not reporting.
 *
 * Note that Liberty's $1–5B is investment in *their own campus*; it is not money
 * handed to the utility. `capexAdvance` is the game's separate, invented
 * grid-side advance. Do not conflate them.
 */

import { quarterOf, type QuarterIndex } from '../engine/time.ts'

/** A citation the player can follow. Every `announced` scenario carries these. */
export interface Source {
  label: string
  url: string
}

export interface ScenarioSite {
  /** Degrees WGS84; resolved to a grid cell at game start. */
  lon: number
  lat: number
}

export interface Scenario {
  id: string
  title: string
  /** Where this sits in the campaign chain. */
  order: number
  subtitle: string
  /** Shown on the briefing card before the player accepts. */
  briefing: string[]
  /** Whether this reflects a verified announced project or a plausible projection. */
  basedOn: 'announced' | 'projection'
  sourceUrl: string | null
  /** Citations shown on the briefing card. Required when `basedOn` is 'announced'. */
  sources: readonly Source[]
  /**
   * How the real project is phased, when that is public. Descriptive only — the
   * contract still models one lump of contracted load, because the phases are a
   * fact about the campus rather than a mechanic we simulate yet.
   */
  phasing: { count: number; mwEach: number } | null

  startQuarter: QuarterIndex
  seed: number

  contract: {
    name: string
    developer: string
    countyFips: string
    site: ScenarioSite
    contractedMw: number
    inServiceQuarter: QuarterIndex
    capexAdvance: number
    latePenaltyPerQuarter: number
    takeOrPayMw: number
  }

  /** Starting approval by county FIPS; anything unlisted starts at 55. */
  countyBaselines: Record<string, number>
}

/**
 * Scenario 1 — Americus, Sumter County. A real, contested project.
 *
 * Rural southwest Georgia: about 16,000 people in Americus, farmland in every
 * direction, Plains and Andersonville a short drive away. Liberty Data Centers
 * signed an agreement with the Sumter County Development Authority effective
 * 1 July 2026 for a campus in the Frank Meyers Industrial Park, at the end of
 * Swett Avenue, on land the County conveyed to the Authority. Four phases at
 * roughly 100 MW each — 400 MW of firm, round-the-clock load dropped into a
 * county that has never seen anything like it.
 *
 * It is being fought. Over a hundred people filled the Lake Blackshear Regional
 * Library in August 2026; a moratorium petition is circulating so the county can
 * write an ordinance before permitting rather than after. As of that month no
 * permit had been issued. Water is the sharper local worry, not power — this is
 * farm country, and an open-loop cooling system drinks. Liberty is barred under
 * the agreement from drilling its own wells or running its own sewer, so it has
 * to ask the City of Americus for both.
 *
 * That is the game, and it is not a metaphor: the player is the utility on the
 * other side of that room.
 */
export const AMERICUS: Scenario = {
  id: 'americus-400',
  title: 'Americus',
  order: 1,
  subtitle: 'Sumter County · 400 MW',
  basedOn: 'announced',
  sourceUrl:
    'https://americustimesrecorder.com/2026/08/07/economic-development-authority-and-liberty-agreement-outlines-data-center-plan/',
  sources: [
    {
      label: 'Development Authority–Liberty agreement terms (Americus Times-Recorder, 7 Aug 2026)',
      url: 'https://americustimesrecorder.com/2026/08/07/economic-development-authority-and-liberty-agreement-outlines-data-center-plan/',
    },
    {
      label: 'Liberty shares Americus data center plans (Americus Times-Recorder, 5 Aug 2026)',
      url: 'https://americustimesrecorder.com/2026/08/05/liberty-shares-americus-data-center-plans/',
    },
    {
      label: 'Concerned citizens meeting and moratorium petition (Americus Times-Recorder, 5 Aug 2026)',
      url: 'https://americustimesrecorder.com/2026/08/05/libertys-data-center-plans-spur-concerned-citizens-meeting/',
    },
    {
      label: 'Sumter County Citizens 4 Truth — moratorium petition',
      url: 'https://scc4t.com',
    },
    {
      label: 'Eminent domain across 1,000 miles of Georgia grid expansion (Fortune, 26 Jul 2026)',
      url: 'https://fortune.com/2026/07/26/georgia-power-utility-company-eminent-domain-grid-expansion-data-center/',
    },
  ],
  phasing: { count: 4, mwEach: 100 },
  briefing: [
    'Liberty Data Centers has signed with the Sumter County Development Authority for a campus at the end of Swett Avenue, in the Frank Meyers Industrial Park outside Americus. Four phases, about 100 megawatts each. Built out, it draws 400 megawatts around the clock.',
    'Liberty puts one to five billion dollars into the campus itself, and promises 150 jobs at an average of eighty thousand dollars and about twenty million a year in city, county and school taxes. Getting the power there is your problem.',
    'Sumter County has about sixteen thousand people in Americus. They have already filled a library to object, and they are circulating a petition for a moratorium so an ordinance gets written before a permit does. No permit has been issued.',
  ],
  startQuarter: quarterOf(2026, 1),
  seed: 13261_2026,

  contract: {
    // Real: the developer and the campus. See the DATA STATUS note above for
    // which terms below are invented.
    name: 'Liberty Americus Campus',
    developer: 'Liberty Data Centers',
    countyFips: '13261',
    // Frank Meyers Industrial Park, off Swett Avenue. The park is the reported
    // site; this coordinate is our approximation of it, not a surveyed location.
    site: { lon: -84.187, lat: 32.113 },
    contractedMw: 400,
    // Invented deal terms from here down — no utility contract is public.
    inServiceQuarter: quarterOf(2029, 4),
    capexAdvance: 1_050_000_000,
    latePenaltyPerQuarter: 18_000_000,
    takeOrPayMw: 320,
  },

  countyBaselines: {
    // Rural counties start warmer than metro ones — a tax base this size is
    // genuinely welcome, right up until people see where the line goes.
    '13261': 62, // Sumter
    '13249': 58, // Schley
    '13193': 56, // Macon
    '13177': 57, // Lee
    '13081': 55, // Crisp
    '13093': 56, // Dooly
    '13273': 59, // Terrell
    '13307': 60, // Webster
    '13197': 58, // Marion
    '13271': 57, // Stewart
  },
}

export const SCENARIOS: readonly Scenario[] = [AMERICUS]

export function scenario(id: string): Scenario {
  const s = SCENARIOS.find((x) => x.id === id)
  if (!s) throw new Error(`unknown scenario: ${id}`)
  return s
}

/** Approval a county starts at when the scenario doesn't name it. */
export const DEFAULT_COUNTY_APPROVAL = 55
