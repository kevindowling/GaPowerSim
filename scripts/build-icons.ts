import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Game concept → MDI icon name. */
const WANTED: Record<string, string> = {
  gasCt: 'turbine',
  gasCcgt: 'factory',
  solar: 'solar-power-variant',
  battery: 'home-battery',
  nuclear: 'atom',
  dataCenter: 'server-network',
  tower: 'transmission-tower',
  fault: 'flash-alert',
}

interface IconifyIcon { body: string; width?: number; height?: number }
interface IconifyJson {
  icons: Record<string, IconifyIcon>
  width?: number
  height?: number
}

/** Pull every `d` attribute out of an icon's SVG body. */
function extractPaths(body: string): string[] {
  const out: string[] = []
  const re = /\sd="([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) out.push(m[1])
  return out
}

function main(): void {
  const set = require('@iconify-json/mdi/icons.json') as IconifyJson
  const info = require('@iconify-json/mdi/info.json') as {
    name: string
    author: { name: string; url: string }
    license: { title: string; url: string }
  }
  const pkg = require('@iconify-json/mdi/package.json') as { version: string }

  const defaultW = set.width ?? 24
  const defaultH = set.height ?? 24

  const entries: string[] = []
  for (const [key, iconName] of Object.entries(WANTED)) {
    const icon = set.icons[iconName]
    if (!icon) throw new Error(`icon "${iconName}" not in the set`)
    const paths = extractPaths(icon.body)
    if (paths.length === 0) throw new Error(`icon "${iconName}" has no path data`)
    entries.push(
      `  ${key}: {\n` +
      `    name: ${JSON.stringify(iconName)},\n` +
      `    width: ${icon.width ?? defaultW},\n` +
      `    height: ${icon.height ?? defaultH},\n` +
      `    paths: [\n${paths.map((d) => `      ${JSON.stringify(d)},`).join('\n')}\n    ],\n` +
      `  },`,
    )
  }

  const file = `/**
 * Vendored icon paths: GENERATED, do not edit by hand.
 * Regenerate with \`npm run build:icons\`.
 *
 * Source: ${info.name} by ${info.author.name}
 *   ${info.author.url}
 * Licence: ${info.license.title}: ${info.license.url}
 * Taken from @iconify-json/mdi@${pkg.version}; only the icons this game draws
 * are included.
 *
 * Coordinates are in the icon's own ${defaultW}×${defaultH} space. The renderer
 * scales them; see drawIcon in mapRenderer.ts.
 */

export interface VectorIcon {
  /** Upstream icon name, kept for attribution and for finding it again. */
  name: string
  width: number
  height: number
  paths: readonly string[]
}

export const ICONS = {
${entries.join('\n')}
} as const satisfies Record<string, VectorIcon>

export type IconKey = keyof typeof ICONS

/** Attribution string, surfaced in the UI credits. */
export const ICON_ATTRIBUTION =
  '${info.name} by ${info.author.name} (${info.license.title})'
`

  const path = resolve(ROOT, 'src/render/icons.ts')
  writeFileSync(path, file)
  console.log(`wrote ${path}`)
  console.log(`  ${Object.keys(WANTED).length} icons, ${(file.length / 1024).toFixed(1)} KiB`)
  console.log(`  ${info.name}: ${info.license.title}`)
}

main()
