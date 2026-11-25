// DATA STATUS: sizes and prices come from 2025 utility cost guides filed with
// the California ISO, waiting time and failure rate from the sources below.
// Breakers are added to each price. Everything marked invented is a guess.

export interface EquipmentSource { label: string; url: string }

export const EQUIPMENT_SOURCES: readonly EquipmentSource[] = [
  {
    label: 'PG&E 2025 unit cost guide, transformer banks, breakers and reconductoring (California ISO)',
    url: 'https://stakeholdercenter.caiso.com/RecurringStakeholderProcesses/Participating-transmission-owner-per-unit-costs-2025',
  },
  {
    label: 'Power transformers averaged 128 weeks in Q2 2025, Wood Mackenzie (POWER, 2 Jan 2026)',
    url: 'https://powermag.com/transformers-in-2026-shortage-scramble-or-self-inflicted-crisis/',
  },
  {
    label: 'Major failures of 0.41% a year, from CIGRE surveys (Energies 19, 2026)',
    url: 'https://www.mdpi.com/1996-1073/19/13/3197',
  },
]

export type EquipmentId =
  | 'campus-115' | 'campus-230' | 'campus-500'
  | 'sub-230-115' | 'sub-500-230'
  | 'area-115' | 'area-230' | 'area-500'

export type EquipmentPlace = 'campus' | 'substation' | 'area'

export interface EquipmentType {
  id: EquipmentId
  place: EquipmentPlace
  name: string
  /** What it does, in numbers. */
  blurb: string
  mw: number
  cost: number
  /** Quarters from order to service. */
  quarters: number
  /** Megawatts added to what the region can send. */
  importMw?: number
  /** Can be bought from stock for more. */
  rush: boolean
}

/** 128 weeks. */
const LEAD = 10
/** A dealer's claim of 12 to 14 months, quoted in the POWER article. Unverified. */
export const RUSH_QUARTERS = 5
/** Invented. */
export const RUSH_PRICE = 1.5

/** Kilometres of existing line rebuilt in one upgrade. Invented. */
const UPGRADE_KM = 30
const KM_PER_MILE = 1.609

const M = 1_000_000

export const EQUIPMENT: readonly EquipmentType[] = [
  // Bank $8.5M, breaker $2.2M.
  { id: 'campus-115', place: 'campus', name: '115 kV transformer', blurb: 'Lets 115 kV lines serve the campus.', mw: 200, cost: 10.7 * M, quarters: LEAD, rush: true },
  // Bank $11M, breaker $2.4M. Priced as a 230/115 kV bank.
  { id: 'campus-230', place: 'campus', name: '230 kV transformer', blurb: 'Lets 230 kV lines serve the campus.', mw: 420, cost: 13.4 * M, quarters: LEAD, rush: true },
  // Three 375 MVA units $37M, breaker $6.7M. Priced as a 500/230 kV bank.
  { id: 'campus-500', place: 'campus', name: '500 kV transformer', blurb: 'Lets 500 kV lines serve the campus.', mw: 1125, cost: 43.7 * M, quarters: LEAD, rush: true },
  { id: 'sub-230-115', place: 'substation', name: '230/115 kV transformer', blurb: 'Passes more between the 230 kV and 115 kV sides.', mw: 420, cost: 15.6 * M, quarters: LEAD, rush: true },
  { id: 'sub-500-230', place: 'substation', name: '500/230 kV transformer', blurb: 'Lets 500 kV lines end here.', mw: 1125, cost: 46.1 * M, quarters: LEAD, rush: true },
  // $1.136M a mile. Megawatts and time are invented.
  { id: 'area-115', place: 'area', name: 'Rebuild 115 kV lines', blurb: 'New wire on existing towers. Doubles the room to spare.', mw: 90, cost: (1.136 * M / KM_PER_MILE) * UPGRADE_KM, quarters: 6, rush: false },
  // $2.148M a mile. Megawatts and time are invented.
  { id: 'area-230', place: 'area', name: 'Rebuild 230 kV lines', blurb: 'New wire on existing towers. Doubles the room to spare, and the region can send 150 MW more.', mw: 240, importMw: 150, cost: (2.148 * M / KM_PER_MILE) * UPGRADE_KM, quarters: 6, rush: false },
  // The bank is 1,125 MVA. What it adds is held to 750 MW by the lines, which is invented.
  { id: 'area-500', place: 'area', name: 'Add a 500/230 kV transformer nearby', blurb: 'Lets more power off the 500 kV lines.', mw: 750, cost: 46.1 * M, quarters: LEAD, rush: true },
]

export function equipmentType(id: EquipmentId): EquipmentType {
  const t = EQUIPMENT.find((e) => e.id === id)
  if (!t) throw new Error(`unknown equipment: ${id}`)
  return t
}

/** Major failures of one transformer a year. */
export const MAJOR_FAILURES_PER_YEAR = 0.0041
/** Days to replace one. Invented. */
export const REPLACE_DAYS = 120
/** Short trips of one transformer a year. Invented. */
export const TRIPS_PER_YEAR = 0.2
