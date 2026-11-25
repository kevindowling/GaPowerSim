import type { GameState } from '../engine/types.ts'
import { signBlocked, termsFor, waitsUntil } from '../engine/customers.ts'
import { SIGNING_SHARE } from '../engine/payments.ts'
import { CREDIT_PER_MW, CUSTOMER_RATE } from '../data/customerTerms.ts'
import { formatQuarter } from '../engine/time.ts'
import type { DataCenter } from '../data/dataCenters.ts'
import { scenario } from '../data/scenarios.ts'
import { money, mw, quarters } from './format.ts'

/** The last quarter it can be signed. */
function SignBy({ game, closes }: { game: GameState; closes: number }) {
  const left = closes - game.quarter
  return (
    <div>
      <dt>Sign by</dt>
      <dd className={left <= 2 ? 'tone-bad' : ''}>{formatQuarter(closes)}, {left === 0 ? 'this quarter' : `${quarters(left)} left`}</dd>
    </div>
  )
}

/** What signing a data center would mean. */
export function OfferCard({ game, dc, onSign }: { game: GameState; dc: DataCenter; onSign: (id: string) => void }) {
  const blocked = signBlocked(game, dc)
  if (blocked) return <p className="note">{blocked}</p>
  const t = termsFor(game, dc)
  return (
    <>
      <dl className="rows">
        <SignBy game={game} closes={waitsUntil(game, dc)} />
        <div><dt>Asking for</dt><dd>{mw(t.mw)}</dd></div>
        <div><dt>Phases</dt><dd>{t.phaseCount} of {mw(t.phaseMw)}</dd></div>
        <div><dt>First phase due</dt><dd>{formatQuarter(t.due[0])}</dd></div>
        <div><dt>Last phase due</dt><dd>{formatQuarter(t.due[t.due.length - 1])}</dd></div>
        <div><dt>Paid on signing</dt><dd>{money(t.advance * SIGNING_SHARE)}</dd></div>
        <div><dt>Paid as phases turn on</dt><dd>{money(t.advance * (1 - SIGNING_SHARE))}</dd></div>
        <div><dt>It pays for power</dt><dd>${CUSTOMER_RATE} a MWh</dd></div>
        <div><dt>Lenders add</dt><dd>{money(t.mw * CREDIT_PER_MW)}</dd></div>
      </dl>
      <button className="btn small primary" onClick={() => onSign(dc.id)}>Sign {dc.name}</button>
    </>
  )
}

/** The first data center's terms. */
export function MainOffer({ game, onSign }: { game: GameState; onSign: () => void }) {
  const c = game.contract
  const shift = game.quarter - game.startQuarter
  const sc = scenario(game.scenarioId)
  return (
    <>
      {sc.briefing.map((line) => <p key={line}>{line}</p>)}
      <dl className="rows">
        {game.mainCloses !== undefined && <SignBy game={game} closes={game.mainCloses} />}
        <div><dt>Developer</dt><dd>{c.developer}</dd></div>
        <div><dt>Asking for</dt><dd>{mw(c.contractedMw)}</dd></div>
        <div><dt>Last phase due</dt><dd>{formatQuarter(c.inServiceQuarter + shift)}</dd></div>
        <div><dt>Paid on signing</dt><dd>{money(c.capexAdvance * SIGNING_SHARE)}</dd></div>
        <div><dt>Paid as phases turn on</dt><dd>{money(c.capexAdvance * (1 - SIGNING_SHARE))}</dd></div>
        <div><dt>It pays for power</dt><dd>${c.energyRatePerMwh} a MWh</dd></div>
        <div><dt>Outage penalty</dt><dd>${c.shortfallPenaltyPerMwh.toLocaleString()} a MWh</dd></div>
        <div><dt>Lenders add</dt><dd>{money(c.contractedMw * CREDIT_PER_MW)}</dd></div>
      </dl>
      <p className="note">After its last phase turns on you run it hour by hour for a year.</p>
      <button className="btn small primary" onClick={onSign}>Sign {c.name}</button>
      {sc.basedOn === 'projection' && <p className="fine">The campus and its developer are invented.</p>}
      {sc.sources.length > 0 && (
        <ul className="sources fine">
          {sc.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer noopener">{s.label}</a></li>)}
        </ul>
      )}
    </>
  )
}
