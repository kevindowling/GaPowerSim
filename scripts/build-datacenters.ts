import { readFileSync, writeFileSync } from 'node:fs'

interface Raw {
  name: string; developer_or_tenant: string | null; county: string | null; state: string
  lat: number | null; lon: number | null; coordPrecision: string; proposedMW: number | null; mwBasis: string
  mwNote: string | null; servingUtility: string | null; status: string; announcedDate: string | null
  targetInServiceDate: string | null; statusAsOf: string | null
  sources: Array<{ url: string; title: string; date: string | null }>; confidence: string
  coordSource?: { url: string; title: string } | null
}

const raw = JSON.parse(readFileSync('research/datacenters.json', 'utf8')) as Raw[]
const out = raw.map((r) => ({
  id: r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  name: r.name, developer: r.developer_or_tenant, county: r.county, state: r.state,
  lat: r.lat, lon: r.lon, precision: r.coordPrecision,
  mw: r.proposedMW, mwNote: r.mwNote, utility: r.servingUtility, status: r.status,
  target: r.targetInServiceDate, asOf: r.statusAsOf,
  where: r.coordSource?.url ? { url: r.coordSource.url, title: r.coordSource.title } : null,
  sources: r.sources.slice(0, 4).map((s) => ({ url: s.url, title: s.title, date: s.date })),
}))
writeFileSync('public/data/datacenters.json', JSON.stringify(out))
console.log(`${out.length} data centers`)
