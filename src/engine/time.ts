/**
 * Game time. The build phase advances one fiscal quarter per turn, which is the
 * grain real utility projects actually move at — permits, hearings and
 * construction milestones all land on quarter boundaries.
 *
 * A quarter is stored as a plain integer offset from 2026 Q1, so arithmetic on
 * deadlines is just subtraction.
 */

export const START_YEAR = 2026

/** 0 = 2026 Q1. */
export type QuarterIndex = number

export function quarterOf(year: number, quarter: 1 | 2 | 3 | 4): QuarterIndex {
  return (year - START_YEAR) * 4 + (quarter - 1)
}

export function yearOf(qi: QuarterIndex): number {
  return START_YEAR + Math.floor(qi / 4)
}

export function quarterInYear(qi: QuarterIndex): number {
  return (qi % 4) + 1
}

/** "2029 Q4" */
export function formatQuarter(qi: QuarterIndex): string {
  return `${yearOf(qi)} Q${quarterInYear(qi)}`
}

/** "3 years, 2 quarters" — for deadline pressure, where the shape matters. */
export function formatDuration(quarters: number): string {
  if (quarters <= 0) return 'overdue'
  const y = Math.floor(quarters / 4)
  const q = quarters % 4
  const parts: string[] = []
  if (y > 0) parts.push(`${y} year${y === 1 ? '' : 's'}`)
  if (q > 0) parts.push(`${q} quarter${q === 1 ? '' : 's'}`)
  return parts.join(', ')
}
