import { useState } from 'react'
import type { Customer, GameState } from '../../engine/types.ts'
import { leaving } from '../../engine/leaving.ts'
import { mainOpen, openOffers, signBlocked, waitsUntil } from '../../engine/customers.ts'
import { approvalOf } from '../../engine/approval.ts'
import { phasesOn, phasing } from '../../engine/phases.ts'
import { firmFlow } from '../../engine/realtime/network.ts'
import { formatQuarter } from '../../engine/time.ts'
import { byGeorgiaPower, bySister, inServiceArea, isActive, type DataCenter } from '../../data/dataCenters.ts'
import { STATUS_TEXT } from '../DataCenterCard.tsx'
import { mw, plural, quarters } from '../format.ts'

type Scope = 'all' | 'gp' | 'un' | 'sis'

const SCOPES: Array<{ id: Scope; label: string; keep: (d: DataCenter) => boolean }> = [
  { id: 'all', label: 'All', keep: () => true },
  { id: 'gp', label: 'Georgia Power', keep: byGeorgiaPower },
  { id: 'un', label: 'Not published', keep: (d) => !byGeorgiaPower(d) && !bySister(d) },
  { id: 'sis', label: 'AL and MS', keep: bySister },
]

/** Soonest due first, finished ones last. */
function byNextDue(a: Customer, b: Customer): number {
  const due = (c: Customer): number => c.milestones.find((m) => !m.released && m.dueQuarter !== undefined)?.dueQuarter ?? 9999
  return due(a) - due(b) || b.contractedMw - a.contractedMw
}

/** When the next phase without power is due. */
function nextDue(c: Customer): string {
  const m = c.milestones.find((x) => !x.released && x.dueQuarter !== undefined)
  return m ? ` Next ${mw((m.phase ?? 1) * c.phaseMw)} due ${formatQuarter(m.dueQuarter!)}.` : ''
}

function signBy(game: GameState, closes: number): string {
  const left = closes - game.quarter
  return `Sign by ${formatQuarter(closes)}, ${left === 0 ? 'this quarter' : `${quarters(left)} left`}.`
}

function comesUp(game: GameState, id: string): string {
  const o = game.offers?.find((x) => x.id === id)
  return o ? o.opens > game.quarter ? ` Contract comes up ${formatQuarter(o.opens)}.` : ' Went to another supplier.' : ''
}

export function CustomersPanel({ game, focusId, list, onShow }: {
  game: GameState
  list: readonly DataCenter[]
  focusId: string
  onShow: (id: string) => void
}) {
  const [scope, setScope] = useState<Scope>('all')
  const [stopped, setStopped] = useState(false)
  const keep = SCOPES.find((s) => s.id === scope)!.keep
  const rows = list.filter((d) => inServiceArea(d) && keep(d) && (stopped || isActive(d)))
    .sort((a, b) => (b.mw ?? -1) - (a.mw ?? -1) || a.name.localeCompare(b.name))
  const flow = firmFlow(game)
  const signed = new Set((game.customers ?? []).map((c) => c.id))
  const offers = openOffers(game)
  const known = rows.filter((d) => d.mw !== null && isActive(d))

  return (
    <div className="panel">
      <h2>You supply</h2>
      <ul className="lines">
        {game.contract.status !== 'failed' && game.contract.status !== 'offered' && (
          <li className={focusId === 'main' ? 'line on' : 'line'}>
            <div className="line-head">
              <button className="sited-name" onClick={() => onShow('main')}>{game.contract.name}</button>
              <span className="num">{mw(flow.totalMw)} of {mw(game.contract.contractedMw)}</span>
            </div>
            <div className="note">
              {phasesOn(game)} of {phasing(game).count} phases on. Approval {Math.round(approvalOf(game))}.
            </div>
          </li>
        )}
        {[...(game.customers ?? [])].sort(byNextDue).map((c) => {
          return (
            <li key={c.id} className={focusId === c.id ? 'line on' : 'line'}>
              <div className="line-head">
                <button className="sited-name" onClick={() => onShow(c.id)}>{c.name}</button>
                <span className="num">{c.status === 'cancelled' ? 'Cancelled' : `${mw(flow.loads.get(c.id) ?? 0)} of ${mw(c.contractedMw)}`}</span>
              </div>
              {leaving(game, c.id) && <div className="note tone-bad">{leaving(game, c.id)}</div>}
              {c.status !== 'cancelled' && (
                <div className="note">
                  {c.phasesOn} of {c.phaseCount} phases on. Approval {Math.round(c.approval ?? 0)}.{nextDue(c)}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {(offers.length > 0 || mainOpen(game)) && (
        <>
          <h2>Contracts you can sign</h2>
          <ul className="lines">
            {mainOpen(game) && (
              <li className={focusId === 'main' ? 'line on' : 'line'}>
                <div className="line-head">
                  <button className="sited-name" onClick={() => onShow('main')}>{game.contract.name}</button>
                  <span className="num">{mw(game.contract.contractedMw)}</span>
                </div>
                {game.mainCloses !== undefined && <div className="note">{signBy(game, game.mainCloses)}</div>}
              </li>
            )}
            {offers.map((o) => (
              <li key={o.id} className={focusId === o.id ? 'line on' : 'line'}>
                <div className="line-head">
                  <button className="sited-name" onClick={() => onShow(o.id)}>{o.name}</button>
                  <span className="num">{mw(o.mw)}</span>
                </div>
                <div className="note">{signBy(game, o.closes)}</div>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Data centers</h2>
      <div className="segmented four" role="group" aria-label="Utility">
        {SCOPES.map((s) => (
          <button key={s.id} className={scope === s.id ? 'on' : ''} aria-pressed={scope === s.id}
            onClick={() => setScope(s.id)}>{s.label}</button>
        ))}
      </div>
      <p className="note">
        {plural(rows.filter(isActive).length, 'active data center')}. {plural(known.length, 'one', 'of them')} with published power ask for{' '}
        <strong>{mw(known.reduce((n, d) => n + (d.mw ?? 0), 0))}</strong>.
      </p>
      <label className="check">
        <input type="checkbox" checked={stopped} onChange={(e) => setStopped(e.target.checked)} />
        Show withdrawn, denied and on hold
      </label>
      <ul className="lines">
        {rows.map((d) => (
          <li key={d.id} className={focusId === d.id ? 'line on' : 'line'}>
            <div className="line-head">
              <button className="sited-name" onClick={() => onShow(d.id)}>{d.name}</button>
              <span className="num">{d.mw === null ? 'MW not published' : mw(d.mw)}</span>
            </div>
            <div className="note">
              {d.county?.replace(/ County$/, '')}, {d.state}. {STATUS_TEXT[d.status] ?? d.status}.
              {signed.has(d.id) ? ' Signed.' : signBlocked(game, d) === null ? ` Sign by ${formatQuarter(waitsUntil(game, d))}.` : comesUp(game, d.id)}
            </div>
          </li>
        ))}
      </ul>
      <p className="fine">Georgia sites where Georgia Power is named, or no utility is. Sites served by an EMC or a city are left out. Alabama Power and Mississippi Power have the same parent, Southern Company. Collected 24 Nov 2026 from state filings, utilities and news. Most figures are what developers asked for.</p>
    </div>
  )
}
