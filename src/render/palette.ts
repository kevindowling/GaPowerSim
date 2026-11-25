import type { ParcelArchetype } from '../engine/parcels/types.ts'
import type { LandKind } from '../engine/geo/basemapTypes.ts'

export const PALETTE = {
  outside: '#cfd9d8',
  sea: '#a9c7d6',
  neighbor: '#e4e3da',
  neighborLine: '#9aa39c',
  ink: '#16241f',
  inkSoft: '#4c5b55',
  halo: 'rgba(247,249,245,0.92)',

  water: '#8fb9cf',
  waterDeep: '#6fa3bd',
  waterInk: '#2c6079',
  wetland: '#a8c6b4',
  park: '#8db38a',
  parkInk: '#33603c',

  roadCase: 'rgba(120,112,96,0.55)',
  road: ['#f3c98b', '#f7dfae', '#fbf6e6', '#ffffff', '#e8e0cd'] as readonly string[],
  rail: '#6d6a6f',
  building: '#8b7d6f',
  church: '#7b4f74',
  powerExisting: '#5a5377',

  // Indexed by the TERRAIN enum in build-hexgrid.ts.
  terrain: [
    '#cfd9d8', // outside Georgia
    '#dde3c3', // coastal plain
    '#e2d9bd', // piedmont
    '#b4cba8', // blue ridge
    '#ccd8b4', // valley and ridge
    '#bfceab', // appalachian plateau
    '#c2dac8', // coastal marsh
  ] as readonly string[],

  countyLine: '#8a9690',
  hexLine: 'rgba(60,80,70,0.28)',

  corridor: '#b4502b',
  energized: '#f0b000',
  plant: '#b4502b',
  substation: '#1f5f7a',
  dataCenter: '#5a3f8c',
  fault: '#c2271d',
  ok: '#2f7a4d',
  warn: '#c77700',
  select: '#1f6f8b',
} as const

/** Field colours. Two or three shades each, picked per parcel. */
export const PARCEL_LAND: Record<ParcelArchetype, readonly string[]> = {
  'row-crop': ['#e3dc9c', '#d6d88f', '#c9d394', '#e8d9a6', '#d2c98a'],
  timber: ['#9dbb8e', '#8fb083', '#a9c29a'],
  homestead: ['#e7e2cf', '#e2ddc8'],
  church: ['#e2cfdd'],
  industrial: ['#cfcdd3'],
  public: ['#c3d9bd'],
  historic: ['#d7bf9a'],
}

export const LAND_FILL: Record<LandKind, string> = {
  wood: 'rgba(116,155,104,0.55)',
  farm: 'rgba(222,213,140,0.45)',
  orchard: 'rgba(150,178,96,0.55)',
  town: 'rgba(214,203,190,0.6)',
  industry: 'rgba(183,180,190,0.6)',
  cemetery: 'rgba(160,188,150,0.8)',
}
