import type { GameState } from '../engine/types.ts'
import { capacitySummary, quartersToDeadline } from '../engine/state.ts'
import { formatQuarter } from '../engine/time.ts'
import { money, mw } from './format.ts'

interface Props {
  game: GameState
  onEndQuarter: () => void
  busy: boolean
  /** Phone layout: fewer stats, bigger touch target, no wrapping. */
  compact?: boolean
}

/**
 * The four numbers that decide whether the player is winning: what quarter it
 * is, how long is left, how much money there is, and how much firm capacity is
 * actually online. Everything else in the game is downstream of these.
 *
 * On a phone there is not room for four, so the deadline folds into the quarter
 * as a countdown and the rest moves into the sheet. Trying to keep all four
 * printed them on top of each other, which is how this looked before.
 */
export function HUD({ game, onEndQuarter, busy, compact = false }: Props) {
  const cap = capacitySummary(game)
  const left = quartersToDeadline(game)
  const served = game.energizedQuarter !== null
  const target = game.contract.contractedMw

  const deadlineTone = served ? 'good' : left < 0 ? 'bad' : left <= 4 ? 'warn' : 'plain'
  const cashTone = game.cash < 0 ? 'bad' : 'plain'
  const capPct = Math.min(100, (cap.onlineFirmMw / target) * 100)

  const capacityBar = (
    <div className="cap-bar" role="img" aria-label={`${Math.round(capPct)} percent of contracted load served`}>
      <span className="cap-online" style={{ width: `${capPct}%` }} />
      {cap.underConstructionFirmMw > 0 && (
        <span
          className="cap-building"
          style={{ width: `${Math.min(100 - capPct, (cap.underConstructionFirmMw / target) * 100)}%` }}
        />
      )}
    </div>
  )

  if (compact) {
    return (
      <header className="hud compact">
        <div className="hud-stats">
          <Stat
            label={served ? 'Energized' : formatQuarter(game.quarter)}
            value={served ? formatQuarter(game.energizedQuarter!) : money(game.cash)}
            note={served ? null : left < 0 ? `${-left} late` : `${left} qtr left`}
            tone={served ? 'good' : cashTone}
          />
          <div className="stat stat-wide">
            <span className="stat-label">Firm</span>
            <span className="stat-value">
              {mw(cap.onlineFirmMw)} <span className="stat-of">/ {mw(target)}</span>
            </span>
            {capacityBar}
          </div>
        </div>

        <button
          className="btn-primary"
          onClick={onEndQuarter}
          disabled={busy || game.phase === 'ended'}
        >
          End qtr
        </button>
      </header>
    )
  }

  return (
    <header className="hud">
      <div className="hud-brand">
        <strong>GaPowerSim</strong>
        <span className="hud-sub">Georgia Power</span>
      </div>

      <div className="hud-stats">
        <Stat label="Quarter" value={formatQuarter(game.quarter)} />
        <Stat
          label={served ? 'Energized' : 'In service by'}
          value={served ? formatQuarter(game.energizedQuarter!) : formatQuarter(game.contract.inServiceQuarter)}
          note={served ? null : left < 0 ? `${-left} late` : `${left} left`}
          tone={deadlineTone}
        />
        <Stat label="Cash" value={money(game.cash)} tone={cashTone} />

        <div className="stat stat-wide">
          <span className="stat-label">Firm capacity</span>
          <span className="stat-value">
            {mw(cap.onlineFirmMw)} <span className="stat-of">/ {mw(target)}</span>
          </span>
          {capacityBar}
        </div>
      </div>

      <button className="btn-primary" onClick={onEndQuarter} disabled={busy || game.phase === 'ended'}>
        End quarter
      </button>
    </header>
  )
}

function Stat({
  label, value, note, tone = 'plain',
}: {
  label: string
  value: string
  note?: string | null
  tone?: 'plain' | 'good' | 'warn' | 'bad'
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value tone-${tone}`}>
        {value}
        {note && <span className="stat-note">{note}</span>}
      </span>
    </div>
  )
}
