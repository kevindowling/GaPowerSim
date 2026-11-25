import { useMemo } from 'react'
import type { GameState } from '../engine/types.ts'
import { committedCapex, headroom } from '../engine/state.ts'
import { ledger } from '../engine/ledger.ts'
import { cashForecast, lastQuarter, LAND_MULTIPLE } from '../engine/cashForecast.ts'
import { formatQuarter } from '../engine/time.ts'
import { CashChart } from './CashChart.tsx'
import { Icon } from './Icon.tsx'
import { money } from './format.ts'

export function MoneyCard({ game, onClose, onFocus }: { game: GameState; onClose: () => void; onFocus: (id: string) => void }) {
  const l = ledger(game)
  const forecast = useMemo(() => cashForecast(game), [game])
  const last = lastQuarter(game)
  const low = forecast.reduce<(typeof forecast)[number] | null>((m, p) => (!m || p.cash < m.cash ? p : m), null)
  return (
    <section className="power-card" role="dialog" aria-label="Money">
      <div className="inspector-head">
        <h2>Cash</h2>
        <button className="btn ghost icon-only" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      </div>
      <dl className="rows">
        <div><dt>Now, and your score</dt><dd className={game.cash < 0 ? 'tone-bad' : ''}>{money(game.cash)}</dd></div>
        <div><dt>Lenders stop at</dt><dd>{money(-game.creditLimit)}</dd></div>
        <div><dt>Still owed on what you have ordered</dt><dd>{money(committedCapex(game))}</dd></div>
        <div><dt>Payments still to come, if on time</dt><dd>{money(l.toCome)}</dd></div>
        <div><dt>Left if all of that happens</dt><dd className={headroom(game) < 0 ? 'tone-bad' : ''}>{money(headroom(game))}</dd></div>
      </dl>
      <p className="note">The last line leaves out land, running costs, interest and what plants will earn.</p>

      <h3>By data center</h3>
      <table className="power-table">
        <thead><tr><th>Data center</th><th className="num">In</th><th className="num">Spent</th><th className="num">So far</th><th className="num">To come</th></tr></thead>
        <tbody>
          {l.perCenter.filter((r) => r.id !== 'main' || game.contract.status !== 'offered').map((r) => (
            <tr key={r.id}>
              <td className="wrap"><button className="sited-name" onClick={() => { onFocus(r.id); onClose() }}>{r.name}</button></td>
              <td className="num">{money(r.paid + r.sold)}</td>
              <td className="num">{money(-r.spent)}</td>
              <td className={r.paid + r.sold - r.spent < 0 ? 'num tone-bad' : 'num'}>{money(r.paid + r.sold - r.spent)}</td>
              <td className="num">{money(r.toCome)}</td>
            </tr>
          ))}
          {(game.startingBudget ?? 0) > 0 && (
            <tr>
              <td className="wrap">Starting budget</td><td className="num">{money(game.startingBudget!)}</td><td /><td className="num">{money(game.startingBudget!)}</td><td />
            </tr>
          )}
          <tr>
            <td className="wrap">Shared</td><td /><td className="num">{money(-l.shared)}</td><td className="num">{money(-l.shared)}</td><td />
          </tr>
          <tr className="total">
            <td className="wrap">Total</td>
            <td className="num">{money((game.startingBudget ?? 0) + l.perCenter.reduce((n, r) => n + r.paid + r.sold, 0))}</td>
            <td className="num">{money(-l.shared - l.perCenter.reduce((n, r) => n + r.spent, 0))}</td>
            <td className="num">{money(game.cash)}</td>
            <td className="num">{money(l.toCome)}</td>
          </tr>
        </tbody>
      </table>

      <p className="fine">Plants are split by the power each one delivers. Shared covers plants not yet delivering, upkeep, interest, community work and events.</p>

      <h3>Cash by quarter</h3>
      <CashChart game={game} forecast={forecast} />
      {low && low.cash < 0 && (
        <p className={low.cash < -game.creditLimit ? 'tone-bad' : 'note'}>
          {low.cash < -game.creditLimit
            ? `You run out of credit in ${formatQuarter(forecast.find((p) => p.cash < -game.creditLimit)!.quarter)}.`
            : `The lowest point is ${money(low.cash)} in ${formatQuarter(low.quarter)}.`}
        </p>
      )}
      <div className="table-scroll">
        <table className="power-table">
          <thead><tr><th>Quarter</th><th className="num">In</th><th className="num">Out</th><th className="num">Cash</th></tr></thead>
          <tbody>
            {forecast.map((p) => (
              <tr key={p.quarter}>
                <td>{formatQuarter(p.quarter)}</td>
                <td className="num">{money(p.rows.reduce((n, r) => n + Math.max(0, r.amount), 0))}</td>
                <td className="num">{money(p.rows.reduce((n, r) => n + Math.min(0, r.amount), 0))}</td>
                <td className={p.cash < 0 ? 'num tone-bad' : 'num'}>{money(p.cash)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fine">
        If nothing slips, nothing else is ordered and no events happen. Land still to buy is taken at {LAND_MULTIPLE} times its appraisal.
      </p>

      {last && last.rows.length > 0 && (
        <>
          <h3>What changed in {formatQuarter(last.quarter)}</h3>
          <dl className="rows">
            {last.rows.map((r) => (
              <div key={r.label}><dt>{r.label}</dt><dd className={r.amount > 0 ? 'tone-good' : 'tone-bad'}>{r.amount > 0 ? '+' : ''}{money(r.amount)}</dd></div>
            ))}
          </dl>
        </>
      )}

      <h3>Where it came from</h3>
      <dl className="rows">{l.received.map((r) => <div key={r.label}><dt>{r.label}</dt><dd>{money(r.amount)}</dd></div>)}</dl>
      <h3>Where it went</h3>
      <dl className="rows">{l.spent.map((r) => <div key={r.label}><dt>{r.label}</dt><dd>{money(-r.amount)}</dd></div>)}</dl>
    </section>
  )
}
