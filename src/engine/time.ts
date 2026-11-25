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
