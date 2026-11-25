import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const read = (f: string): any => JSON.parse(readFileSync(`research/env/${f}`, 'utf8'))
mkdirSync('public/data/env', { recursive: true })

const air = read('air.json')
const water = read('water_counties.json')
const counties: Record<string, unknown> = {}
for (const fips of Object.keys(air)) {
  const a = air[fips]
  const w = water[fips]
  counties[fips] = {
    pm25: a.pm25, pm25Measured: a.pm25Basis === 'monitored', pm25Year: String(a.pm25Year ?? ''),
    ozone: a.ozonePpm === null ? null : Math.round(a.ozonePpm * 1000), ozoneMeasured: a.ozoneBasis === 'monitored', ozoneYear: String(a.ozoneYear ?? ''),
    good: w?.streamMiles?.good ?? 0, impaired: w?.streamMiles?.impaired ?? 0,
    causes: (w?.topCauses ?? []).slice(0, 4).map((c: any) => c.cause),
  }
}
writeFileSync('public/data/env/counties.json', JSON.stringify(counties))
for (const f of ['13261', '13175', 'state']) {
  const lines = read(`water_lines_${f}.json`).lines.map((l: any) => ({ n: l.name, s: l.status, c: l.causes.slice(0, 3), p: l.paths }))
  writeFileSync(`public/data/env/streams-${f}.json`, JSON.stringify(lines))
  console.log(f, lines.length)
}
