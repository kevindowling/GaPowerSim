import type { GameState } from '../engine/types.ts'
import { approvalBand, CANCEL_BELOW, homeOf, neighbours, ratingOf, ratingRecord } from '../engine/approval.ts'
import { customerUnpaid, unpaidAdvance } from '../engine/payments.ts'
import { formatQuarter } from '../engine/time.ts'
import { approvalAdvice, approvalEffects, programmesFor } from '../engine/turn/community.ts'
import { mainRefundDue } from '../engine/ending.ts'
import { refundDue } from '../engine/customers.ts'
import type { Focus } from '../engine/focus.ts'
import { Icon } from './Icon.tsx'
import { money } from './format.ts'

const signed = (n: number): string => `${n > 0 ? '+' : ''}${Math.abs(n) < 1 ? n.toFixed(1) : Math.round(n)}`

/** Approval of the data center, or of a county bordering its own. */
export function ApprovalBody({ game, fips, onRun }: {
  game: GameState
  fips: string
  onRun: (fips: string, id: string) => void
}) {
  const rating = ratingOf(game, fips)
  if (rating === null) return null
  const owner = homeOf(game, fips)
  const main = owner === 'main'
  const home = owner !== null
  const cancellable = main ? game.phase === 'build' && game.contract.status === 'accepted' : owner !== null && owner.status === 'signed'
  const band = approvalBand(rating)
  const history = (ratingRecord(game, fips).history ?? []).slice(-6).reverse()
  const advice = approvalAdvice(game, fips)
  const unpaid = main ? unpaidAdvance(game) : owner ? customerUnpaid(game, owner) : 0
  const refund = main ? mainRefundDue(game) : owner ? refundDue(owner) : 0
  const near = (main ? neighbours(game) : owner?.neighbours ?? [])
    .map((f) => ({ f, name: game.counties[f].name, a: ratingOf(game, f) ?? 0 }))
    .sort((x, y) => x.a - y.a)

  return (
    <>
      <div>
        <div className="line-head">
          <span>{home ? 'Data center approval' : 'Approval'}</span>
          <span className={`tone-${band.tone}`}>{Math.round(rating)} of 100, {band.label.toLowerCase()}</span>
        </div>
        <span className={`track approval-track tone-${band.tone}`}>
          <span style={{ width: `${rating}%` }} />
          {cancellable && <i style={{ left: `${CANCEL_BELOW}%` }} />}
        </span>
        {cancellable && (
          <div className={rating < 35 ? 'note tone-bad' : 'note'}>
            Below {CANCEL_BELOW} when a quarter ends, the data center is cancelled
            {unpaid > 0 ? ` and the last ${money(unpaid)} of funding is never paid.` : '.'}
            {refund > 0 && ` You also give back ${money(refund)}.`}
          </div>
        )}
        <div className="note">{approvalEffects(game, fips).join(' ')}</div>
      </div>

      <h3>Raise approval</h3>
      <ul className="programmes">
        {programmesFor(game, fips).map(({ programme: p, gain, blocked }) => (
          <li key={p.id}>
            <button className="programme" disabled={blocked !== null} onClick={() => onRun(fips, p.id)}>
              <span className="programme-name">{p.label}</span>
              <span className="num">{blocked ? '' : `+${Math.round(gain)}, `}{money(p.cost)}</span>
              <span className="note">{blocked ?? p.detail}</span>
            </button>
          </li>
        ))}
      </ul>
      {advice.length > 0 && <ul className="advice">{advice.map((a) => <li key={a}>{a}</li>)}</ul>}

      {history.length > 0 && (
        <>
          <h3>What changed it</h3>
          <dl className="rows">
            {history.map((h, i) => (
              <div key={`${i}${h.text}`}>
                <dt>{formatQuarter(h.quarter)}: {h.text.replace(/\.$/, '')}{h.outside && ' (outside your control)'}</dt>
                <dd className={h.delta > 0 ? 'tone-good' : 'tone-bad'}>{signed(h.delta)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {home && near.length > 0 && (
        <>
          <h3>Bordering counties</h3>
          <dl className="rows">
            {near.map(({ f, name, a }) => (
              <div key={f}>
                <dt>{name} County</dt>
                <dd className={`tone-${approvalBand(a).tone}`}>{Math.round(a)}, {approvalBand(a).label.toLowerCase()}</dd>
              </div>
            ))}
          </dl>
          <p className="note">An opposed neighbor can lower the data center's approval in any quarter. A supportive one can raise it. Click a county on the map to raise its rating.</p>
          <p className="fine">Ratings and events are invented.</p>
        </>
      )}
    </>
  )
}

export function ApprovalCard({ game, focus, onRun, onClose }: {
  game: GameState
  focus: Focus
  onRun: (fips: string, id: string) => void
  onClose: () => void
}) {
  return (
    <section className="power-card" role="dialog" aria-label="Data center approval">
      <div className="inspector-head">
        <h2>{focus.name}</h2>
        <button className="btn ghost icon-only" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      </div>
      {focus.fips ? <ApprovalBody game={game} fips={focus.fips} onRun={onRun} />
        : <p className="note">You have not signed it, so you cannot raise its approval yet.</p>}
    </section>
  )
}
