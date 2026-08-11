/**
 * check-build.ts — confirm dist/ will actually work where it is going.
 *
 * GitHub Pages serves a project site from `https://<user>.github.io/<repo>/`,
 * not from the domain root. A build that references `/assets/main.js` loads
 * perfectly on localhost and 404s the moment it is deployed, which is the single
 * most common way a Pages deploy breaks — and it breaks silently, because the
 * HTML still returns 200.
 *
 * So this asserts the properties that make a subdirectory deploy work, and runs
 * in CI before anything is published.
 *
 * Run: npm run check:build
 */

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
  console.error('No dist/ — run `npm run build` first.')
  process.exit(1)
}

// --- entry points --------------------------------------------------------

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
    `dist/${page} references ${absolute.join(', ')} from the domain root — ` +
    'these 404 when Pages serves the site from /<repo>/. ' +
    "Vite's `base` must stay relative.",
  )

  check(
    /(?:src|href)="\.\/assets\//.test(html),
    `dist/${page} does not reference ./assets/ — the build output looks wrong`,
  )
}

// --- vendored data -------------------------------------------------------

const REQUIRED_DATA = [
  'data/counties.json',
  'data/hexgrid.json',
  'data/hexgrid.bin',
  'data/parcels/13261.json',
  'favicon.svg',
]

for (const file of REQUIRED_DATA) {
  const path = resolve(DIST, file)
  check(existsSync(path), `dist/${file} is missing — the game cannot load without it`)
  if (existsSync(path)) {
    check(statSync(path).size > 0, `dist/${file} is empty`)
  }
}

// --- payload -------------------------------------------------------------

function dirSize(dir: string): number {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    total += entry.isDirectory() ? dirSize(path) : statSync(path).size
  }
  return total
}

const totalMb = dirSize(DIST) / 1024 / 1024
// A soft ceiling. This is an embed; if it ever approaches Pages' 1 GB site limit
// something has gone very wrong, but the number to watch is what a player waits for.
check(totalMb < 25, `dist/ is ${totalMb.toFixed(1)} MB, which is far too heavy for an embed`)

// --- report --------------------------------------------------------------

console.log(`dist/  ${totalMb.toFixed(1)} MB`)
for (const p of problems) console.error(`  ✗ ${p}`)

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s) — this build would break on Pages.`)
  process.exit(1)
}
console.log('Build is safe to deploy to a subdirectory.')
