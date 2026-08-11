/**
 * Owner names.
 *
 * FICTIONAL BY DESIGN. These are drawn from ordinary southwest Georgia surname
 * and place-name patterns so the map reads as a real place, but they are not,
 * and must never be, the real owners of the parcels they are attached to. See
 * the privacy note in types.ts.
 *
 * Names are derived from the parcel id rather than stored, so they are stable
 * across sessions and across a re-fetch of the underlying geometry, without
 * putting a five-figure cadastre's worth of invented names in the shipped file.
 */

import { Rng, deriveSeed } from '../rng.ts'
import type { ParcelArchetype } from './types.ts'

const SURNAMES = [
  'Hollis', 'Braswell', 'Kinchen', 'Ledbetter', 'Marchant', 'Pou', 'Rylander',
  'Stapleton', 'Tondee', 'Vinson', 'Whatley', 'Yeomans', 'Bagley', 'Cheek',
  'Dozier', 'Ellerbee', 'Fussell', 'Gatewood', 'Hardegree', 'Ivey', 'Jelks',
  'Kersey', 'Lunsford', 'Meacham', 'Nesmith', 'Oglesby', 'Peavy', 'Quarles',
  'Roquemore', 'Studstill', 'Threlkeld', 'Upshaw', 'Waddell', 'Youmans',
]

// Named for real watercourses and landforms in this part of Georgia, which is
// how timber companies here are usually named.
const TIMBER_PREFIX = [
  'Flint River', 'Muckalee', 'Kinchafoonee', 'Chokee', 'Pennahatchee',
  'Deep Creek', 'Sandhill', 'Longleaf', 'Piney Woods', 'Cedar Bend',
]
const TIMBER_SUFFIX = ['Timber LLC', 'Timberlands', 'Forestry LP', 'Land Company', 'Pine Holdings LLC']
const FARM_SUFFIX = ['Farms', 'Farms LLC', 'Planting Co.', 'Pecan Co.', 'Land & Cattle']
const CHURCH_FIRST = [
  'Mount Zion', 'Bethel', 'New Hope', 'Shiloh', 'Friendship', 'Antioch',
  'Pleasant Grove', 'Salem', 'Macedonia', 'Providence',
]
const CHURCH_KIND = [
  'Baptist Church', 'A.M.E. Church', 'Methodist Church',
  'Missionary Baptist Church', 'Baptist Church and Cemetery',
]
const INDUSTRIAL_SUFFIX = ['Industries', 'Supply Co.', 'Cotton Gin', 'Warehousing', 'Ag Services']

export function synthesizeOwnerFor(archetype: ParcelArchetype, rng: Rng): string {
  switch (archetype) {
    case 'timber':
      return `${rng.pick(TIMBER_PREFIX)} ${rng.pick(TIMBER_SUFFIX)}`
    case 'row-crop':
      return `${rng.pick(SURNAMES)} ${rng.pick(FARM_SUFFIX)}`
    case 'homestead':
      // A household, not a named individual. The game should never look like it
      // is pointing at a specific person's house.
      return `${rng.pick(SURNAMES)} family`
    case 'church':
      return `${rng.pick(CHURCH_FIRST)} ${rng.pick(CHURCH_KIND)}`
    case 'historic':
      return 'Protected historic site'
    case 'industrial':
      return `${rng.pick(SURNAMES)} ${rng.pick(INDUSTRIAL_SUFFIX)}`
    case 'public':
      return rng.pick(['County government', 'State of Georgia', 'Board of Education'])
  }
}

/** Stable owner name for a parcel id. */
export function ownerNameFor(archetype: ParcelArchetype, parcelId: string): string {
  return synthesizeOwnerFor(archetype, new Rng(deriveSeed(0x0117e2, parcelId)))
}
