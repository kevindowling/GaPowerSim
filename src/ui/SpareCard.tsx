import { useState } from 'react'
import type { GameState } from '../engine/types.ts'
import { activeCustomers, spareLeft } from '../engine/customers.ts'
import { LARGE_LOAD, POOL, poolAt, SPARE, SPARE_SOURCES, spareAt } from '../data/sparePower.ts'
import { byGeorgiaPower, inGeorgia, isActive, type DataCenter } from '../data/dataCenters.ts'
import { Icon } from './Icon.tsx'
import { mw } from './format.ts'

const W = 356
const H = 132
const signed = (v: number): string => `${v > 0 ? '+' : ''}${Math.round(v).toLocaleString()} MW`

export function SpareCard({ game, list, onClose }: {
  game: GameState
  list: readonly DataCenter[]
  onClose: () => void
}) {
  const [over, setOver] = useState<number | null>(null)
  const now = spareAt(game.quarter)
  const left = spareLeft(game)
  const used = [
    { name: game.contract.name, mw: game.mainSpareMw ?? 0 },
    ...activeCustomers(game).map((c) => ({ name: c.name, mw: c.spareMw })),
  ].filter((u) => u.mw > 0)
  const asking = list.filter((d) => inGeorgia(d) && byGeorgiaPower(d) && isActive(d) && d.status !== 'operating' && d.mw !== null)
  const top = Math.max(...SPARE.map((s) => Math.max(s.winter, s.summer)))
  const low = Math.min(...SPARE.map((s) => Math.min(s.winter, s.summer)))
  const y = (v: number): number => 10 + ((top - v) / (top - low)) * (H - 40)
  const slot = W / SPARE.length

  return (
    <section className="power-card" role="dialog" aria-label="Spare power">
      <div className="inspector-head">
        <h2>Georgia Power spare power</h2>
        <button className="btn ghost icon-only" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      </div>
      <p className={left >= 0 ? 'tone-good' : 'tone-bad'}>
        {left >= 0 ? `${mw(left)} left to share out.` : `${mw(-left)} more is set aside than there is. It is bought at twice the price.`}
      </p>
      <dl className="rows">
        <div><dt>Spare before any new data center</dt><dd>{mw(poolAt(game.quarter))}</dd></div>
        {used.map((u) => <div key={u.name}><dt>{u.name}</dt><dd>{mw(u.mw)}</dd></div>)}
      </dl>
      <p className="note">Set it aside on each data center's card.</p>
      <table className="power-table">
        <thead><tr><th>Winter</th>{POOL.map((p) => <th key={p.year} className="num">{p.year}</th>)}</tr></thead>
        <tbody><tr><td>MW</td>{POOL.map((p) => <td key={p.year} className="num">{p.mw.toLocaleString()}</td>)}</tr></tbody>
      </table>
      <p className="note">That counts only customers with contracts in October 2025, and every plant approved since.</p>
      <h3>Georgia Power's own forecast</h3>
      <p className="note">
        It also expects many of these data centers to sign, which leaves {now.mw > 0 ? `${mw(now.mw)} above` : `${mw(-now.mw)} below`} the reserve target in {now.season}.
      </p>
      <figure className="chart power-chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Spare power by year. The table has the same numbers." onMouseLeave={() => setOver(null)}>
          {SPARE.map((s, i) => (
            <g key={s.year}>
              {([['winter', s.winter], ['summer', s.summer]] as const).map(([k, v], n) => (
                <rect key={k} x={i * slot + slot / 2 - 17 + n * 18} width={16}
                  y={Math.min(y(0), y(v))} height={Math.max(1, Math.abs(y(v) - y(0)))} className={`sp-${k}`} />
              ))}
              <text x={i * slot + slot / 2} y={H - 4} className="pc-label">{s.year}</text>
              <rect x={i * slot} width={slot} y={0} height={H} className="pc-hit" onMouseEnter={() => setOver(i)} />
            </g>
          ))}
          <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="pc-need" />
        </svg>
        {over !== null && (
          <div className="pc-tip" style={{ left: `${Math.min(60, over * (100 / SPARE.length))}%` }}>
            <strong>{SPARE[over].year}</strong>
            <span>Winter {signed(SPARE[over].winter)}</span>
            <span>Summer {signed(SPARE[over].summer)}</span>
          </div>
        )}
        <figcaption><span className="key sp-winter" /> Winter peak <span className="key sp-summer" /> Summer peak</figcaption>
      </figure>
      <table className="power-table">
        <thead><tr><th>Year</th><th className="num">Winter</th><th className="num">Summer</th></tr></thead>
        <tbody>
          {SPARE.map((s) => (
            <tr key={s.year}>
              <td>{s.year}</td>
              <td className={s.winter < 0 ? 'num tone-bad' : 'num'}>{signed(s.winter)}</td>
              <td className={s.summer < 0 ? 'num tone-bad' : 'num'}>{signed(s.summer)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>What wants it</h3>
      <dl className="rows">
        <div><dt>Listed data centers, not yet running</dt><dd>{mw(asking.reduce((n, d) => n + (d.mw ?? 0), 0))}</dd></div>
        <div><dt>All large customers asking</dt><dd>{mw(LARGE_LOAD.asking)}</dd></div>
        <div><dt>Committed, {LARGE_LOAD.customers} customers</dt><dd>{mw(LARGE_LOAD.committed)}</dd></div>
        <div><dt>Committed and under way</dt><dd>{mw(LARGE_LOAD.underway)}</dd></div>
      </dl>
      <p className="fine">
        Spare power is capacity less requirement in <a href={SPARE_SOURCES[0].url} target="_blank" rel="noreferrer noopener">{SPARE_SOURCES[0].label}</a>,
        with the 9,885 MW approved in December 2025. Large customers are from Georgia Power's report of 16 Nov 2026.
      </p>
    </section>
  )
}
