import type { GameState } from '../../engine/types.ts'
import type { RealtimeState, Speed, SheddingPolicy } from '../../engine/realtime/types.ts'
import { TICKS_PER_HOUR } from '../../engine/realtime/types.ts'
import { hourOfDay, dayOfYear } from '../../engine/realtime/load.ts'
import { reliabilityIndices } from '../../engine/realtime/operate.ts'
import { lineClass } from '../../data/transmission.ts'
import { money, mw } from '../format.ts'

interface Props {
  game: GameState
  rt: RealtimeState
  onSpeed: (speed: Speed) => void
  onPolicy: (policy: SheddingPolicy) => void
  onVegetation: (value: number) => void
  onMaintenance: (value: boolean) => void
}

const SPEEDS: Array<{ value: Speed; label: string }> = [
  { value: 0, label: '❚❚' },
  { value: 1, label: '1×' },
  { value: 2, label: '2×' },
  { value: 4, label: '4×' },
]

const POLICIES: Array<{ id: SheddingPolicy; label: string; blurb: string }> = [
  {
    id: 'protect-homes',
    label: 'Homes first',
    blurb: 'Curtail the campus before the neighbourhood. You eat the penalties.',
  },
  {
    id: 'proportional',
    label: 'Share it',
    blurb: 'Everyone loses the same fraction.',
  },
  {
    id: 'protect-contract',
    label: 'Contract first',
    blurb: 'Keep the campus whole. The lights go off in Sumter County instead.',
  },
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function stamp(tick: number): string {
  const d = dayOfYear(tick)
  const h = hourOfDay(tick)
  const month = MONTHS[Math.min(11, Math.floor(d / 30.4))]
  const day = Math.floor(d % 30.4) + 1
  const hh = String(Math.floor(h)).padStart(2, '0')
  const mm = String(Math.round((h % 1) * 60)).padStart(2, '0')
  return `${month} ${day} · ${hh}:${mm}`
}

/**
 * The control room.
 *
 * Build phase was about a deadline. This is about whether the thing you built
 * holds — so the numbers that lead are load against served, and what it is
 * costing you per hour to keep the difference at zero.
 */
export function DispatchPanel({
  game, rt, onSpeed, onPolicy, onVegetation, onMaintenance,
}: Props) {
  const latest = rt.history[rt.history.length - 1]
  const idx = reliabilityIndices(rt)
  const shortfall = latest ? latest.unservedMw : 0

  return (
    <section className="panel">
      <h2 className="panel-title">Operations</h2>

      <div className="clock-row">
        <span className="clock">{stamp(rt.tick)}</span>
        <div className="seg" role="group" aria-label="Simulation speed">
          {SPEEDS.map((s) => (
            <button
              key={s.value}
              className={rt.speed === s.value ? 'seg-btn on' : 'seg-btn'}
              onClick={() => onSpeed(s.value)}
              aria-pressed={rt.speed === s.value}
              aria-label={s.value === 0 ? 'Pause' : `${s.value} times speed`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {latest && (
        <>
          <div className={shortfall > 0.5 ? 'now-card short' : 'now-card'}>
            <div className="now-main">
              <span className="now-value">{mw(latest.servedMw)}</span>
              <span className="now-of">served of {mw(latest.loadMw)}</span>
            </div>
            {shortfall > 0.5 && (
              <div className="now-short">{mw(shortfall)} not delivered</div>
            )}
            <StackBar record={latest} />
          </div>

          <dl className="kv">
            <dt>Campus</dt><dd>{mw(latest.contractMw)}</dd>
            <dt>Homes &amp; business</dt><dd>{mw(latest.customerMw)}</dd>
            <dt>Own generation</dt><dd>{mw(latest.generationMw)}</dd>
            <dt>Bought in</dt><dd>{mw(latest.marketMw)}</dd>
            <dt>Price</dt>
            <dd className={latest.priceMwh > 120 ? 'tone-bad' : ''}>
              ${Math.round(latest.priceMwh)}/MWh
            </dd>
          </dl>

          <LoadChart history={rt.history} />
        </>
      )}

      <h3 className="panel-sub">Transfer capability</h3>
      <ul className="line-status">
        {game.corridors.filter((c) => c.status === 'energized').map((c) => {
          const cls = lineClass(c.classId)
          const outage = rt.outages.find((o) => o.assetId === c.id)
          const fraction = outage ? outage.capacityFraction : 1
          return (
            <li key={c.id}>
              <span className={`dot ${fraction === 0 ? 'dot-outage' : fraction < 1 ? 'dot-construction' : 'dot-online'}`} />
              <span className="line-name">{cls.name}</span>
              <span className="line-mw">
                {fraction === 0 ? 'down' : mw(cls.ratingMw * fraction)}
                {fraction > 0 && fraction < 1 && ' (one circuit)'}
              </span>
            </li>
          )
        })}
      </ul>

      {rt.outages.length > 0 && (
        <>
          <h3 className="panel-sub">Faults</h3>
          <ul className="outage-list">
            {rt.outages.map((o, i) => {
              const name = o.kind === 'plant'
                ? game.plants.find((p) => p.id === o.assetId)?.name ?? 'Unit'
                : lineClass(game.corridors.find((c) => c.id === o.assetId)!.classId).name
              const hoursLeft = Math.ceil(o.ticksRemaining / TICKS_PER_HOUR)
              return (
                <li key={i}>
                  <div className="outage-head">
                    <span className="outage-name">{name}</span>
                    <span className="outage-eta">{hoursLeft}h</span>
                  </div>
                  <div className="outage-meta">
                    {o.cause}
                    {o.crews > 0
                      ? ` · ${o.crews} crew${o.crews === 1 ? '' : 's'} working`
                      : ' · no crew assigned'}
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="panel-note">
            {rt.crewsTotal} crews. A downed line strands the whole campus, so it goes first.
          </p>
        </>
      )}

      {rt.storms.length > 0 && (
        <p className="panel-note tone-warn">
          {rt.storms.length === 1 ? 'A storm is' : `${rt.storms.length} storms are`} moving
          across the service area.
        </p>
      )}

      <h3 className="panel-sub">When there isn't enough</h3>
      <div className="policy-picker" role="radiogroup" aria-label="Curtailment policy">
        {POLICIES.map((p) => (
          <button
            key={p.id}
            className={rt.policy === p.id ? 'policy-btn on' : 'policy-btn'}
            onClick={() => onPolicy(p.id)}
            role="radio"
            aria-checked={rt.policy === p.id}
          >
            <span className="policy-label">{p.label}</span>
            <span className="policy-blurb">{p.blurb}</span>
          </button>
        ))}
      </div>

      <h3 className="panel-sub">Maintenance</h3>
      <label className="slider-row">
        <span>Vegetation management</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={rt.vegetationSpend}
          onChange={(e) => onVegetation(Number(e.target.value))}
        />
        <strong>{Math.round(rt.vegetationSpend * 100)}%</strong>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={rt.maintenanceDeferred}
          onChange={(e) => onMaintenance(e.target.checked)}
        />
        Defer maintenance
      </label>
      {rt.maintenanceDeferred && (
        <p className="panel-note tone-warn">
          Cheaper every quarter. Roughly doubles the rate at which units trip, starting now.
        </p>
      )}

      <h3 className="panel-sub">Since energization</h3>
      <dl className="kv">
        <dt>Days operated</dt><dd>{Math.round(idx.daysOperated)}</dd>
        <dt>Contract met</dt>
        <dd className={idx.contractAvailability < 0.999 ? 'tone-bad' : 'tone-good'}>
          {(idx.contractAvailability * 100).toFixed(3)}%
        </dd>
        <dt>SAIDI</dt>
        <dd className={idx.saidiMinutes > 120 ? 'tone-bad' : ''}>
          {Math.round(idx.saidiMinutes)} min/yr
        </dd>
        <dt>Fuel</dt><dd>{money(rt.fuelCost)}</dd>
        <dt>Purchases</dt><dd>{money(rt.marketCost)}</dd>
      </dl>
      {rt.unservedCustomerMwh > 0.1 && (
        <p className="panel-note tone-bad">
          {rt.unservedCustomerMwh.toFixed(0)} MWh of homes and businesses went unserved.
        </p>
      )}
    </section>
  )
}

/** How this interval's supply was made up. */
function StackBar({ record }: { record: { loadMw: number; generationMw: number; marketMw: number; unservedMw: number } }) {
  const total = Math.max(record.loadMw, 1e-6)
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / total) * 100))}%`
  return (
    <div className="stack-bar" role="img" aria-label="Supply mix">
      <span className="stack-gen" style={{ width: pct(record.generationMw) }} title="Own generation" />
      <span className="stack-market" style={{ width: pct(record.marketMw) }} title="Market purchases" />
      <span className="stack-unserved" style={{ width: pct(record.unservedMw) }} title="Unserved" />
    </div>
  )
}

/**
 * Two days of load and what was served against it, drawn inline.
 *
 * A gap between the two lines is the whole story of the operate phase, so the
 * chart's job is to make that gap impossible to miss.
 */
function LoadChart({ history }: { history: RealtimeState['history'] }) {
  if (history.length < 2) return null
  const w = 260
  const h = 56
  const maxMw = Math.max(...history.map((r) => r.loadMw)) * 1.1
  const x = (i: number) => (i / (history.length - 1)) * w
  const y = (v: number) => h - (v / maxMw) * h

  const line = (pick: (r: typeof history[number]) => number) =>
    history.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(pick(r)).toFixed(1)}`).join(' ')

  return (
    <svg className="load-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Load and served power over the last two days">
      <path d={`${line((r) => r.loadMw)} L${w},${h} L0,${h} Z`} className="chart-load-fill" />
      <path d={line((r) => r.loadMw)} className="chart-load" />
      <path d={line((r) => r.servedMw)} className="chart-served" />
    </svg>
  )
}
