/**
 * Scenario definitions.
 *
 * `announced` scenarios describe reported projects and carry their sources.
 * `projection` scenarios use an invented developer.
 *
 * In Americus the developer, site, phases, investment, jobs, tax estimate and
 * permitting status are reported. The utility deal terms are invented: advance,
 * milestones, penalties, rates and dates. Liberty's $1-5B is its own campus
 * investment and is unrelated to `capexAdvance`.
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
  /** Phases of the data center, and the quarter each one's payment is due. Due dates are invented. */
  phasing: { count: number; mwEach: number; due: readonly QuarterIndex[] }

  startQuarter: QuarterIndex
  seed: number
  /** Guided steps and a scripted storm. */
  tutorial: boolean
  /** How far below zero cash may go. */
  creditLimit: number
  /** Area with street, stream and building detail: minLon, minLat, maxLon, maxLat. */
  studyArea: [number, number, number, number]
  system: {
    substationName: string
    site: ScenarioSite
    servedPopulation: number
    importLimitMw: number
    /** Existing 230/115 kV transformers. Invented. */
    transformerMw: number
    tieMw: number
  }
  /** Shown on the scorecard. */
  closing: string

  contract: {
    name: string
    developer: string
    countyFips: string
    site: ScenarioSite
    contractedMw: number
    inServiceQuarter: QuarterIndex
    capexAdvance: number
    takeOrPayMw: number
    energyRatePerMwh: number
    shortfallPenaltyPerMwh: number
  }

  /** Starting approval of the data center (its own county) and its neighbours. Invented. */
  countyBaselines: Record<string, number>
}

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
      label: 'Sumter County Citizens for Transparency, site map and petition',
      url: 'https://scc4t.com/map/',
    },
    {
      label: 'Eminent domain across 1,000 miles of Georgia grid expansion (Fortune, 26 Jul 2026)',
      url: 'https://fortune.com/2026/07/26/georgia-power-utility-company-eminent-domain-grid-expansion-data-center/',
    },
  ],
  phasing: { count: 4, mwEach: 100, due: [quarterOf(2029, 1), quarterOf(2029, 2), quarterOf(2029, 3), quarterOf(2029, 4)] },
  briefing: [
    'Liberty Data Centers has signed with the Sumter County Development Authority for a campus at 301 Brady Road, in the Frank Meyers Industrial Park on the south side of Americus. It will be built in four phases of about 100 megawatts and draw 400 megawatts around the clock.',
    'Liberty puts one to five billion dollars into the campus itself, and projects 150 jobs averaging eighty thousand dollars and about twenty million a year in local taxes.',
    'Sumter County has about sixteen thousand people in Americus. More than a hundred people came to a meeting in August to object, and a petition for a moratorium is circulating. No permit has been issued.',
  ],
  startQuarter: quarterOf(2026, 3),
  seed: 13261_2026,
  tutorial: true,
  creditLimit: 600_000_000,
  studyArea: [-84.60, 31.85, -83.85, 32.35],
  system: {
    // Mapped in OpenStreetMap as a 230/115 kV Georgia Power substation.
    substationName: 'North Americus Substation',
    site: { lon: -84.2117, lat: 32.0977 },
    servedPopulation: 42_000,
    importLimitMw: 150,
    transformerMw: 200,
    tieMw: 120,
  },
  closing: 'The campus keeps drawing 400 MW, every hour, from here on.',

  contract: {
    name: 'Liberty Americus Campus',
    developer: 'Liberty Data Centers',
    countyFips: '13261',
    // Centre of county parcel 64-17, 301 Brady Road.
    site: { lon: -84.20729, lat: 32.04854 },
    contractedMw: 400,
    inServiceQuarter: quarterOf(2029, 4),
    capexAdvance: 960_000_000,
    takeOrPayMw: 320,
    energyRatePerMwh: 74,
    shortfallPenaltyPerMwh: 8_000,
  },

  countyBaselines: {
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

export const DUBLIN: Scenario = {
  id: 'dublin-600',
  title: 'Dublin',
  order: 2,
  subtitle: 'Laurens County · 600 MW',
  basedOn: 'projection',
  sourceUrl: null,
  sources: [],
  phasing: { count: 3, mwEach: 200, due: [quarterOf(2029, 3), quarterOf(2029, 4), quarterOf(2030, 1)] },
  briefing: [
    'A cloud company wants 600 megawatts outside Dublin, in three phases. It picked the site for its price and its distance from Atlanta.',
    'Dublin is bigger than Americus and better connected. The homes here draw more, so an outage reaches more people.',
    'The customer wants power by early 2030. There is no guide this time and no scheduled storm.',
  ],
  startQuarter: quarterOf(2027, 1),
  seed: 13175_2027,
  tutorial: false,
  creditLimit: 800_000_000,
  studyArea: [-83.25, 32.25, -82.55, 32.80],
  system: {
    substationName: 'Dublin Primary Substation',
    site: { lon: -82.8946, lat: 32.5406 },
    servedPopulation: 88_000,
    importLimitMw: 230,
    transformerMw: 300,
    tieMw: 150,
  },
  closing: 'Laurens County has its campus, and the next developer has already called.',

  contract: {
    name: 'Oconee Compute Campus',
    developer: 'Fall Line Cloud',
    countyFips: '13175',
    site: { lon: -82.965, lat: 32.500 },
    contractedMw: 600,
    inServiceQuarter: quarterOf(2030, 1),
    capexAdvance: 1_180_000_000,
    takeOrPayMw: 480,
    energyRatePerMwh: 72,
    shortfallPenaltyPerMwh: 9_000,
  },

  countyBaselines: {
    '13175': 54, // Laurens
    '13167': 57, // Johnson
    '13283': 55, // Treutlen
    '13091': 52, // Dodge
    '13289': 56, // Twiggs
    '13319': 54, // Wilkinson
    '13023': 55, // Bleckley
  },
}

export const SCENARIOS: readonly Scenario[] = [AMERICUS, DUBLIN]

export function scenario(id: string): Scenario {
  const s = SCENARIOS.find((x) => x.id === id)
  if (!s) throw new Error(`unknown scenario: ${id}`)
  return s
}
