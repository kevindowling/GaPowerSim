import { useState } from 'react'
import type { GameState } from '../engine/types.ts'
import type { CashPoint } from '../engine/cashForecast.ts'
import { formatQuarter, quarterInYear } from '../engine/time.ts'
import { money } from './format.ts'

const W = 356
const H = 150
const BOTTOM = 18

/** Cash at the end of each quarter, past and to come. */
export function CashChart({ game, forecast }: { game: GameState; forecast: readonly CashPoint[] }) {
  const [over, setOver] = useState<number | null>(null)
  const past = (game.cashHistory ?? []).slice(-10)
  const bars = [
    ...past.map((p) => ({ quarter: p.quarter, cash: p.cash, real: true })),
    ...forecast.map((p) => ({ quarter: p.quarter, cash: p.cash, real: false })),
  ]
  if (bars.length === 0) return null
  const top = Math.max(0, ...bars.map((b) => b.cash))
  const low = Math.min(0, ...bars.map((b) => b.cash), -game.creditLimit)
  const y = (v: number): number => 10 + ((top - v) / Math.max(1, top - low)) * (H - BOTTOM - 16)
  const slot = W / bars.length
  const bar = Math.min(14, slot - 2)
  const hit = over === null ? null : bars[over]
  const rows = over === null ? [] : over < past.length
    ? [] : forecast[over - past.length].rows.slice(0, 4)

  return (
    <figure className="chart power-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cash by quarter. The table has the same numbers." onMouseLeave={() => setOver(null)}>
        {bars.map((b, i) => (
          <g key={b.quarter}>
            <rect x={i * slot + (slot - bar) / 2} width={bar} y={Math.min(y(0), y(b.cash))} height={Math.max(1, Math.abs(y(b.cash) - y(0)))}
              className={b.cash < -game.creditLimit ? 'cc-broke' : b.real ? 'cc-real' : 'cc-next'} />
            {quarterInYear(b.quarter) === 1 && <text x={i * slot + slot / 2} y={H - 4} className="pc-label">{formatQuarter(b.quarter).slice(0, 4)}</text>}
            <rect x={i * slot} width={slot} y={0} height={H - BOTTOM} className="pc-hit" onMouseEnter={() => setOver(i)} />
          </g>
        ))}
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="pc-need" />
        <line x1={0} x2={W} y1={y(-game.creditLimit)} y2={y(-game.creditLimit)} className="cc-limit" />
        <text x={2} y={y(-game.creditLimit) - 4} className="pc-label start">Lenders stop at {money(-game.creditLimit)}</text>
      </svg>
      {hit && (
        <div className="pc-tip" style={{ left: `${Math.min(58, Math.max(0, ((over! * slot) / W) * 100 - 15))}%` }}>
          <strong>{formatQuarter(hit.quarter)}</strong>
          <span>{money(hit.cash)}{hit.real ? '' : ', forecast'}</span>
          {rows.map((r) => <span key={r.label}>{r.label} {r.amount > 0 ? '+' : ''}{money(r.amount)}</span>)}
        </div>
      )}
      <figcaption><span className="key cc-real" /> So far <span className="key cc-next" /> Forecast</figcaption>
    </figure>
  )
}
