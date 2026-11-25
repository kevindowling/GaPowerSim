import type { PlantKind } from './plants.ts'

// DATA STATUS: pounds per MWh worked out from Georgia permits for new units,
// gallons per MWh from Macknick et al. 2012. Null where no figure was found.

export interface Emissions {
  nox: number
  pm25: number
  so2: number
  co2: number
  /** Water used up, gallons per MWh. */
  water: number | null
}

const NONE: Emissions = { nox: 0, pm25: 0, so2: 0, co2: 0, water: 0 }

export const EMISSIONS: Record<PlantKind, Emissions> = {
  'gas-ct': { nox: 0.081, pm25: 0.053, so2: 0.01, co2: 1024, water: 0 },
  'gas-ccgt': { nox: 0.069, pm25: 0.038, so2: 0.012, co2: 830, water: 205 },
  solar: { ...NONE, water: 1 },
  battery: { ...NONE, water: null },
  'nuclear-uprate': { ...NONE, water: 672 },
}

/** Annual fine particle limit, µg/m³, and eight-hour ozone limit, ppb. */
export const PM25_LIMIT = 9
export const OZONE_LIMIT = 70

/** River a region's plants draw on, and its lowest week in ten years, cubic feet a second. */
export const LOW_FLOW: Record<string, { river: string; cfs: number; note?: string }> = {
  '13261': { river: 'Flint River at Montezuma', cfs: 500 },
  '13175': { river: 'Oconee River at Dublin', cfs: 397, note: 'Other estimates reach 594.' },
}

export const ENV_SOURCES = [
  { label: 'EPA design values 2023-2025 (monitors)', url: 'https://www.epa.gov/system/files/documents/2026-06/pm25_designvalues_2023_2025_final_06_12_26.xlsx' },
  { label: 'EPA modeled air quality 2022 (counties without monitors)', url: 'https://www.epa.gov/hesc/rsig-related-downloadable-data-files' },
  { label: 'EPA ATTAINS, Georgia 2026 water assessment', url: 'https://gispub.epa.gov/arcgis/rest/services/OW/ATTAINS_Assessment/MapServer' },
  { label: 'Plant Yates air permit, Georgia EPD', url: 'https://epd.georgia.gov/document/document/tv-802465-final/download' },
  { label: 'Georgia EPD ozone and particle screening guidance', url: 'https://epd.georgia.gov/document/document/gaepdmerpsguidance02-25-19pdf/download' },
  { label: 'Water use of power plants, Macknick and others 2012', url: 'https://openei.org/datasets/files/969/pub/1748-9326_7_4_045802.pdf' },
  { label: 'Georgia low flows, USGS', url: 'https://doi.org/10.3133/sir20165037' },
] as const
