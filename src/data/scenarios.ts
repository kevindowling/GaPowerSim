/**
 * Scenario definitions.
 *
 * DATA STATUS — read this before adding a real project. Georgia genuinely has a
 * very large announced data center pipeline, and the campaign is meant to run on
 * those real projects. But we have not yet verified whether a specific project
 * exists at Americus, so the tutorial scenario is labelled `basedOn:
 * 'projection'` and uses a **fictional developer name**. Attaching a real
 * company's name to a project we cannot confirm they announced would be putting
 * a false claim about a real company into a public game.
 *
 * The M6 accuracy pass replaces projections with verified projects — real
 * developer, real county, real megawatts, real source URL — and flips `basedOn`
 * to 'announced'. Anything still marked 'projection' is surfaced to the player
 * in-game as a scenario rather than a filing.
 */

import { quarterOf, type QuarterIndex } from '../engine/time.ts'

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
 * Scenario 1 — Americus, Sumter County.
 *
 * Rural southwest Georgia: about 16,000 people in Americus, farmland in every
 * direction, Plains and Andersonville a short drive away. 400 MW of firm,
 * round-the-clock load dropped into a county that has never seen anything like
 * it, on a deadline that does not care how anyone feels about it.
 */
export const AMERICUS: Scenario = {
  id: 'americus-400',
  title: 'Americus',
  order: 1,
  subtitle: 'Sumter County · 400 MW',
  basedOn: 'projection',
  sourceUrl: null,
  briefing: [
    'A hyperscaler wants 400 megawatts outside Americus, drawing around the clock from the day it opens.',
    'They will front the capital. In exchange they want the power live by the end of 2029, and they have written a penalty into every quarter you are late.',
    'Sumter County has about sixteen thousand people in it. Nobody there has been asked about this yet.',
  ],
  startQuarter: quarterOf(2026, 1),
  seed: 13261_2026,

  contract: {
    name: 'Sumter Campus',
    // Fictional. See the DATA STATUS note at the top of this file.
    developer: 'Ridgeline Compute',
    countyFips: '13261',
    // A few kilometres north-east of Americus, off the US-19 corridor.
    site: { lon: -84.187, lat: 32.113 },
    contractedMw: 400,
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
