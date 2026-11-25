import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  corridorBuffer, multiPolyArea, polyArea, km2ToAcres, centerlineLength,
  intersect, subtract, union, clipFailureCount, type Point, type Poly,
} from '../src/engine/geo/polygon.ts'
import { takingFor, computeTakings, ROW_HALF_WIDTH_KM } from '../src/engine/parcels/takings.ts'
import {
  acceptanceProbability, newDeal, resolveOffer, reservationMultiple,
} from '../src/engine/parcels/negotiation.ts'
import { inflateParcel, type Parcel, type ParcelFile } from '../src/engine/parcels/types.ts'
import { ownerNameFor } from '../src/engine/parcels/owners.ts'

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data')

/** A square parcel of the given side length in km, centred on the origin. */
function squareParcel(sideKm: number, over: Partial<Parcel> = {}): Parcel {
  const h = sideKm / 2
  const poly: Poly = [[[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]]]
  return {
    id: 'test-1',
    countyFips: '13261',
    poly,
    acres: km2ToAcres(sideKm * sideKm),
    archetype: 'row-crop',
    owner: 'Test farm',
    assessedPerAcre: 4_000,
    ...over,
  }
}

describe('polygon geometry', () => {
  it('actually performs boolean operations', () => {
    const a: Poly[] = [[[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]]]
    const b: Poly[] = [[[[1, -1], [2, -1], [2, 5], [1, 5], [1, -1]]]]
    expect(multiPolyArea(intersect(a, b))).toBeCloseTo(4, 6)
    expect(subtract(a, b)).toHaveLength(2)
    expect(multiPolyArea(union([a, b]))).toBeGreaterThan(16)
    expect(clipFailureCount()).toBe(0)
  })

  it('buffers a straight centerline to the right area', () => {
    const line: Point[] = [[0, 0], [10, 0]]
    const buf = corridorBuffer(line, 0.023)
    // 10 km long, 46 m wide.
    expect(multiPolyArea(buf)).toBeCloseTo(10 * 0.046, 4)
  })

  it('fills the corner of a dog-leg instead of leaving a notch', () => {
    const straight = multiPolyArea(corridorBuffer([[0, 0], [20, 0]], 0.05))
    const bent = multiPolyArea(corridorBuffer([[0, 0], [10, 0], [10, 10]], 0.05))
    expect(bent).toBeGreaterThan(straight * 0.99)
  })

  it('measures centerline length', () => {
    expect(centerlineLength([[0, 0], [3, 4]])).toBeCloseTo(5, 9)
    expect(centerlineLength([[0, 0]])).toBe(0)
  })
})

describe('takings', () => {
  it('takes nothing from a parcel the corridor misses', () => {
    const parcel = squareParcel(1)
    const buffer = corridorBuffer([[50, 50], [60, 50]], 0.023)
    expect(takingFor(parcel, buffer)).toBeNull()
  })

  it('takes real acres, computed from real geometry', () => {
    const parcel = squareParcel(1) // 1 km² = 247.1 acres
    // A 46 m corridor straight across the middle takes 1 km × 0.046 km.
    const buffer = corridorBuffer([[-2, 0], [2, 0]], 0.023)
    const t = takingFor(parcel, buffer)!
    expect(t.takenAcres).toBeCloseTo(km2ToAcres(1 * 0.046), 1)
    expect(t.remainderAcres).toBeCloseTo(parcel.acres - t.takenAcres, 1)
  })

  it('severs a parcel it cuts through, and does not sever one it clips', () => {
    const parcel = squareParcel(1)

    const through = takingFor(parcel, corridorBuffer([[-2, 0], [2, 0]], 0.023))!
    expect(through.severed).toBe(true)
    expect(through.remainderPieces).toBe(2)

    // Hugging the boundary, but fully inside it, so the SAME acreage is taken.
    const alongEdge = takingFor(parcel, corridorBuffer([[-2, 0.477], [2, 0.477]], 0.023))!
    expect(alongEdge.severed).toBe(false)
    expect(alongEdge.remainderPieces).toBe(1)
  })

  it('costs far more to bisect a parcel than to clip its edge, for the same acres', () => {
    const parcel = squareParcel(1)
    const through = takingFor(parcel, corridorBuffer([[-2, 0], [2, 0]], 0.023))!
    const alongEdge = takingFor(parcel, corridorBuffer([[-2, 0.477], [2, 0.477]], 0.023))!

    // Nearly identical land taken...
    expect(through.takenAcres).toBeCloseTo(alongEdge.takenAcres, 0)
    // ...but the severance damage is the difference, and it dominates.
    expect(through.appraisedTotal).toBeGreaterThan(alongEdge.appraisedTotal * 2)
    expect(through.severanceFactor).toBeGreaterThan(alongEdge.severanceFactor * 3)
  })

  it('charges more for an even split than a lopsided one', () => {
    const parcel = squareParcel(1)
    const even = takingFor(parcel, corridorBuffer([[-2, 0], [2, 0]], 0.023))!
    const lopsided = takingFor(parcel, corridorBuffer([[-2, 0.42], [2, 0.42]], 0.023))!
    expect(even.severanceFactor).toBeGreaterThan(lopsided.severanceFactor)
  })

  it('hurts a working farm more than absentee timberland', () => {
    const cut = corridorBuffer([[-2, 0], [2, 0]], 0.023)
    const farm = takingFor(squareParcel(1, { archetype: 'row-crop' }), cut)!
    const timber = takingFor(squareParcel(1, { archetype: 'timber' }), cut)!
    expect(farm.severanceFactor).toBeGreaterThan(timber.severanceFactor)
  })

  it('prices a whole corridor across many parcels', () => {
    const parcels: Parcel[] = []
    for (let i = 0; i < 6; i++) {
      const p = squareParcel(1, { id: `p${i}` })
      // Lay them out in a row along x.
      p.poly = [p.poly[0].map(([x, y]) => [x + i * 1.0, y] as Point)]
      parcels.push(p)
    }
    const result = computeTakings([[-1, 0], [7, 0]], ROW_HALF_WIDTH_KM[230], parcels)
    expect(result.parcelsAffected).toBe(6)
    expect(result.parcelsSevered).toBe(6)
    expect(result.totalAcres).toBeGreaterThan(0)
    expect(result.totalAppraised).toBeGreaterThan(0)
    expect(result.lengthKm).toBeCloseTo(8, 6)
  })
})

describe('what an owner will take', () => {
  const parcel = squareParcel(1)
  const taking = takingFor(parcel, corridorBuffer([[-2, 0], [2, 0]], 0.023))!
  const ctx = { seed: 7, countyApproval: 55, condemnations: 0, bestPaid: 0 }
  const chance = (p: Parcel, t = taking, c = ctx, m = 1.6) =>
    acceptanceProbability(p, t, newDeal(p), c, m)

  it('ranks owner types', () => {
    const at = (archetype: Parcel['archetype']) => chance(squareParcel(1, { archetype }))
    expect(at('timber')).toBeGreaterThan(at('row-crop'))
    expect(at('row-crop')).toBeGreaterThan(at('homestead'))
    expect(at('homestead')).toBeGreaterThan(at('church'))
    expect(at('historic')).toBe(0)
  })

  it('blocks protected land from the start', () => {
    expect(newDeal(squareParcel(1, { archetype: 'historic' })).status).toBe('blocked')
  })

  it('gets harder with condemnations, a hostile county, or a severed field', () => {
    expect(chance(parcel, taking, { ...ctx, condemnations: 2 })).toBeLessThan(chance(parcel))
    expect(chance(parcel, taking, { ...ctx, countyApproval: 15 })).toBeLessThan(chance(parcel))
    const edge = takingFor(parcel, corridorBuffer([[-2, 0.477], [2, 0.477]], 0.023))!
    expect(chance(parcel)).toBeLessThan(chance(parcel, edge))
  })

  it('makes a high price the going rate for everyone else', () => {
    expect(chance(parcel, taking, { ...ctx, bestPaid: 4 })).toBeLessThan(chance(parcel))
    const price = (bestPaid: number) => reservationMultiple(parcel, taking, { ...ctx, bestPaid })
    expect(price(5)).toBeGreaterThan(price(0))
  })

  it('gives the same answer to the same offer every time', () => {
    for (let i = 0; i < 60; i++) {
      const p = squareParcel(1, { id: `owner-${i}` })
      const price = reservationMultiple(p, taking, ctx)
      if (!Number.isFinite(price)) continue
      const low = { ...newDeal(p), offerMultiple: price - 0.01 }
      expect(resolveOffer(p, taking, low, ctx).accepted).toBe(false)
      expect(resolveOffer(p, taking, low, ctx).accepted).toBe(false)
      const enough = { ...newDeal(p), offerMultiple: price + 0.01 }
      expect(resolveOffer(p, taking, enough, ctx).accepted).toBe(true)
    }
  })

  it('rules out anything at or below what was refused', () => {
    const deal = { ...newDeal(parcel), refusedAt: 2, refusals: 1 }
    expect(acceptanceProbability(parcel, taking, deal, ctx, 2)).toBe(0)
    expect(acceptanceProbability(parcel, taking, deal, ctx, 3)).toBeGreaterThan(0)
  })

  it('estimates odds that match what owners actually do', () => {
    const n = 4000
    let yes = 0
    for (let i = 0; i < n; i++) {
      const p = squareParcel(1, { id: `sample-${i}` })
      if (reservationMultiple(p, taking, ctx) <= 1.9) yes++
    }
    expect(yes / n).toBeCloseTo(chance(parcel, taking, ctx, 1.9), 1)
  })

  it('has some owners who never sell', () => {
    const homes = Array.from({ length: 300 }, (_, i) => squareParcel(0.2, { id: `h${i}`, archetype: 'homestead' }))
    const never = homes.filter((p) => reservationMultiple(p, taking, ctx) === Infinity).length
    expect(never).toBeGreaterThan(5)
    expect(never).toBeLessThan(80)
  })
})

describe('the vendored Sumter cadastre', () => {
  const file = JSON.parse(
    readFileSync(resolve(DATA, 'parcels/13261.json'), 'utf8'),
  ) as ParcelFile

  it('is labelled honestly about what it is', () => {
    // Until the real fetch runs, this must announce itself as a stand-in.
    expect(typeof file.synthetic).toBe('boolean')
    if (file.synthetic) expect(file.note).toMatch(/NOT REAL PARCEL DATA/)
  })

  it('stores no owner names on disk', () => {
    const raw = readFileSync(resolve(DATA, 'parcels/13261.json'), 'utf8')
    expect(raw).not.toMatch(/"owner"/)
    expect(raw.toUpperCase()).not.toMatch(/"OWNERNAME"|"MAILADDR"|"TAXPAYER"/)
  })

  it('covers the county with plausible parcels', () => {
    expect(file.parcels.length).toBeGreaterThan(1_000)
    const totalAcres = file.parcels.reduce((s, p) => s + p.acres, 0)
    // Sumter County is about 1,275 km², or 315,000 acres.
    expect(totalAcres).toBeGreaterThan(280_000)
    expect(totalAcres).toBeLessThan(340_000)
  })

  it('inflates into geometry whose area matches its stated acreage', () => {
    for (const w of file.parcels.slice(0, 400)) {
      const p = inflateParcel(w, file.countyFips, ownerNameFor)
      expect(km2ToAcres(polyArea(p.poly))).toBeCloseTo(p.acres, 0)
    }
  })

  it('gives every parcel a stable, non-personal owner name', () => {
    const p = inflateParcel(file.parcels[0], file.countyFips, ownerNameFor)
    expect(p.owner.length).toBeGreaterThan(0)
    // Same id always yields the same name, across sessions and re-fetches.
    expect(inflateParcel(file.parcels[0], file.countyFips, ownerNameFor).owner).toBe(p.owner)
  })

  it('has a realistic mix of rural tracts and town lots', () => {
    const acres = file.parcels.map((p) => p.acres).sort((a, b) => a - b)
    const big = acres.filter((a) => a > 50)
    const bigAcreage = big.reduce((s, a) => s + a, 0)
    const totalAcreage = acres.reduce((s, a) => s + a, 0)
    expect(bigAcreage / totalAcreage).toBeGreaterThan(0.6)
    expect(big.length / acres.length).toBeLessThan(0.5)
  })
})
