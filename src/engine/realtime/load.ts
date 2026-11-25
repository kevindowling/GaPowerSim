import { TICKS_PER_DAY, TICKS_PER_HOUR } from './types.ts'

/** Hour of day, 0–24, from a tick count. */
export function hourOfDay(tick: number): number {
  return (tick % TICKS_PER_DAY) / TICKS_PER_HOUR
}

/** Day of year, 0–365, assuming operations begin on 1 January. */
export function dayOfYear(tick: number): number {
  return Math.floor(tick / TICKS_PER_DAY) % 365
}

export function customerShape(tick: number): number {
  const h = hourOfDay(tick)
  const d = dayOfYear(tick)

  // Daily shape: overnight trough, morning shoulder, evening peak.
  const morning = 0.22 * Math.exp(-(((h - 7.5) / 2.2) ** 2))
  const evening = 0.42 * Math.exp(-(((h - 18.5) / 3.0) ** 2))
  const base = 0.72
  const daily = base + morning + evening

  // Seasonal: cooling load dominates, with a smaller winter heating bump.
  const summer = 0.40 * Math.exp(-(((d - 200) / 45) ** 2))
  const winter = 0.16 * Math.exp(-(((d - 15) / 35) ** 2))
    + 0.16 * Math.exp(-(((d - 350) / 35) ** 2))

  return daily * (1 + summer + winter)
}

export function ambientC(tick: number): number {
  const d = dayOfYear(tick)
  const h = hourOfDay(tick)
  const seasonal = 17.5 - 10.5 * Math.cos((2 * Math.PI * (d - 15)) / 365)
  const daily = 5.5 * Math.sin((2 * Math.PI * (h - 9)) / 24)
  return seasonal + daily
}

export function solarFraction(tick: number): number {
  const h = hourOfDay(tick)
  const d = dayOfYear(tick)
  // Longer days in summer.
  const halfDay = 5.6 + 1.2 * Math.cos((2 * Math.PI * (d - 172)) / 365) * -1
  if (h < 12 - halfDay || h > 12 + halfDay) return 0
  const arc = Math.cos((Math.PI * (h - 12)) / (2 * halfDay))
  // Peak clear-sky output is well under nameplate after inverter and angle losses.
  return Math.max(0, arc) * 0.86
}

export interface LoadSlice {
  contractMw: number
  customerMw: number
  totalMw: number
  ambientC: number
}

/** Days between one block of data halls coming on and the next. */
export const RAMP_DAYS_PER_PHASE = 45

export function rampFraction(tick: number, phases: number): number {
  if (phases <= 1) return 1
  const phase = Math.floor(tick / (RAMP_DAYS_PER_PHASE * TICKS_PER_DAY)) + 1
  return Math.min(1, phase / phases)
}

/** Demand for one interval. `heatC` is extra heat from a heat wave. */
export function loadAt(
  tick: number, contractedMw: number, customerAverageMw: number, ramp = 1, heatC = 0,
): LoadSlice {
  // Data centres run flat, with a little variation as workloads shift.
  const contractMw = contractedMw * ramp * (0.95 + 0.04 * Math.sin(tick / 37))
  const customerMw = customerAverageMw * customerShape(tick) * (1 + 0.035 * heatC)
  return {
    contractMw,
    customerMw,
    totalMw: contractMw + customerMw,
    ambientC: ambientC(tick) + heatC,
  }
}

export function customerLoadForPopulation(population: number): number {
  return (population * 1.4) / 1000
}
