import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { project } from '../src/engine/geo/projection.ts'

// Reads Overpass replies for power=substation and power=transformer.

interface El { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags: Record<string, string> }

const dir = process.argv[2]
/** Operators of Southern Company territory in the neighbouring states. */
const SOUTHERN: Record<string, RegExp> = { AL: /alabama power|southern/i, MS: /mississippi power|southern/i }
/** How near a mapped transformer has to be to belong to a substation. */
const REACH_KM = 0.35

const kvOf = (v: string | undefined): number[] => (v ?? '').split(';').map((x) => Number(x) / 1000).filter((x) => x > 0)
const out: Array<Record<string, unknown>> = []
for (const [st, file] of [['GA', 'subs.json'], ['AL', 'subs_AL.json'], ['MS', 'subs_MS.json']] as const) {
  if (!existsSync(`${dir}/${file}`)) continue
  const els = (JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')) as { elements: El[] }).elements
  const at = (e: El): [number, number] => [e.lon ?? e.center!.lon, e.lat ?? e.center!.lat]
  const tx = els.filter((e) => e.tags?.power === 'transformer').map((e) => ({ xy: project(...at(e)), t: e.tags }))
  for (const e of els) {
    if (e.tags?.power !== 'substation') continue
    const kv = kvOf(e.tags.voltage).sort((a, b) => b - a)
    if ((kv[0] ?? 0) < 115 || e.tags.substation === 'industrial' || e.tags.substation === 'generation') continue
    if (SOUTHERN[st] && !SOUTHERN[st].test(e.tags.operator ?? '')) continue
    // Georgia Power shares its grid with these two. Others run their own.
    if (st === 'GA' && e.tags.operator && !/georgia power|georgia transmission|meag|municipal electric authority/i.test(e.tags.operator)) continue
    const [lon, lat] = at(e)
    const [x, y] = project(lon, lat)
    const here = tx.filter((t) => Math.hypot(t.xy[0] - x, t.xy[1] - y) <= REACH_KM && t.t.transformer !== 'generator')
    out.push({
      n: e.tags.name ?? null, kv, o: e.tags.operator ?? null, st,
      at: [Number(lon.toFixed(5)), Number(lat.toFixed(5))],
      tx: here.map((t) => [kvOf(t.t['voltage:primary'])[0] ?? null, kvOf(t.t['voltage:secondary'])[0] ?? null, t.t.rating ?? null, Number(t.t.devices ?? 1)]),
    })
  }
}
writeFileSync('public/data/gis/substations.json', JSON.stringify(out))
const n = (k: (o: any) => boolean): number => out.filter(k).length
console.log(out.length, 'GA', n((o) => o.st === 'GA'), 'AL', n((o) => o.st === 'AL'), 'MS', n((o) => o.st === 'MS'), '500kV', n((o) => o.kv[0] >= 500), '230', n((o) => o.kv[0] >= 230 && o.kv[0] < 500), 'with transformers', n((o) => o.tx.length > 0))
