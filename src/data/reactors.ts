/** Existing reactors that could take an uprate. Coordinates approximate. */
export const REACTOR_SITES = [
  { name: 'Plant Hatch', lon: -82.344, lat: 31.934 },
  { name: 'Plant Vogtle', lon: -81.765, lat: 33.142 },
] as const

/** How close a click has to be to count as that plant. */
export const REACTOR_SNAP_KM = 12
