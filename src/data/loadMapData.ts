import type {
  CountiesFile, HexGrid, HexGridManifest, MapData, StateShape,
} from '../engine/geo/mapTypes.ts'

/** Resolve a data path relative to the deployed base, so iframes at any path work. */
function dataUrl(name: string): string {
  return new URL(`data/${name}`, document.baseURI).href
}

async function loadJson<T>(name: string): Promise<T> {
  const res = await fetch(dataUrl(name))
  if (!res.ok) throw new Error(`failed to load ${name}: ${res.status} ${res.statusText}`)
  return (await res.json()) as T
}

export async function loadMapData(): Promise<MapData> {
  const [counties, manifest, binRes, states] = await Promise.all([
    loadJson<CountiesFile>('counties.json'),
    loadJson<HexGridManifest>('hexgrid.json'),
    fetch(dataUrl('hexgrid.bin')),
    loadJson<StateShape[]>('neighbors.json').catch(() => []),
  ])

  if (!binRes.ok) {
    throw new Error(`failed to load hexgrid.bin: ${binRes.status} ${binRes.statusText}`)
  }
  const buf = await binRes.arrayBuffer()

  const view = (name: string): { u8: Uint8Array; u16: Uint16Array } => {
    const meta = manifest.layers.find((l) => l.name === name)
    if (!meta) throw new Error(`hexgrid.bin is missing layer "${name}"`)
    return {
      u8: new Uint8Array(buf, meta.offset, meta.byteLength),
      u16: new Uint16Array(buf, meta.offset, meta.byteLength / 2),
    }
  }

  const grid: HexGrid = {
    manifest,
    spec: manifest.spec,
    county: view('county').u8,
    terrain: view('terrain').u8,
    population: view('population').u8,
    landValue: view('landValue').u16,
    protection: view('protection').u8,
  }

  return { counties, grid, states }
}
