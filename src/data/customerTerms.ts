// DATA STATUS: what a data center pays is invented. The rate is inside the 7.5
// to 9 cents estimated from Georgia Power's large-load tariff, low confidence.

/** Dollars a developer pays in all, for each MW. */
export const ADVANCE_PER_MW = 900_000
/** $ per MWh. */
export const CUSTOMER_RATE = 90
/** Share of the contract billed even if it is not drawn. */
export const MINIMUM_SHARE = 0.8
/** Share of its contract a data center draws. */
export const DRAW = 0.95
/** Lenders add this to the credit limit for each MW signed. */
export const CREDIT_PER_MW = 700_000

/** Quarters from signing to the first phase's due date, and between phases. */
export const FIRST_DUE = 12
export const DUE_STEP = 2

/**
 * Georgia Power's own money at the start, and what lenders allow. Invented. Its
 * published plan is $52.4B for 2026 to 2030, for everything it does.
 */
export const STARTING_BUDGET = 1_000_000_000
export const STARTING_CREDIT = 2_000_000_000

/** Contracts open at the start, and quarters over which the rest come up. Invented. */
export const OFFERS_AT_START = 3
export const OFFER_SPAN = 16
/** Quarters a contract stays open. Invented. */
export const OFFER_OPEN: [number, number] = [5, 9]

/** Quarters late before a data center leaves. */
export const LATE_LIMIT = 9

/** $ per MW a quarter for spare power: $28.7 a kW-month, worked out from PSC staff testimony. */
export const SPARE_PER_MW_QUARTER = 28.7 * 1000 * 3
/** $ per MWh for the energy: Into Southern average for 2026, EIA. */
export const SPARE_ENERGY = 47
/** Most that can be bought beyond the pool, MW: winter import capability into the Southeast, NERC 2024. */
export const BUY_LIMIT_MW = 6_525

/** Last quarter of a game that carries on after the first data center's year. */
export const HORIZON_YEAR = 2034

/** Phases for a data center of a size. Invented. */
export function phasesFor(mw: number): { count: number; mwEach: number } {
  const count = mw <= 400 ? Math.max(1, Math.round(mw / 100)) : mw <= 1000 ? Math.max(2, Math.round(mw / 200)) : 5
  return { count, mwEach: mw / count }
}
