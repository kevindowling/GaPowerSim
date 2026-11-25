import { describe, it, expect } from 'vitest'
import { skewOf, skewMetresOf } from '../scripts/fetch-imagery.ts'
import { project } from '../src/engine/geo/projection.ts'
import { AMERICUS } from '../src/data/scenarios.ts'

describe('imagery georeferencing', () => {
  const { lon, lat } = AMERICUS.contract.site
  const box = (half: number): [number, number, number, number] =>
    [lon - half, lat - half, lon + half, lat + half]

  it('measures a real departure over the study area', () => {
    // ~1% of a ~47 km extent: about half a kilometre on the ground.
    expect(skewOf(box(0.25))).toBeCloseTo(0.0105, 3)
    expect(skewMetresOf(box(0.25))).toBeGreaterThan(400)
  })

  it('converges to a floor as the extent shrinks, instead of vanishing', () => {
    const coarse = skewOf(box(0.25))
    const fine = skewOf(box(0.25 / 16))
    expect(fine).toBeGreaterThan(coarse * 0.7)
    expect(fine).toBeGreaterThan(0.007)
  })

  it('does shrink in absolute terms, which is what tiling would have bought', () => {
    expect(skewMetresOf(box(0.25 / 16))).toBeLessThan(skewMetresOf(box(0.25)) / 8)
  })

  it('is smallest on the projection axis and grows away from it', () => {
    // The cone touches at the central meridian, so a box there is the best case.
    const onAxis = skewOf([-83.6, 32.4, -83.4, 32.6])
    const offAxis = skewOf([-85.4, 32.4, -85.2, 32.6])
    expect(onAxis).toBeLessThan(offAxis)
  })

  it('is exercising the real projection', () => {
    const [x0] = project(-83.5, 32.5)
    const [x1] = project(-84.5, 32.5)
    expect(Math.abs(x1 - x0)).toBeGreaterThan(50)
  })
})
