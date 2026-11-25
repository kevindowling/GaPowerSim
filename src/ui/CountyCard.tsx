import type { GameState } from '../engine/types.ts'
import type { HexGrid } from '../engine/geo/mapTypes.ts'
import { ENV_SOURCES } from '../data/emissions.ts'
import type { EnvData } from '../data/loadEnv.ts'
import { countyEnvLines } from './environment.ts'
import { ratingOf } from '../engine/approval.ts'
import { countyStats } from '../engine/geo/countyStats.ts'
import { BUILT_UP } from '../engine/turn/siting.ts'
import { ApprovalBody } from './ApprovalCard.tsx'
import { money, mw, plural } from './format.ts'
import { TERRAIN_NAMES } from './terrain.ts'

const pct = (v: number): string => (v > 0 && v < 0.01 ? 'under 1%' : `${Math.round(v * 100)}%`)

export function CountyCard({ game, grid, fips, env, onRun }: {
  game: GameState
  grid: HexGrid
  fips: string
  env: EnvData | null
  onRun: (fips: string, id: string) => void
}) {
  const county = game.counties[fips]
  if (!county) return null
  const rated = ratingOf(game, fips) !== null
  const stats = countyStats(grid, fips, BUILT_UP)
  const plants = game.plants.filter((p) => p.countyFips === fips)
  const easements = game.corridors.flatMap((c) => Object.entries(c.deals)
    .filter(([id]) => c.parcels[id]?.countyFips === fips))
  const done = easements.filter(([, d]) => d.status === 'accepted' || d.status === 'condemned')
  const condemned = easements.filter(([, d]) => d.status === 'condemned' || d.status === 'condemning').length
  const paid = done.reduce((n, [, d]) => n + d.paid, 0)

  return (
    <>
      {rated ? <ApprovalBody game={game} fips={fips} onRun={onRun} /> : (
        <p className="note">
          Not next to a data center you supply, so it has no rating.
        </p>
      )}

      <h3>Your project here</h3>
      {plants.length === 0 && easements.length === 0 ? <p className="note">Nothing yet.</p> : (
        <dl className="rows">
          {plants.length > 0 && (
            <div><dt>Plants</dt><dd>{plural(plants.length, 'unit')}, {mw(plants.reduce((n, p) => n + p.nameplateMw, 0))}</dd></div>
          )}
          {easements.length > 0 && <div><dt>Easements settled</dt><dd>{done.length} of {easements.length}</dd></div>}
          {paid > 0 && <div><dt>Paid to landowners</dt><dd>{money(paid)}</dd></div>}
          {condemned > 0 && <div><dt>Condemned</dt><dd className="tone-bad">{condemned}</dd></div>}
        </dl>
      )}

      {env?.counties[fips] && (
        <>
          <h3>Air and water</h3>
          {[...countyEnvLines(env.counties[fips], 'air'), ...countyEnvLines(env.counties[fips], 'water')]
            .map((l) => <p key={l} className="note">{l}.</p>)}
          <ul className="sources fine">
            {ENV_SOURCES.slice(0, 3).map((s) => (
              <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer noopener">{s.label}</a></li>
            ))}
          </ul>
        </>
      )}

      {stats && (
        <>
          <h3>About the county</h3>
          <dl className="rows">
            <div><dt>Terrain</dt><dd>{TERRAIN_NAMES[stats.terrain]}</dd></div>
            <div><dt>Area</dt><dd>{Math.round(stats.areaKm2).toLocaleString()} km²</dd></div>
            <div><dt>Average land value</dt><dd>${Math.round(stats.landValue).toLocaleString()} an acre</dd></div>
            <div><dt>Built up</dt><dd>{pct(stats.builtUp)}</dd></div>
            {stats.park > 0 && <div><dt>Protected land</dt><dd>{pct(stats.park)}</dd></div>}
            {stats.water > 0 && <div><dt>Open water</dt><dd>{pct(stats.water)}</dd></div>}
          </dl>
        </>
      )}
    </>
  )
}
