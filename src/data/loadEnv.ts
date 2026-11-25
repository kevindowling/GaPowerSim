import type { Stream } from '../engine/environment.ts'
import { project } from '../engine/geo/projection.ts'

export interface CountyEnv {
  pm25: number | null
  pm25Measured: boolean
  pm25Year: string
  ozone: number | null
  ozoneMeasured: boolean
  ozoneYear: string
  /** Stream miles. */
  good: number
  impaired: number
  causes: string[]
}

export interface EnvData {
  counties: Record<string, CountyEnv>
  streams: Stream[]
}

interface WireStream { n: string; s: Stream['status']; c: string[]; p: Array<Array<[number, number]>> }

async function json<T>(name: string): Promise<T | null> {
  try {
    const res = await fetch(new URL(`data/env/${name}`, document.baseURI).href)
    return res.ok ? (await res.json()) as T : null
  } catch {
    return null
  }
}

const inflate = (list: WireStream[] | null): Stream[] => (list ?? []).map((l) => ({
  name: l.n, status: l.s, causes: l.c, paths: l.p.map((p) => p.map(([lon, lat]) => project(lon, lat))),
}))

/** Air and water data. Null if it is missing. */
export async function loadEnv(fips: string): Promise<EnvData | null> {
  const [counties, state, local] = await Promise.all([
    json<Record<string, CountyEnv>>('counties.json'),
    json<WireStream[]>('streams-state.json'),
    json<WireStream[]>(`streams-${fips}.json`),
  ])
  if (!counties) return null
  const near = inflate(local)
  const names = new Set(near.map((s) => s.name))
  return { counties, streams: [...near, ...inflate(state).filter((s) => !names.has(s.name))] }
}

export function impairedShare(c: CountyEnv): number | null {
  const all = c.good + c.impaired
  return all > 0 ? c.impaired / all : null
}
