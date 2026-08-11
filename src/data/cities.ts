/**
 * Georgia population centres, used to derive the population-density and
 * land-value fields on the hex cost surface.
 *
 * DATA STATUS: coordinates and populations here are hand-authored approximations
 * entered from general knowledge, not yet reconciled against Census figures.
 * They are accurate enough to shape a cost surface (which is what they are for)
 * but every record carries `verified: false` until the M6 accuracy pass checks it
 * against a citable source. `scripts/verify-data.ts` reports the unverified count.
 *
 * The southwest Georgia entries matter most — they sit under the Americus
 * scenario and drive its routing costs — so they are listed at finer grain than
 * the rest of the state.
 */

export interface City {
  name: string
  /** Degrees, WGS84. */
  lon: number
  lat: number
  /** Approximate population of the incorporated place. */
  population: number
  /** County FIPS this place sits in. */
  countyFips: string
  /** True once checked against a citable source during the M6 pass. */
  verified: boolean
}

export const CITIES: readonly City[] = [
  // --- Metro Atlanta and north Georgia ---
  { name: 'Atlanta', lon: -84.388, lat: 33.749, population: 499_000, countyFips: '13121', verified: false },
  { name: 'Sandy Springs', lon: -84.378, lat: 33.924, population: 108_000, countyFips: '13121', verified: false },
  { name: 'Roswell', lon: -84.362, lat: 34.023, population: 92_000, countyFips: '13121', verified: false },
  { name: 'Marietta', lon: -84.550, lat: 33.953, population: 61_000, countyFips: '13067', verified: false },
  { name: 'Lawrenceville', lon: -83.988, lat: 33.956, population: 31_000, countyFips: '13135', verified: false },
  { name: 'Douglasville', lon: -84.748, lat: 33.752, population: 34_000, countyFips: '13097', verified: false },
  { name: 'Newnan', lon: -84.800, lat: 33.381, population: 42_000, countyFips: '13077', verified: false },
  { name: 'Carrollton', lon: -85.077, lat: 33.580, population: 27_000, countyFips: '13045', verified: false },
  { name: 'Griffin', lon: -84.264, lat: 33.247, population: 23_000, countyFips: '13255', verified: false },
  { name: 'Covington', lon: -83.860, lat: 33.597, population: 14_000, countyFips: '13217', verified: false },
  { name: 'Athens', lon: -83.378, lat: 33.951, population: 127_000, countyFips: '13059', verified: false },
  { name: 'Gainesville', lon: -83.825, lat: 34.298, population: 45_000, countyFips: '13139', verified: false },
  { name: 'Rome', lon: -85.165, lat: 34.257, population: 37_000, countyFips: '13115', verified: false },
  { name: 'Dalton', lon: -84.970, lat: 34.769, population: 34_000, countyFips: '13313', verified: false },
  { name: 'Cartersville', lon: -84.800, lat: 34.165, population: 23_000, countyFips: '13015', verified: false },
  { name: 'LaGrange', lon: -85.031, lat: 33.039, population: 31_000, countyFips: '13285', verified: false },

  // --- Fall Line cities ---
  { name: 'Columbus', lon: -84.988, lat: 32.461, population: 206_000, countyFips: '13215', verified: false },
  { name: 'Macon', lon: -83.632, lat: 32.841, population: 157_000, countyFips: '13021', verified: false },
  { name: 'Augusta', lon: -82.010, lat: 33.471, population: 202_000, countyFips: '13245', verified: false },
  { name: 'Milledgeville', lon: -83.233, lat: 33.080, population: 17_000, countyFips: '13009', verified: false },
  { name: 'Warner Robins', lon: -83.624, lat: 32.617, population: 82_000, countyFips: '13153', verified: false },
  { name: 'Perry', lon: -83.732, lat: 32.458, population: 22_000, countyFips: '13153', verified: false },

  // --- Southwest Georgia: the Americus scenario's neighbourhood ---
  { name: 'Americus', lon: -84.233, lat: 32.072, population: 16_000, countyFips: '13261', verified: false },
  { name: 'Plains', lon: -84.394, lat: 32.034, population: 550, countyFips: '13261', verified: false },
  { name: 'Andersonville', lon: -84.143, lat: 32.196, population: 240, countyFips: '13261', verified: false },
  { name: 'Leslie', lon: -84.084, lat: 31.954, population: 400, countyFips: '13261', verified: false },
  { name: 'Ellaville', lon: -84.310, lat: 32.235, population: 1_600, countyFips: '13249', verified: false },
  { name: 'Buena Vista', lon: -84.517, lat: 32.319, population: 1_800, countyFips: '13197', verified: false },
  { name: 'Preston', lon: -84.535, lat: 32.064, population: 450, countyFips: '13307', verified: false },
  { name: 'Richland', lon: -84.669, lat: 32.088, population: 1_400, countyFips: '13271', verified: false },
  { name: 'Dawson', lon: -84.446, lat: 31.774, population: 4_200, countyFips: '13273', verified: false },
  { name: 'Leesburg', lon: -84.173, lat: 31.733, population: 3_400, countyFips: '13177', verified: false },
  { name: 'Albany', lon: -84.156, lat: 31.578, population: 68_000, countyFips: '13095', verified: false },
  { name: 'Cordele', lon: -83.782, lat: 31.963, population: 10_000, countyFips: '13081', verified: false },
  { name: 'Vienna', lon: -83.795, lat: 32.091, population: 2_800, countyFips: '13093', verified: false },
  { name: 'Montezuma', lon: -84.027, lat: 32.305, population: 3_300, countyFips: '13193', verified: false },
  { name: 'Oglethorpe', lon: -84.063, lat: 32.296, population: 1_100, countyFips: '13193', verified: false },
  { name: 'Blakely', lon: -84.934, lat: 31.377, population: 5_000, countyFips: '13099', verified: false },
  { name: 'Cuthbert', lon: -84.790, lat: 31.771, population: 3_400, countyFips: '13243', verified: false },
  { name: 'Bainbridge', lon: -84.575, lat: 30.904, population: 14_000, countyFips: '13087', verified: false },
  { name: 'Moultrie', lon: -83.769, lat: 31.180, population: 14_000, countyFips: '13071', verified: false },
  { name: 'Tifton', lon: -83.509, lat: 31.450, population: 17_000, countyFips: '13277', verified: false },
  { name: 'Thomasville', lon: -83.979, lat: 30.837, population: 18_000, countyFips: '13275', verified: false },

  // --- South and coastal Georgia ---
  { name: 'Valdosta', lon: -83.279, lat: 30.833, population: 55_000, countyFips: '13185', verified: false },
  { name: 'Douglas', lon: -82.850, lat: 31.509, population: 11_000, countyFips: '13069', verified: false },
  { name: 'Waycross', lon: -82.354, lat: 31.214, population: 13_000, countyFips: '13299', verified: false },
  { name: 'Brunswick', lon: -81.491, lat: 31.150, population: 16_000, countyFips: '13127', verified: false },
  { name: 'Savannah', lon: -81.094, lat: 32.081, population: 148_000, countyFips: '13051', verified: false },
  { name: 'Statesboro', lon: -81.784, lat: 32.449, population: 33_000, countyFips: '13031', verified: false },
  { name: 'Dublin', lon: -82.904, lat: 32.540, population: 16_000, countyFips: '13283', verified: false },
  { name: 'Vidalia', lon: -82.413, lat: 32.218, population: 11_000, countyFips: '13279', verified: false },
]
