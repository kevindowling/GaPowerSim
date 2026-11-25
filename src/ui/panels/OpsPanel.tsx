import type { GameState } from '../../engine/types.ts'
import type { RealtimeState, SheddingPolicy } from '../../engine/realtime/types.ts'
import { TICKS_PER_HOUR } from '../../engine/realtime/types.ts'
import {
  reliabilityIndices, standingCosts, MAX_CREWS, MIN_CREWS, CREW_COST_PER_YEAR,
} from '../../engine/realtime/operate.ts'
import { ledger } from '../../engine/ledger.ts'
import { transformerName } from '../../engine/realtime/reliability.ts'
import { lineClass } from '../../data/transmission.ts'
import { money, mw } from '../format.ts'

interface Props {
  game: GameState
  rt: RealtimeState
  onPolicy: (policy: SheddingPolicy) => void
  onVegetation: (value: number) => void
  onMaintenance: (value: boolean) => void
  onCrews: (n: number) => void
  onPrioritize: (assetId: string) => void
}

const POLICIES: Array<{ id: SheddingPolicy; label: string; blurb: string }> = [
  { id: 'protect-homes', label: 'Homes first', blurb: 'The campus is cut before any home.' },
  { id: 'proportional', label: 'Share it', blurb: 'Both lose the same fraction where the lines allow.' },
  { id: 'protect-contract', label: 'Campus first', blurb: 'Homes are cut to keep the campus running.' },
]

export function OpsPanel({ game, rt, onPolicy, onVegetation, onMaintenance, onCrews, onPrioritize }: Props) {
  const now = rt.history[rt.history.length - 1]
  const idx = reliabilityIndices(rt, game.system.servedPopulation)
  const cost = standingCosts(game)
  const books = ledger(game)
  const batteries = game.plants.some((p) => p.typeId === 'battery' && p.status === 'online')

  return (
    <div className="panel">
      <h2>Operations</h2>
      {!now && <p className="prompt">Pick a speed at the top to start the clock.</p>}
      {now && (
        <>
          <div className={now.unservedMw > 0.5 ? 'now short' : 'now'}>
            <span className="now-value">{mw(now.servedMw)}</span>
            <span>served of {mw(now.loadMw)}</span>
            {now.unservedMw > 0.5 && (
              <span className="now-short">
                {[now.unservedContractMw > 0.5 && `campus short ${mw(now.unservedContractMw)}`,
                  now.unservedCustomerMw > 0.5 && `homes short ${mw(now.unservedCustomerMw)}`]
                  .filter(Boolean).join(', ')}
              </span>
            )}
          </div>
          <LoadChart history={rt.history} />
          <dl className="rows">
            <div><dt>Campus</dt><dd>{mw(now.contractMw)}</dd></div>
            <div><dt>Homes and business</dt><dd>{mw(now.customerMw)}</dd></div>
            <div><dt>Your plants</dt><dd>{mw(now.generationMw)}</dd></div>
            <div><dt>Imports</dt><dd>{mw(now.marketMw)} of {mw(now.importLimitMw)}</dd></div>
            <div><dt>Market price</dt><dd className={now.priceMwh > 100 ? 'tone-bad' : ''}>${Math.round(now.priceMwh)} a MWh</dd></div>
            {batteries && <div><dt>Stored</dt><dd>{Math.round(now.storedMwh)} MWh</dd></div>}
          </dl>
        </>
      )}

      {rt.heatWave && (
        <p className="note tone-warn">
          {rt.heatWave.ticksUntil > 0
            ? `Heat wave in ${Math.ceil(rt.heatWave.ticksUntil / TICKS_PER_HOUR)} hours`
            : 'Heat wave'}, {Math.round(rt.heatWave.deltaC)}°C above normal.
        </p>
      )}
      {rt.storms.length > 0 && <p className="note tone-warn">Storms are on the map.</p>}
      {rt.demandResponse && (
        <p className="note">
          The campus will drop {mw(rt.demandResponse.mw)} on request. {Math.round(Math.max(0, rt.demandResponse.hoursLeft))} hours left.
        </p>
      )}

      {rt.outages.length > 0 && (
        <>
          <h3>Faults</h3>
          <ul className="faults">
            {rt.outages.map((o, i) => {
              const c = game.corridors.find((x) => x.id === o.assetId)
              const name = o.kind === 'plant'
                ? game.plants.find((p) => p.id === o.assetId)?.name ?? 'Unit'
                : o.kind === 'transformer' ? transformerName(game, o.assetId)
                : c?.name ?? 'Line'
              const hours = Math.ceil(o.ticksRemaining / Math.max(0.15, o.crews) / TICKS_PER_HOUR)
              return (
                <li key={`${o.assetId}-${i}`}>
                  <div className="line-head"><span>{name}</span><span className="num">{hours} h left</span></div>
                  <div className="note">
                    {o.cause}{o.capacityFraction > 0 && c && `, ${mw(lineClass(c.classId).ratingMw * o.capacityFraction)} still available`}
                    . {o.crews > 0 ? `${o.crews} on site.` : 'No crew.'}
                  </div>
                  <button className="btn small" aria-pressed={Boolean(o.priority)} onClick={() => onPrioritize(o.assetId)}>
                    {o.priority ? 'First in line' : 'Send crews here first'}
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <h3>When there is not enough power</h3>
      <div className="policies" role="radiogroup" aria-label="Who loses power first">
        {POLICIES.map((p) => (
          <button key={p.id} role="radio" aria-checked={rt.policy === p.id}
            className={rt.policy === p.id ? 'policy on' : 'policy'} onClick={() => onPolicy(p.id)}>
            <span>{p.label}</span><small>{p.blurb}</small>
          </button>
        ))}
      </div>

      <h3>Upkeep</h3>
      <label className="field">
        <span>Line clearing</span>
        <input type="range" min={0} max={1} step={0.05} value={rt.vegetationSpend}
          onChange={(e) => onVegetation(Number(e.target.value))} />
        <span className="num">{money(cost.vegetation)}/yr</span>
      </label>
      <div className="field">
        <span>Repair crews</span>
        <span className="stepper">
          <button className="btn small" aria-label="One fewer crew" disabled={rt.crewsTotal <= MIN_CREWS} onClick={() => onCrews(rt.crewsTotal - 1)}>-</button>
          <span className="num">{rt.crewsTotal}</span>
          <button className="btn small" aria-label="One more crew" disabled={rt.crewsTotal >= MAX_CREWS} onClick={() => onCrews(rt.crewsTotal + 1)}>+</button>
        </span>
        <span className="num">{money(rt.crewsTotal * CREW_COST_PER_YEAR)}/yr</span>
      </div>
      <label className="field check">
        <input type="checkbox" checked={rt.maintenanceDeferred} onChange={(e) => onMaintenance(e.target.checked)} />
        <span>Defer plant maintenance</span>
        <span className="num">{rt.maintenanceDeferred ? 'Trips 2.2×' : `${money(cost.maintenance)}/yr`}</span>
      </label>

      <h3>Year so far</h3>
      <dl className="rows">
        <div><dt>Campus availability</dt><dd className={idx.contractAvailability < 0.998 ? 'tone-bad' : 'tone-good'}>{(idx.contractAvailability * 100).toFixed(2)}%</dd></div>
        <div><dt>Home outages (SAIDI)</dt><dd className={idx.saidiMinutes > 60 ? 'tone-bad' : ''}>{Math.round(idx.saidiMinutes)} min/yr</dd></div>
      </dl>

      <h3>Money</h3>
      <dl className="rows">
        <div><dt>Cash</dt><dd className={game.cash < 0 ? 'tone-bad' : ''}>{money(game.cash)}</dd></div>
        {books.received.map((r) => <div key={r.label}><dt>{r.label}</dt><dd>{money(r.amount)}</dd></div>)}
        {books.spent.filter((r) => /Fuel|Spare|upkeep|Penalties|Interest/.test(r.label)).map((r) => (
          <div key={r.label}><dt>{r.label}</dt><dd>{money(-r.amount)}</dd></div>
        ))}
      </dl>
    </div>
  )
}

function LoadChart({ history }: { history: RealtimeState['history'] }) {
  if (history.length < 2) return null
  const w = 320
  const h = 70
  const max = Math.max(...history.map((r) => r.loadMw)) * 1.1
  const x = (i: number): string => ((i / (history.length - 1)) * w).toFixed(1)
  const y = (v: number): string => (h - (v / max) * h).toFixed(1)
  const path = (pick: (r: typeof history[number]) => number): string =>
    history.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(pick(r))}`).join('')
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Demand and power served over the last two days">
        <path d={`${path((r) => r.loadMw)}L${w},${h}L0,${h}Z`} className="c-demand-fill" />
        <path d={`${path((r) => r.servedMw)}L${w},${h}L0,${h}Z`} className="c-served-fill" />
        <path d={path((r) => r.loadMw)} className="c-demand" />
      </svg>
      <figcaption><span className="key demand" /> Demand <span className="key served" /> Served, last two days</figcaption>
    </figure>
  )
}
