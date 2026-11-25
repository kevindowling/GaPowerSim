// DATA STATUS: plausible 2026 figures, not yet checked against EIA or Georgia Power filings.

export type PlantKind = 'gas-ct' | 'gas-ccgt' | 'solar' | 'battery' | 'nuclear-uprate'

export interface PlantType {
  id: PlantKind
  name: string
  /** Used to number units: "Gas turbine 2". */
  shortName: string
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
    shortName: 'Gas turbine',
    name: 'Gas combustion turbine',
    blurb: 'Fastest firm capacity. High fuel cost.',
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
    shortName: 'Combined cycle',
    name: 'Combined-cycle gas plant',
    blurb: 'Half the fuel cost of a turbine. Takes nearly four years and needs water.',
    nameplateMw: 550,
    capexPerKw: 1_320,
    buildQuarters: 11,
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
    shortName: 'Solar farm',
    name: 'Utility-scale solar',
    blurb: 'Free energy by day. Needs about two square miles.',
    nameplateMw: 200,
    capexPerKw: 1_250,
    buildQuarters: 6,
    permitQuarters: 2,
    capacityFactor: 0.25,
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
    shortName: 'Battery',
    name: 'Battery storage (4-hour)',
    blurb: 'Four hours at full output, then it must recharge. Counts for at most 20% of the contract.',
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
    shortName: 'Uprate',
    name: 'Nuclear uprate',
    blurb: 'Added output at Plant Hatch or Plant Vogtle. Arrives through the local substation.',
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
