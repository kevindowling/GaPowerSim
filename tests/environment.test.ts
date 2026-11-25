import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { nearestStream, ozoneRise, particleRise, yearlyOutput, type Stream } from '../src/engine/environment.ts'
import { EMISSIONS, ENV_SOURCES, LOW_FLOW } from '../src/data/emissions.ts'
import { PLANT_TYPES } from '../src/data/plants.ts'
import { airFill, countyEnvLines, projectionLines, waterFill, yearText } from '../src/ui/environment.ts'
import { bareGame } from './helpers/play.ts'
import type { CountyEnv } from '../src/data/loadEnv.ts'

const counties = JSON.parse(readFileSync('public/data/env/counties.json', 'utf8')) as Record<string, CountyEnv>
const straight: Stream = { name: 'Test Creek', status: 'impaired', causes: ['E. coli'], paths: [[[0, 0], [10, 0]]] }

describe('a year of a plant', () => {
  it('matches the published factors', () => {
    const cc = yearlyOutput('gas-ccgt')
    expect(cc.mwh).toBeCloseTo(550 * 0.62 * 8760)
    expect(cc.pmTons).toBeCloseTo((0.038 * cc.mwh) / 2000)
    // 1,000 MW running flat out uses 7.6 cubic feet a second.
    expect((cc.waterCfs! / (550 * 0.62)) * 1000).toBeCloseTo(7.6, 1)
    expect(yearlyOutput('solar').co2Tons).toBe(0)
    expect(yearlyOutput('battery').waterCfs).toBeNull()
  })

  it('has factors for every plant', () => {
    for (const t of PLANT_TYPES) {
      expect(EMISSIONS[t.id]).toBeDefined()
      expect(yearText(t.id)).toMatch(/A year of use/)
    }
    expect(ENV_SOURCES.every((s) => s.url.startsWith('https://'))).toBe(true)
  })
})

describe('projections', () => {
  it('fall with distance', () => {
    const o = { ...yearlyOutput('gas-ccgt'), pmTons: 100, noxTons: 0, so2Tons: 0 }
    expect(particleRise(o, 2)).toBeCloseTo(0.038, 3)
    expect(particleRise(o, 0)).toBe(particleRise(o, 2))
    expect(particleRise(o, 20)).toBeLessThan(particleRise(o, 2) / 5)
  })

  it('match the modeled ozone case', () => {
    const o = { ...yearlyOutput('gas-ccgt'), noxTons: 500 }
    expect(ozoneRise(o, '13175')).toBeCloseTo(2.87, 1)
    expect(ozoneRise({ ...o, noxTons: 50 }, '13175')).toBeCloseTo(ozoneRise(o, '13175') / 10)
    expect(ozoneRise({ ...o, noxTons: 0 }, '13261')).toBe(0)
  })

  it('say what a plant would do before it is placed', () => {
    const env = { counties, streams: [straight] }
    const lines = projectionLines(bareGame(), env, 'gas-ccgt', '13261', 5, 0.5).join(' | ')
    expect(lines).toMatch(/fine particles up 0\.02 µg\/m³ at 2 km, now 9\.3 \(modeled\) of 9/)
    expect(lines).toMatch(/Ozone up .* ppb on the worst day, now 60 of 70/)
    expect(lines).toMatch(/% of the Flint River in a dry week/)
    expect(lines).toMatch(/Test Creek, under 1 km away: impaired, e\. coli/)
    expect(projectionLines(bareGame(), env, 'solar', '13261', 5, 50).join()).toMatch(/Air: no change/)
    expect(projectionLines(bareGame(), null, 'gas-ct', '13261', 0, 0).length).toBeGreaterThan(1)
  })

  it('find the closest stream', () => {
    expect(nearestStream([straight], 5, 2, 5)).toMatchObject({ km: 2 })
    expect(nearestStream([straight], 5, 9, 5)).toBeNull()
  })
})

describe('the layers', () => {
  it('cover every county', () => {
    expect(Object.keys(counties)).toHaveLength(159)
    for (const c of Object.values(counties)) {
      expect(c.pm25).not.toBeNull()
      expect(airFill(c)).toMatch(/^rgba/)
      expect(countyEnvLines(c, 'air').join()).toMatch(/Measured|Modeled/)
      expect(countyEnvLines(c, 'water').length).toBeGreaterThan(0)
    }
    expect(waterFill(counties['13261'])).toMatch(/^rgba/)
    expect(airFill(undefined)).toBeUndefined()
    expect(Object.keys(LOW_FLOW).sort()).toEqual(['13175', '13261'])
  })
})
