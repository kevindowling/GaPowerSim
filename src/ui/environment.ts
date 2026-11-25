import type { GameState } from '../engine/types.ts'
import { EMISSIONS, LOW_FLOW, OZONE_LIMIT, PM25_LIMIT } from '../data/emissions.ts'
import { impairedShare, type CountyEnv, type EnvData } from '../data/loadEnv.ts'
import type { PlantKind } from '../data/plants.ts'
import { nearestStream, ozoneRise, particleRise, yearlyOutput, NEAR_KM } from '../engine/environment.ts'

const small = (v: number, unit: string): string =>
  v < 0.005 ? `under 0.01 ${unit}` : `${v.toFixed(v < 1 ? 2 : 1)} ${unit}`
const tons = (v: number): string => (v >= 1000 ? `${Math.round(v / 1000).toLocaleString()}K` : v < 10 ? v.toFixed(1) : String(Math.round(v)))

/** A year of one unit, for the plant list. */
export function yearText(kind: PlantKind): string {
  const e = EMISSIONS[kind]
  const o = yearlyOutput(kind)
  const water = o.waterGallons === null ? 'Water use not published.'
    : o.waterGallons < 1e6 ? 'Almost no water used up.' : `${Math.round(o.waterGallons / 1e6).toLocaleString()} million gallons of water used up.`
  if (e.co2 === 0) return `A year of use: no smoke. ${water}`
  return `A year of use: ${tons(o.noxTons)} tons of nitrogen oxides, ${tons(o.pmTons)} of fine particles, ${tons(o.co2Tons)} of carbon dioxide. ${water}`
}

/** What a plant here would do to air and water. */
export function projectionLines(
  game: GameState, env: EnvData | null, kind: PlantKind, fips: string, x: number, y: number,
): string[] {
  const out: string[] = []
  const region = game.contract.countyFips
  const o = yearlyOutput(kind)
  const here = env?.counties[fips]
  if (EMISSIONS[kind].co2 > 0) {
    const pm = small(particleRise(o, NEAR_KM), 'µg/m³')
    out.push(`Air: fine particles up ${pm} at ${NEAR_KM} km${here?.pm25 ? `, now ${here.pm25.toFixed(1)}${here.pm25Measured ? '' : ' (modeled)'} of ${PM25_LIMIT}` : ''}`)
    out.push(`Ozone up ${small(ozoneRise(o, region), 'ppb')} on the worst day${here?.ozone ? `, now ${here.ozone} of ${OZONE_LIMIT}` : ''}`)
  } else {
    out.push('Air: no change')
  }
  const flow = LOW_FLOW[region]
  if (o.waterCfs === null) out.push('Water: use not published')
  else if (o.waterCfs < 0.05) out.push('Water: almost none used')
  else if (flow && kind !== 'nuclear-uprate') {
    out.push(`Water: uses ${o.waterCfs.toFixed(1)} cubic feet a second, ${((o.waterCfs / flow.cfs) * 100).toFixed(1)}% of the ${flow.river.split(' at ')[0]} in a dry week`)
  } else out.push(`Water: uses ${o.waterCfs.toFixed(1)} cubic feet a second`)
  const near = env && nearestStream(env.streams, x, y, 5)
  if (near) {
    out.push(`${near.stream.name}, ${near.km < 1 ? 'under 1' : Math.round(near.km)} km away: ${
      near.stream.status === 'impaired' ? `impaired${near.stream.causes[0] ? `, ${near.stream.causes[0].toLowerCase()}` : ''}`
        : near.stream.status === 'good' ? 'good' : 'not assessed'}`)
  }
  return out
}

/** A county's air and water, for its tooltip. */
export function countyEnvLines(c: CountyEnv | undefined, which: 'air' | 'water'): string[] {
  if (!c) return []
  if (which === 'air') {
    return [
      c.pm25 === null ? 'Fine particles not known' : `Fine particles ${c.pm25.toFixed(1)} µg/m³, limit ${PM25_LIMIT}. ${c.pm25Measured ? 'Measured' : 'Modeled'} ${c.pm25Year}`,
      c.ozone === null ? 'Ozone not known' : `Ozone ${c.ozone} ppb, limit ${OZONE_LIMIT}. ${c.ozoneMeasured ? 'Measured' : 'Modeled'} ${c.ozoneYear}`,
    ]
  }
  const share = impairedShare(c)
  return share === null ? ['No streams assessed']
    : [`${Math.round(share * 100)}% of assessed stream miles impaired`, ...(c.causes.length > 0 ? [`Mostly ${c.causes.slice(0, 2).join(', ').toLowerCase()}`] : [])]
}

/** Fine particles, pale to dark. */
export function airFill(c: CountyEnv | undefined): string | undefined {
  if (!c || c.pm25 === null) return undefined
  const t = Math.max(0, Math.min(1, (c.pm25 - 7) / 3))
  return `rgba(122,62,20,${(0.05 + 0.4 * t).toFixed(2)})`
}

/** Share of stream miles impaired, pale to dark. */
export function waterFill(c: CountyEnv | undefined): string | undefined {
  const share = c ? impairedShare(c) : null
  return share === null ? undefined : `rgba(20,70,110,${(0.04 + 0.34 * share).toFixed(2)})`
}
