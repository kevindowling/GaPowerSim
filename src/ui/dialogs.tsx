import type { GameState, Outcome } from '../engine/types.ts'
import { HEARING_OPTIONS, UPGRADE_COST, type HearingOption } from '../engine/turn/hearing.ts'
import { HORIZON_YEAR, STARTING_BUDGET, STARTING_CREDIT } from '../data/customerTerms.ts'
import { poolAt } from '../data/sparePower.ts'
import type { DataCenter } from '../data/dataCenters.ts'
import { openingMoney } from '../engine/customers.ts'
import { equipmentTotal } from '../engine/turn/equipment.ts'
import { eventById } from '../engine/events/events.ts'
import { approvalBand, approvalOf } from '../engine/approval.ts'
import { canContinue } from '../engine/ending.ts'
import { Dialog } from './Dialog.tsx'
import { money, mw, plural } from './format.ts'

export function BriefingDialog({ game, existing, onStart }: {
  game: GameState
  existing: readonly DataCenter[]
  onStart: () => void
}) {
  const opening = openingMoney(existing, game.quarter)
  return (
    <Dialog label="Opening" className="briefing">
      <h1>You are Georgia Power</h1>
      <p>
        It is August 2026. You have signed {plural(existing.length, 'data center')} that want {mw(opening.mw)} in all. Some are running and some are
        being built. More contracts come up through 2030, and each one closes if you do not sign it.
      </p>
      <dl className="terms">
        <div><dt>Your own money</dt><dd>{money(STARTING_BUDGET)}</dd></div>
        <div><dt>Data centers have paid</dt><dd>{money(opening.paid)}</dd></div>
        <div><dt>Spent connecting them</dt><dd>-{money(opening.spent)}</dd></div>
        <div><dt>Cash</dt><dd>{money(STARTING_BUDGET + opening.paid - opening.spent)}</dd></div>
        <div><dt>Lenders allow</dt><dd>{money(STARTING_CREDIT)}</dd></div>
        <div><dt>Spare power</dt><dd>{mw(poolAt(game.quarter))}</dd></div>
        <div><dt>The game ends</dt><dd>{HORIZON_YEAR} Q4</dd></div>
      </dl>
      <p>Your balance at the end is your score.</p>

      <p className="fine">
        Data centers and sites are reported. Sizes are too, except where a card says assumed. Your money, credit and every contract are
        invented. Land parcels and owners are generated.
      </p>
      <button className="btn primary wide" onClick={onStart} autoFocus>Start</button>
    </Dialog>
  )
}

export function HearingDialog({ game, onChoose }: {
  game: GameState
  onChoose: (option: HearingOption) => void
}) {
  const county = game.counties[game.contract.countyFips]
  const approval = approvalOf(game)
  const band = approvalBand(approval)
  const n = game.record.condemnations
  return (
    <Dialog label="Commission hearing" className="hearing">
      <h1>Who pays for the network upgrades?</h1>
      <p>
        {game.equipment
          ? `You have ordered ${money(equipmentTotal(game))} of transformers and line upgrades. The answer also covers any you order later.`
          : `The upgrades cost ${money(UPGRADE_COST)}.`} {county?.name} County's commission wants an answer.
        {n > 0 && ` You have filed ${plural(n, 'condemnation')}, and those owners are in the room.`}
        {' '}Data center approval is <strong className={`tone-${band.tone}`}>{Math.round(approval)}, {band.label.toLowerCase()}</strong>.
      </p>
      <div className="choices">
        {HEARING_OPTIONS.map((o) => (
          <button key={o.id} className="choice" onClick={() => onChoose(o)}>
            <span className="choice-label">{o.label}</span>
            <span className="choice-detail">{o.detail}</span>
            <span className="choice-effect">
              {game.equipment ? `You pay ${money(equipmentTotal(game) * (1 - o.ratepayerShare))}` : o.cost > 0 ? money(o.cost) : 'No cost'}, {o.approvalDelta > 0 ? '+' : ''}{o.approvalDelta} approval
            </span>
          </button>
        ))}
      </div>
    </Dialog>
  )
}

export function EventDialog({ game, onChoose }: { game: GameState; onChoose: (index: number) => void }) {
  const e = game.pendingEvent && eventById(game.pendingEvent.id)
  if (!e) return null
  return (
    <Dialog label={e.title} className="event">
      <h1>{e.title}</h1>
      <p>{e.body(game)}</p>
      <div className="choices">
        {e.options.map((o, i) => (
          <button key={o.label} className="choice" onClick={() => onChoose(i)}>
            <span className="choice-label">{o.label}</span>
            <span className="choice-effect">{o.effect}</span>
          </button>
        ))}
      </div>
    </Dialog>
  )
}

export function ScoreDialog({ game, outcome, closing, onContinue, onCarryOn }: {
  game: GameState
  outcome: Outcome
  closing: string
  onContinue: () => void
  onCarryOn: () => void
}) {
  return (
    <Dialog label="Scorecard" className="score">
      <h1>{outcome.headline}</h1>
      <div className="final">
        <span className={game.cash < 0 ? 'final-value tone-bad' : 'final-value'}>{money(game.cash)}</span>
        <span>Your balance is your score.</span>
      </div>
      <dl className="rows two">
        {outcome.lines.map((l) => (
          <div key={l.label}><dt>{l.label}</dt><dd className={`tone-${l.tone}`}>{l.value}</dd></div>
        ))}
      </dl>
      {game.ending === 'completed' && <p>{closing}</p>}
      {canContinue(game) && (
        <button className="btn primary wide" onClick={onCarryOn} autoFocus>Keep going to the end of 2034</button>
      )}
      <button className={canContinue(game) ? 'btn wide' : 'btn primary wide'} onClick={onContinue} autoFocus={!canContinue(game)}>Start a new game</button>
    </Dialog>
  )
}

export function MenuDialog({ game, onStart, onClose }: {
  game: GameState
  onStart: () => void
  onClose: () => void
}) {
  const running = (game.started || game.contract.status !== 'offered') && game.ending === null
  return (
    <Dialog label="Menu" className="menu" onClose={onClose}>
      <h1>New game</h1>
      <p>
        {running
          ? 'Your game is saved in this browser. A new one replaces it.'
          : 'Each game has different landowners, events and weather.'}
      </p>
      <button className="btn primary wide" onClick={onStart}>New game</button>
      <p className="fine">Seed {game.seed}. Add ?seed={game.seed} to the address to replay this one.</p>
      <button className="btn wide" onClick={onClose}>{running ? 'Back to the game' : 'Close'}</button>
    </Dialog>
  )
}
