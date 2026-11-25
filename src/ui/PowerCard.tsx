import { useState } from 'react'
import type { GameState } from '../engine/types.ts'
import type { PowerForecast } from '../engine/forecast.ts'
import { LAND_QUARTERS, landQuartersLeft, plantArrival, plantFinish } from '../engine/forecast.ts'
import { formatQuarter, quarterInYear } from '../engine/time.ts'
import { Icon } from './Icon.tsx'
import { focusForecast, type Focus } from '../engine/focus.ts'
import { PhaseTable } from './Progress.tsx'
import { plannedWithoutLargest } from '../engine/realtime/network.ts'
import { FIRM_MEANING, limitText } from './power.ts'
import { mw, quarters } from './format.ts'

const W = 356
const H = 120
const BASE = 100
const LEFT = 4

export function PowerCard({ game, focus, forecast, onClose }: {
  game: GameState
  focus: Focus
  forecast: PowerForecast
  onClose: () => void
}) {
  const main = focus.id === 'main'
  const need = focus.needMw
  const deadline = focus.deadline
  const { points } = forecast
  const { now, plannedMw, readyQuarter, arriving, phases } = focusForecast(forecast, focus)
  const late = readyQuarter === null || deadline === null ? 0 : readyQuarter - deadline
  const { count, mwEach } = focus
  const last = points[points.length - 1].flow
  const out = main ? plannedWithoutLargest(game) : null
  const held = plannedMw + 0.5 >= need ? [] : [...new Set([...last.plants.values()]
    .flatMap((p) => (p.limit ? [limitText(game, p.limit)] : [])))]
  const steps = points.filter((p) => p.finishing.length > 0)

  return (
    <section className="power-card" role="dialog" aria-label="Power forecast">
      <div className="inspector-head">
        <h2>Power at {focus.name}</h2>
        <button className="btn ghost icon-only" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      </div>
      <p className={readyQuarter !== null && late <= 0 ? 'tone-good' : 'tone-warn'}>
        {!focus.signed ? `You have not signed it. It wants ${need > 0 ? mw(need) : 'power, but has not said how much'}.`
          : plannedMw < 0.5 && game.plants.length === 0 && focus.spareMw === 0
            ? `Nothing filed. It needs ${mw(need)} of firm power${deadline === null ? '' : ` by ${formatQuarter(deadline)}`}.`
          : readyQuarter === null
            ? `What you have filed brings ${mw(plannedMw)} of the ${mw(need)} needed${deadline === null ? '' : ` by ${formatQuarter(deadline)}`}.`
          : late > 0 ? `${mw(need)} arrives in ${formatQuarter(readyQuarter)}, ${quarters(late)} late.`
          : `${mw(need)} arrives in ${formatQuarter(readyQuarter)}.${deadline === null ? '' : ` The last phase is due ${formatQuarter(deadline)}.`}`}
      </p>
      {held.length > 0 && (
        <ul className="advice">{held.map((t) => <li key={t}>{t}</li>)}</ul>
      )}
      {out && out.mw + 0.5 < need && (
        <p className="note tone-warn">
          When {out.name} trips, {mw(out.mw)} of {mw(need)} is left. Plants trip several times in the operating year, and
          each MWh short costs ${game.contract.shortfallPenaltyPerMwh.toLocaleString()}. Imports cover part of it.
        </p>
      )}
      <p className="note">{FIRM_MEANING}</p>

      {need > 0 && <Chart forecast={forecast} arriving={arriving} idle={main && (game.customers ?? []).length === 0} need={need} deadline={deadline} mwEach={mwEach} />}

      {focus.signed && <PhaseTable game={game} focus={focus} phases={phases} />}
      {focus.signed && count > 1 && (
        <p className="note">
          Each phase turns on when its {mw(mwEach)} arrives. Its payment shrinks 10% for each quarter late, and it buys power from the next quarter.
          {main && ` The operating year starts with all ${count} on.`}
        </p>
      )}

      {steps.length > 0 && (
        <table className="power-table">
          <thead><tr><th>Quarter</th><th>What finishes</th><th className="num">Arriving</th></tr></thead>
          <tbody>
            <tr><td>Now</td><td /><td className="num">{mw(now)}</td></tr>
            {steps.map((p) => (
              <tr key={p.quarter}>
                <td>{formatQuarter(p.quarter!)}</td>
                <td>{p.finishing.join(', ')}</td>
                <td className="num">{mw(p.flow.loads.get(focus.id) ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {game.plants.length > 0 && (
        <table className="power-table">
          <thead><tr><th>Plant</th><th>Finished</th><th className="num">Firm</th><th className="num">Will arrive</th></tr></thead>
          <tbody>
            {game.plants.map((p) => {
              const end = points[points.length - 1].flow.plants.get(p.id)
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.status === 'online' ? 'Yes' : formatQuarter(plantFinish(game, p))}</td>
                  <td className="num">{mw(end?.firmMw ?? 0)}</td>
                  <td className="num">{mw(plantArrival(forecast, p.id).mw)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <p className="fine">Dates assume no delays. Imports are not counted.</p>
      {forecast.landAssumed.length > 0 && (
        <p className="fine">
          Land is assumed to take {LAND_QUARTERS} quarters from filing a line, less if owners sign early.{' '}
          {forecast.landAssumed.map((c) => {
            const left = landQuartersLeft(game, c)
            return left === null
              ? `${c.name} crosses land that cannot be bought, so it is left out. `
              : `${c.name}: settled by ${formatQuarter(game.quarter + left - 1)}. `
          })}
        </p>
      )}
    </section>
  )
}

function Chart({ forecast, arriving, idle: showIdle, need, deadline, mwEach }: {
  forecast: PowerForecast
  arriving: readonly number[]
  /** Whether finished plants that deliver nothing are drawn. */
  idle: boolean
  need: number
  deadline: number | null
  mwEach: number
}) {
  const [over, setOver] = useState<number | null>(null)
  const { points } = forecast
  const slot = (W - LEFT * 2) / points.length
  const bar = Math.min(16, slot - 3)
  const top = Math.max(need * 1.15, ...arriving, ...(showIdle ? points.map((p) => p.finishedMw) : []))
  const y = (v: number): number => BASE - (v / top) * (BASE - 14)
  const at = deadline === null ? -1 : points.findIndex((p) => p.quarter === deadline)
  const hit = over === null ? null : points[over]

  return (
    <figure className="chart power-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Firm power by quarter. The table below has the same numbers."
        onMouseLeave={() => setOver(null)}>
        <line x1={0} x2={W} y1={BASE} y2={BASE} className="pc-axis" />
        {Array.from({ length: Math.ceil(need / mwEach) - 1 }, (_, i) => (
          <line key={i} x1={0} x2={W} y1={y((i + 1) * mwEach)} y2={y((i + 1) * mwEach)} className="pc-axis" />
        ))}
        {points.map((p, i) => {
          const x = LEFT + i * slot + (slot - bar) / 2
          const mwIn = arriving[i]
          const idle = showIdle ? p.finishedMw - mwIn : 0
          return (
            <g key={p.quarter ?? 'now'}>
              {mwIn > 0.5 && <rect x={x} width={bar} y={y(mwIn)} height={BASE - y(mwIn)} className="pc-arriving" />}
              {idle > 0.5 && <rect x={x} width={bar} y={y(p.finishedMw)} height={Math.max(1, y(mwIn) - y(p.finishedMw) - 2)} className="pc-idle" />}
              {(p.quarter === null || quarterInYear(p.quarter) === 1) && (
                <text x={LEFT + i * slot + slot / 2} y={H - 6} className="pc-label">{p.quarter === null ? 'Now' : formatQuarter(p.quarter).slice(0, 4)}</text>
              )}
              <rect x={LEFT + i * slot} width={slot} y={0} height={BASE} className="pc-hit" onMouseEnter={() => setOver(i)} />
            </g>
          )
        })}
        <line x1={0} x2={W} y1={y(need)} y2={y(need)} className="pc-need" />
        <text x={2} y={y(need) - 4} className="pc-label start">{mw(need)} needed</text>
        {at >= 0 && (
          <>
            <line x1={LEFT + (at + 1) * slot} x2={LEFT + (at + 1) * slot} y1={0} y2={BASE} className="pc-need" />
            <text x={LEFT + (at + 1) * slot - 4} y={9} className="pc-label end">Deadline</text>
          </>
        )}
      </svg>
      {hit && (
        <div className="pc-tip" style={{ left: `${Math.min(62, Math.max(0, ((LEFT + over! * slot) / W) * 100 - 18))}%` }}>
          <strong>{hit.quarter === null ? 'Now' : formatQuarter(hit.quarter)}</strong>
          <span>{mw(arriving[over!])} arriving</span>
          {showIdle && hit.finishedMw - arriving[over!] > 0.5 && <span>{mw(hit.finishedMw - arriving[over!])} finished, not arriving</span>}
          {hit.finishing.length > 0 && <span>{hit.finishing.join(', ')}</span>}
        </div>
      )}
      <figcaption>
        <span className="key pc-arriving" /> Arriving {showIdle && <><span className="key pc-idle" /> Finished, not arriving</>}
      </figcaption>
    </figure>
  )
}
