import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { feature } from 'topojson-client'
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import { project } from '../src/engine/geo/projection.ts'
import { simplifyFlat, roundFlat, ringArea } from '../src/engine/geo/simplify.ts'

const require = createRequire(import.meta.url)
const topo = require('us-atlas/states-10m.json')

/** Georgia, the states round it, and the ones beyond that show at the edge. */
const STATES: Record<string, string> = {
  '13': 'GA', '01': 'AL', '28': 'MS', '45': 'SC', '37': 'NC', '47': 'TN', '12': 'FL',
  '51': 'VA', '21': 'KY', '05': 'AR', '22': 'LA', '54': 'WV', '29': 'MO',
  '39': 'OH', '18': 'IN', '17': 'IL', '20': 'KS', '40': 'OK', '48': 'TX', '24': 'MD', '10': 'DE', '42': 'PA', '34': 'NJ', '11': 'DC', '19': 'IA', '31': 'NE',
}
const TOLERANCE_KM = 0.6
/** Islands smaller than this are dropped. */
const MIN_KM2 = 12

const states = feature(topo, topo.objects.states) as unknown as FeatureCollection<Polygon | MultiPolygon, { name: string }>
const out = states.features.filter((f) => STATES[String(f.id)]).map((f) => {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
  const rings = polys.map((p) => {
    const flat = simplifyFlat(p[0].flatMap(([lon, lat]) => project(lon, lat)), TOLERANCE_KM)
    roundFlat(flat, 2)
    return flat
  }).filter((r) => r.length >= 8 && Math.abs(ringArea(r)) >= MIN_KM2)
    .sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))
  return { abbr: STATES[String(f.id)], name: f.properties.name, rings }
})
const text = JSON.stringify(out)
writeFileSync('public/data/neighbors.json', text)
console.log(out.map((s) => `${s.abbr} ${s.rings.length}`).join(', '), `${Math.round(text.length / 1024)} KB`)
