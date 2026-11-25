import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = resolve(ROOT, 'dist')

const problems: string[] = []

function check(ok: boolean, message: string): void {
  if (!ok) problems.push(message)
}

if (!existsSync(DIST)) {
  console.error('No dist/: run `npm run build` first.')
  process.exit(1)
}

for (const page of ['index.html', 'embed.html']) {
  const path = resolve(DIST, page)
  if (!existsSync(path)) {
    problems.push(`dist/${page} is missing`)
    continue
  }
  const html = readFileSync(path, 'utf8')

  // Absolute asset references are the failure mode this script exists for.
  const absolute = html.match(/(?:src|href)="\/[^"]*"/g) ?? []
  check(
    absolute.length === 0,
    `dist/${page} references ${absolute.join(', ')} from the domain root: ` +
    'these 404 when Pages serves the site from /<repo>/. ' +
    "Vite's `base` must stay relative.",
  )

  check(
    /(?:src|href)="\.\/assets\//.test(html),
    `dist/${page} does not reference ./assets/: the build output looks wrong`,
  )
}

const REQUIRED_DATA = [
  'data/counties.json',
  'data/hexgrid.json',
  'data/hexgrid.bin',
  'data/parcels/13261.json',
  'data/gis/state.json',
  'data/gis/13261.json',
  'data/hydrology/state.json',
  'data/roads/13261.json',
  'favicon.svg',
]

for (const file of REQUIRED_DATA) {
  const path = resolve(DIST, file)
  check(existsSync(path), `dist/${file} is missing: the game cannot load without it`)
  if (existsSync(path)) {
    check(statSync(path).size > 0, `dist/${file} is empty`)
  }
}

function dirSize(dir: string): number {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    total += entry.isDirectory() ? dirSize(path) : statSync(path).size
  }
  return total
}

const totalMb = dirSize(DIST) / 1024 / 1024
check(totalMb < 25, `dist/ is ${totalMb.toFixed(1)} MB, which is far too heavy for an embed`)

console.log(`dist/  ${totalMb.toFixed(1)} MB`)
for (const p of problems) console.error(`  ✗ ${p}`)

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s): this build would break on Pages.`)
  process.exit(1)
}
console.log('Build is safe to deploy to a subdirectory.')
