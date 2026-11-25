import type { Rng } from '../../src/engine/rng.ts'
import type { ParcelArchetype } from '../../src/engine/parcels/types.ts'

/** Land-use code fragments that reliably indicate a category. */
const USE_HINTS: Array<[RegExp, ParcelArchetype]> = [
  [/church|relig|worship|cemet|burial/i, 'church'],
  [/histor|landmark|monument|memorial/i, 'historic'],
  [/indus|manufact|warehouse|utility|substat/i, 'industrial'],
  [/public|county|state|federal|school|park|wma/i, 'public'],
  [/timber|forest|silvic|pulpwood/i, 'timber'],
  [/agri|farm|crop|pasture|orchard|pecan/i, 'row-crop'],
  [/resid|dwell|home|house|sfr/i, 'homestead'],
]

export function classifyParcel({
  acres, landUse, rng,
}: {
  acres: number
  landUse: string | null
  rng: Rng
}): ParcelArchetype {
  // A recorded land-use code is the best signal available; trust it first.
  if (landUse) {
    for (const [pattern, archetype] of USE_HINTS) {
      if (pattern.test(landUse)) return archetype
    }
  }

  // Otherwise infer from size, which in rural Georgia is a decent proxy.
  if (acres < 3) {
    // A small lot is a house, or occasionally the church on the corner.
    return rng.chance(0.045) ? 'church' : 'homestead'
  }
  if (acres < 40) {
    return rng.chance(0.55) ? 'homestead' : 'row-crop'
  }
  if (acres < 300) {
    return rng.chance(0.72) ? 'row-crop' : 'timber'
  }
  // Large tracts in this part of the state are usually planted pine.
  return rng.chance(0.7) ? 'timber' : 'row-crop'
}
