import type { GameState } from '../engine/types.ts'
import type { Focus } from '../engine/focus.ts'
import { focusForecast } from '../engine/focus.ts'
import { powerForecast } from '../engine/forecast.ts'
import { amountIfPaid, LATE_FLOOR, LATE_STEP, shareIfPaid } from '../engine/payments.ts'
import { CAMPUS_TX } from '../engine/realtime/network.ts'
import { transformerName } from '../engine/realtime/reliability.ts'
import { CANCEL_BELOW } from '../engine/approval.ts'
import { TERMINATION_QUARTERS_LATE } from '../engine/ending.ts'
import { leaving } from '../engine/leaving.ts'
import { LATE_LIMIT, MINIMUM_SHARE } from '../data/customerTerms.ts'
import { ledger } from '../engine/ledger.ts'
import { formatQuarter } from '../engine/time.ts'
import { ApprovalBody } from './ApprovalCard.tsx'
import { EquipmentList, type EquipmentActions } from './EquipmentList.tsx'
import { SpareSlider } from './SpareSlider.tsx'
import { limitText } from './power.ts'
import { money, mw, quarters } from './format.ts'

/** Phases, when each turns on, and what it pays. */
export function PhaseTable({ game, focus, phases }: {
  game: GameState
  focus: Focus
  phases: ReadonlyArray<{ on: boolean; quarter: number | null }>
}) {
  const old = focus.milestones.filter((m) => m.trigger !== 'phase')
  return (
    <table className="power-table">
      <thead><tr><th>For</th><th className="num">Due</th><th className="num">On</th><th className="num">Pays</th></tr></thead>
      <tbody>
        {old.map((m) => (
          <tr key={m.id}>
            <td>{m.label}</td>
            <td />
            <td className={m.released ? 'num tone-good' : 'num'}>{m.released ? m.paidQuarter === undefined ? 'Paid' : formatQuarter(m.paidQuarter) : ''}</td>
            <td className="num">{money(m.paid ?? focus.advance * m.fraction)}</td>
          </tr>
        ))}
        {phases.map((p, i) => {
          const m = focus.milestones.find((x) => x.phase === i + 1)
          const at = p.quarter ?? game.quarter
          const lost = m && !p.on ? Math.round((1 - shareIfPaid(m, at)) * 100) : 0
          return (
            <tr key={i}>
              <td>{mw((i + 1) * focus.mwEach)}</td>
              <td className="num">{m?.dueQuarter === undefined ? '' : formatQuarter(m.dueQuarter)}</td>
              <td className={p.on ? 'num tone-good' : p.quarter === null ? 'num tone-warn' : 'num'}>
                {p.on ? 'On' : p.quarter === null ? 'Not planned' : formatQuarter(p.quarter)}
              </td>
              <td className={lost > 0 ? 'num tone-bad' : 'num'}>{m ? money(m.paid ?? amountIfPaid(game, m, at, focus.advance)) : ''}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** Everything about a data center the player supplies. */
export function Progress({ game, focus, onRun, onSetSpare, onOrder, onCancelOrder, onPlanLine }: EquipmentActions & {
  game: GameState
  focus: Focus
  onRun: (fips: string, id: string) => void
  onSetSpare: (id: string, mw: number) => void
  onPlanLine: (node: string) => void
}) {
  const main = focus.id === 'main'
  const f = powerForecast(game)
  const ff = focusForecast(f, focus)
  const then = f.points[f.points.length - 1].flow
  const live = main ? game.realtime?.history[game.realtime.history.length - 1] : undefined
  const linked = main || game.corridors.some((x) => x.fromNode === focus.node || x.toNode === focus.node)
  const short = ff.plannedMw + 0.5 < focus.needMw
  const held = short ? [...new Set([...then.plants.values()].flatMap((p) => (p.limit ? [limitText(game, p.limit)] : [])))].slice(0, 3) : []
  const m = ledger(game).perCenter.find((r) => r.id === focus.id)
  const site = main ? undefined : focus.node
  if (focus.cancelled) return <p className="note tone-bad">It was cancelled. You no longer supply it.</p>

  const trouble = leaving(game, focus.id)
  return (
    <>
      {trouble && <p className="note tone-bad">{trouble}</p>}
      <dl className="rows">
        <div><dt>Customer</dt><dd>{focus.developer}</dd></div>
        <div><dt>Contracted</dt><dd>{mw(focus.needMw)}{focus.customer?.assumed && ', assumed'}</dd></div>
        {live ? (
          <>
            <div><dt>Drawing</dt><dd>{mw(live.contractMw)}</dd></div>
            <div><dt>Short</dt><dd className={live.unservedContractMw > 0.5 ? 'tone-bad' : ''}>{mw(live.unservedContractMw)}</dd></div>
          </>
        ) : (
          <>
            <div><dt>Phases on</dt><dd>{focus.phasesOn} of {focus.count}, {mw(focus.mwEach)} each</dd></div>
            {(focus.customer?.baseMw ?? 0) > 0 && <div><dt>Already connected</dt><dd>{mw(focus.customer!.baseMw!)}</dd></div>}
            <div><dt>Arriving now</dt><dd>{mw(ff.now)}</dd></div>
            <div><dt>When all you filed is done</dt><dd className={short ? 'tone-warn' : 'tone-good'}>{mw(ff.plannedMw)}</dd></div>
            <div><dt>All {mw(focus.needMw)} arrives</dt><dd className={ff.readyQuarter === null ? 'tone-warn' : ''}>{ff.readyQuarter === null ? 'Not yet planned' : formatQuarter(ff.readyQuarter)}</dd></div>
          </>
        )}
      </dl>
      {focus.customer?.assumed && <p className="note">{focus.customer.assumed}</p>}
      {!linked && short && <p className="note tone-warn">No line reaches it. Plan one to a substation or an existing line nearby, then order a transformer here.</p>}
      {held.map((h) => <p key={h} className="note tone-warn">{h}</p>)}
      {game.phase !== 'ended' && <button className="btn small" onClick={() => onPlanLine(focus.node)}>Plan a line from here</button>}

      <h3>Phases and payments</h3>
      <PhaseTable game={game} focus={focus} phases={ff.phases} />
      {focus.milestones.some((x) => x.dueQuarter !== undefined) && (
        <p className="note">
          Each pays when that much firm power arrives. It loses {LATE_STEP * 100}% for every quarter late, down to {LATE_FLOOR * 100}%.
        </p>
      )}

      {m && (
        <>
          <h3>Its money</h3>
          <dl className="rows">
            <div><dt>Developer paid</dt><dd>{money(m.paid)}</dd></div>
            <div><dt>Power sold</dt><dd>{money(m.sold)}</dd></div>
            <div><dt>Spent on it</dt><dd>{money(-m.spent)}</dd></div>
            <div><dt>So far</dt><dd className={m.paid + m.sold - m.spent < 0 ? 'tone-bad' : 'tone-good'}>{money(m.paid + m.sold - m.spent)}</dd></div>
            <div><dt>Payments still to come</dt><dd>{money(m.toCome)}</dd></div>
          </dl>
        </>
      )}

      <h3>Contract</h3>
      <dl className="rows">
        <div><dt>It pays</dt><dd>${focus.ratePerMwh} a MWh</dd></div>
        <div><dt>Minimum billed</dt><dd>{mw(main ? game.contract.takeOrPayMw : focus.needMw * MINIMUM_SHARE)}</dd></div>
        {main && <div><dt>Outage penalty</dt><dd>${game.contract.shortfallPenaltyPerMwh.toLocaleString()} a MWh</dd></div>}
        {main && game.contract.latePenaltyPerQuarter > 0 && <div><dt>Late penalty</dt><dd>{money(game.contract.latePenaltyPerQuarter)} a quarter</dd></div>}
        <div><dt>Cancelled if late by</dt><dd>{quarters(main ? TERMINATION_QUARTERS_LATE : LATE_LIMIT)}</dd></div>
        <div><dt>Cancelled if approval is below</dt><dd>{CANCEL_BELOW}</dd></div>
      </dl>

      <SpareSlider game={game} id={focus.id} value={focus.spareMw} most={Math.max(0, focus.needMw - (focus.customer?.baseMw ?? 0))} arriving={then.spare.get(focus.id) ?? 0} onSet={onSetSpare} />
      <EquipmentList game={game} places={['campus']} title="Transformers here" siteId={site}
        existing={main ? [{
          name: transformerName(game, CAMPUS_TX).replace(/ at .*/, ''), mw: game.system.tieMw,
          out: game.realtime?.outages.some((o) => o.assetId === CAMPUS_TX) ?? false,
        }] : undefined}
        onOrder={onOrder} onCancelOrder={onCancelOrder} />
      {!main && <EquipmentList game={game} places={['area']} title="Existing lines nearby" siteId={site} onOrder={onOrder} onCancelOrder={onCancelOrder} />}
      {focus.fips && <ApprovalBody game={game} fips={focus.fips} onRun={onRun} />}
    </>
  )
}
