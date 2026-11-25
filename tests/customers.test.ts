import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { SPARE, spareAt } from '../src/data/sparePower.ts'
import { inServiceArea, type DataCenter } from '../src/data/dataCenters.ts'
import { quarterOf } from '../src/engine/time.ts'
import { project } from '../src/engine/geo/projection.ts'
import { fixtures } from './helpers/loadFixtures.ts'

const list = JSON.parse(readFileSync('public/data/datacenters.json', 'utf8')) as Array<Record<string, any>>

describe('reported data centers', () => {
  it('have an id, a place and a source each', () => {
    expect(list.length).toBeGreaterThan(150)
    expect(new Set(list.map((d) => d.id)).size).toBe(list.length)
    for (const d of list) {
      expect(d.sources.length).toBeGreaterThan(0)
      if (d.lat !== null) {
        expect(d.lat).toBeGreaterThan(24)
        expect(d.lat).toBeLessThan(38)
        expect(d.lon).toBeGreaterThan(-92)
        expect(d.lon).toBeLessThan(-75)
      }
      expect(d.mw === null || d.mw > 0).toBe(true)
    }
  })
})

describe('spare power', () => {
  it('follows the season', () => {
    expect(spareAt(quarterOf(2026, 4))).toEqual({ mw: 1739, season: 'winter 2026/27' })
    expect(spareAt(quarterOf(2027, 1))).toEqual({ mw: 1739, season: 'winter 2026/27' })
    expect(spareAt(quarterOf(2027, 3))).toEqual({ mw: 936, season: 'summer 2027' })
    expect(spareAt(quarterOf(2028, 4))).toEqual({ mw: -119, season: 'winter 2028/29' })
    expect(spareAt(quarterOf(2040, 3)).mw).toBe(SPARE[SPARE.length - 1].summer)
  })
})

describe('where they are', () => {
  const states = JSON.parse(readFileSync('public/data/neighbors.json', 'utf8')) as Array<{ abbr: string; rings: number[][] }>
  const inRing = (r: number[], x: number, y: number): boolean => {
    let k = false
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      if ((r[i + 1] > y) !== (r[j + 1] > y) && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) k = !k
    }
    return k
  }

  it('is on land, in the state each names', () => {
    const wrong = list.filter((d) => d.lat !== null).filter((d) => {
      const [x, y] = project(d.lon, d.lat)
      return !states.find((s) => s.abbr === d.state)?.rings.some((r) => inRing(r, x, y))
    })
    expect(wrong.map((d) => `${d.name} ${d.state}`)).toEqual([])
  })

  it('is in the county named, in Georgia', () => {
    const { counties } = fixtures()
    const wrong = list.filter((d) => d.state === 'GA' && d.lat !== null).filter((d) => {
      const [x, y] = project(d.lon, d.lat)
      const c = counties.counties.find((k) => k.polygons.some((p) => inRing(p[0], x, y)))
      return !c || !String(d.county).toLowerCase().includes(c.name.toLowerCase())
    })
    expect(wrong.map((d) => `${d.name}, ${d.county}`)).toEqual([])
  })
})

describe('the service area', () => {
  it('is Georgia, less other utilities, and the sister utilities next door', () => {
    const kept = list.filter((d) => inServiceArea(d as DataCenter))
    expect(kept.length).toBeGreaterThan(90)
    expect(new Set(kept.map((d) => d.state))).toEqual(new Set(['GA', 'AL', 'MS']))
    expect(kept.some((d) => /EMC|MEAG|TVA|Entergy/.test(d.utility ?? '') && !/Georgia Power/.test(d.utility ?? ''))).toBe(false)
    expect(kept.filter((d) => d.state !== 'GA').every((d) => /Alabama Power|Mississippi Power/.test(d.utility))).toBe(true)
  })
})
