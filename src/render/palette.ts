/**
 * Flat-illustration palette.
 *
 * Georgia's own colours: red clay in the Piedmont, sand and pine in the Coastal
 * Plain, blue-green in the mountains, warm paper underneath everything. Land
 * tones are deliberately low-saturation so that the things the player acts on —
 * corridors, plants, faults, contested parcels — are the only saturated marks on
 * the map and read instantly against it.
 */

export const PALETTE = {
  paper: '#F2EFE6',
  paperDeep: '#E7E2D4',
  ink: '#33322C',
  inkSoft: '#6E6A5E',
  inkFaint: '#A39D8D',

  water: '#A9C9D8',
  waterDeep: '#8FB6C9',

  // Roads are context, not a decision surface, so they stay desaturated —
  // and readable over both the land tones and aerial photography.
  wetland: '#9FB59A',
  roadMajor: '#8C7F63',
  roadMinor: '#A79C84',

  // Physiographic provinces, indexed by the TERRAIN enum in build-hexgrid.ts.
  terrain: [
    '#F2EFE6', // 0 outside Georgia
    '#E6E1CB', // 1 coastal plain — sand and pine
    '#DFC9B4', // 2 piedmont — red clay
    '#A9BFA3', // 3 blue ridge
    '#C4CDB0', // 4 valley and ridge
    '#B7C2A8', // 5 appalachian plateau
    '#BFD3C2', // 6 coastal marsh
  ] as readonly string[],

  countyLine: '#B3AB98',
  countyLineStrong: '#8A8371',
  stateLine: '#5A5648',

  // Action colours
  corridor: '#E8A33D',
  corridorDim: '#C98F3B',
  energized: '#F2B441',
  plant: '#C2603F',
  substation: '#7C6BA8',
  dataCenter: '#6E5B9E',
  fault: '#C6483C',
  ok: '#5E8C6A',
  warn: '#D98A2B',
  select: '#2F6F7A',
  contested: '#B5455E',
} as const
