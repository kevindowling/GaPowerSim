import { project } from '../engine/geo/projection.ts'

export interface MappedTransformer { high: number | null; low: number | null; rating: string | null; count: number }

/** A real substation, from OpenStreetMap. */
export interface Substation {
  id: string
  name: string
  named: boolean
  /** Highest voltage, then the others mapped. */
  kv: number
  voltages: number[]
  operator: string | null
  state: string
  x: number
  y: number
  transformers: MappedTransformer[]
}

interface Wire {
  n: string | null; kv: number[]; o: string | null; st: string; at: [number, number]
  tx: Array<[number | null, number | null, string | null, number]>
}

export function substationId(kv: number, x: number, y: number): string {
  return `${kv}-${Math.round(x * 10)}-${Math.round(y * 10)}`
}

/** Substations across the service area. An empty list if the file is missing. */
export async function loadSubstations(): Promise<Substation[]> {
  try {
    const res = await fetch(new URL('data/gis/substations.json', document.baseURI).href)
    if (!res.ok) return []
    return ((await res.json()) as Wire[]).map(inflateSubstation)
  } catch {
    return []
  }
}

export function inflateSubstation(w: Wire): Substation {
  const [x, y] = project(w.at[0], w.at[1])
  const kv = w.kv[0]
  return {
    id: substationId(kv, x, y), name: w.n ?? `${kv} kV substation`, named: w.n !== null, kv, voltages: w.kv,
    operator: w.o, state: w.st, x, y,
    transformers: w.tx.map(([high, low, rating, count]) => ({ high, low, rating, count })),
  }
}
