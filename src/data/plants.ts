/**
 * Generation technology catalogue.
 *
 * DATA STATUS: these are engineering-plausible figures for 2026 Georgia —
 * overnight capital cost, construction duration, heat rate, capacity factor,
 * forced-outage rate, land and water use — assembled from general knowledge of
 * the technologies rather than from a citable source per field. They are the
 * right order of magnitude and the relationships between them are sound, which
 * is what the game's decisions turn on. Every record is `verified: false` until
 * the M6 accuracy pass reconciles it against EIA and Georgia Power filings.
 *
 * The one number that matters most for the Americus tutorial is the gap between
 * nameplate capacity and firm capacity: a data center runs at ~85% load factor
 * around the clock, and solar's ~25% capacity factor cannot serve that no matter
 * how much of it you build. That lesson is encoded in `capacityFactor` and
 * `firmCapacityFraction`.
 */

export type PlantKind = 'gas-ct' | 'gas-ccgt' | 'solar' | 'battery' | 'nuclear-uprate'

export interface PlantType {
  id: PlantKind
  name: string
  blurb: string
  /** Nameplate capacity of one unit, MW. */
  nameplateMw: number
  /** Overnight capital cost, $/kW. */
  capexPerKw: number
  /** Quarters from notice-to-proceed to commercial operation. */
  buildQuarters: number
  /** Quarters of permitting before construction can start. */
  permitQuarters: number
  /** Expected annual energy as a fraction of nameplate. */
  capacityFactor: number
  /**
   * How much of nameplate counts toward serving firm load at peak. This is the
   * number that decides whether a portfolio can actually keep a data center up.
   */
  firmCapacityFraction: number
  /** Btu/kWh. Zero for non-thermal. */
  heatRate: number
  /** $/MWh of variable cost at expected fuel prices. */
  variableCostPerMwh: number
  /** Fixed O&M, $/kW-year. */
  fixedOmPerKwYear: number
  /** Probability the unit is unavailable at a random moment. */
  forcedOutageRate: number
  /** Mean quarters to repair a forced outage. */
  meanRepairQuarters: number
  /** Acres of land for one unit. */
  acres: number
  /** Consumptive water use, gallons per MWh. */
  waterGalPerMwh: number
  /** Tonnes CO2 per MWh. */
  co2TonnesPerMwh: number
  /** How much local opposition siting one of these tends to generate, 0–1. */
  communityFriction: number
  verified: boolean
}

export const PLANT_TYPES: readonly PlantType[] = [
  {
    id: 'gas-ct',
    name: 'Gas combustion turbine',
    blurb: 'Fast to build, quick to start, expensive to run. The unit you build when the deadline is the binding constraint.',
    nameplateMw: 200,
    capexPerKw: 1_150,
    buildQuarters: 8,
    permitQuarters: 3,
    capacityFactor: 0.15,
    firmCapacityFraction: 0.95,
    heatRate: 10_400,
    variableCostPerMwh: 62,
    fixedOmPerKwYear: 18,
    forcedOutageRate: 0.05,
    meanRepairQuarters: 1,
    acres: 40,
    waterGalPerMwh: 25,
    co2TonnesPerMwh: 0.55,
    communityFriction: 0.55,
    verified: false,
  },
  {
    id: 'gas-ccgt',
    name: 'Combined-cycle gas plant',
    blurb: 'The workhorse for round-the-clock load: efficient and cheap to run, but three and a half years to build and thirsty.',
    nameplateMw: 550,
    capexPerKw: 1_320,
    buildQuarters: 14,
    permitQuarters: 4,
    capacityFactor: 0.62,
    firmCapacityFraction: 0.94,
    heatRate: 6_400,
    variableCostPerMwh: 34,
    fixedOmPerKwYear: 27,
    forcedOutageRate: 0.04,
    meanRepairQuarters: 1,
    acres: 85,
    waterGalPerMwh: 210,
    co2TonnesPerMwh: 0.34,
    communityFriction: 0.7,
    verified: false,
  },
  {
    id: 'solar',
    name: 'Utility-scale solar',
    blurb: 'Cheap energy and an easy permit, but it produces when the sun decides. Seven acres per megawatt adds up fast.',
    nameplateMw: 200,
    capexPerKw: 1_250,
    buildQuarters: 6,
    permitQuarters: 2,
    capacityFactor: 0.25,
    // Solar contributes almost nothing to a 3am peak, which is exactly when a
    // data center is still drawing full load.
    firmCapacityFraction: 0.08,
    heatRate: 0,
    variableCostPerMwh: 0,
    fixedOmPerKwYear: 15,
    forcedOutageRate: 0.02,
    meanRepairQuarters: 1,
    acres: 1_400,
    waterGalPerMwh: 5,
    co2TonnesPerMwh: 0,
    communityFriction: 0.3,
    verified: false,
  },
  {
    id: 'battery',
    name: 'Battery storage (4-hour)',
    blurb: 'Shifts energy by hours, not days. Firms up solar until the fourth hour, then it is empty.',
    nameplateMw: 100,
    capexPerKw: 1_400,
    buildQuarters: 5,
    permitQuarters: 2,
    capacityFactor: 0.1,
    firmCapacityFraction: 0.6,
    heatRate: 0,
    variableCostPerMwh: 4,
    fixedOmPerKwYear: 12,
    forcedOutageRate: 0.03,
    meanRepairQuarters: 1,
    acres: 15,
    waterGalPerMwh: 0,
    co2TonnesPerMwh: 0,
    communityFriction: 0.25,
    verified: false,
  },
  {
    id: 'nuclear-uprate',
    name: 'Nuclear uprate',
    blurb: 'Squeeze more out of a reactor that already exists. Small, slow, expensive per megawatt — and utterly firm.',
    nameplateMw: 60,
    capexPerKw: 3_400,
    buildQuarters: 12,
    permitQuarters: 6,
    capacityFactor: 0.93,
    firmCapacityFraction: 0.97,
    heatRate: 10_400,
    variableCostPerMwh: 11,
    fixedOmPerKwYear: 120,
    forcedOutageRate: 0.02,
    meanRepairQuarters: 2,
    acres: 5,
    waterGalPerMwh: 400,
    co2TonnesPerMwh: 0,
    communityFriction: 0.5,
    verified: false,
  },
]

export function plantType(id: PlantKind): PlantType {
  const t = PLANT_TYPES.find((p) => p.id === id)
  if (!t) throw new Error(`unknown plant type: ${id}`)
  return t
}

/** Overnight capital cost of one unit, in dollars. */
export function unitCapex(t: PlantType): number {
  return t.capexPerKw * t.nameplateMw * 1000
}
