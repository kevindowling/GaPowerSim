/**
 * What the grid is being asked to deliver, interval by interval.
 *
 * Two very different customers share one wire, and the difference between them
 * is the whole reason this game has a moral centre:
 *
 *   - A data centre is flat. It draws almost the same power at four in the
 *     morning in February as it does at five on an August afternoon. It does not
 *     care that it is the peak. It is simply always there.
 *   - Homes and businesses are peaky and seasonal. In south Georgia the peak is
 *     air conditioning on a summer evening, which is exactly when thermal plants
 *     are derated and the margin is thinnest.
 *
 * Stack the first on top of the second and the peak gets worse in a way that
 * average-demand figures hide completely.
 */

import { TICKS_PER_DAY, TICKS_PER_HOUR } from './types.ts'

/** Hour of day, 0–24, from a tick count. */
export function hourOfDay(tick: number): number {
  return (tick % TICKS_PER_DAY) / TICKS_PER_HOUR
}

/** Day of year, 0–365, assuming operations begin on 1 January. */
export function dayOfYear(tick: number): number {
  return Math.floor(tick / TICKS_PER_DAY) % 365
}

/**
 * Residential and commercial demand shape, as a multiple of average.
 *
 * Two daily peaks — a small one in the morning, a large one in the early
 * evening — over a seasonal curve that peaks hard in summer. South Georgia is
 * summer-peaking and it is not close.
 */
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

/**
 * Ambient temperature, °C — drives both cooling demand and thermal derating.
 * A rough sinusoid on the year with a daily swing; good enough to make August
 * afternoons the hard part, which is the point.
 */
export function ambientC(tick: number): number {
  const d = dayOfYear(tick)
  const h = hourOfDay(tick)
  const seasonal = 17.5 - 10.5 * Math.cos((2 * Math.PI * (d - 15)) / 365)
  const daily = 5.5 * Math.sin((2 * Math.PI * (h - 9)) / 24)
  return seasonal + daily
}

/**
 * Solar output as a fraction of nameplate.
 * Zero at night, peaking near solar noon, higher in summer.
 */
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

/**
 * Demand for one interval.
 *
 * `rampFraction` lets a campus phase in rather than appearing at full load: a
 * hyperscaler energises hall by hall over a year or two.
 */
export function loadAt(
  tick: number, contractedMw: number, customerAverageMw: number, rampFraction = 1,
): LoadSlice {
  // Data centres run flat, with a little variation as workloads shift.
  const contractMw = contractedMw * rampFraction * (0.94 + 0.05 * Math.sin(tick / 37))
  const customerMw = customerAverageMw * customerShape(tick)
  return {
    contractMw,
    customerMw,
    totalMw: contractMw + customerMw,
    ambientC: ambientC(tick),
  }
}

/**
 * Average non-data-centre demand for a population.
 *
 * About 1.4 kW per person, averaged across residential, commercial and light
 * industrial — the right order of magnitude for a rural Georgia county.
 */
export function customerLoadForPopulation(population: number): number {
  return (population * 1.4) / 1000
}
