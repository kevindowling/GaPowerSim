import type { GameState } from '../engine/types.ts'
import { HEARING_OPTIONS, type HearingOption } from '../engine/tutorial.ts'
import { approvalBand } from '../engine/state.ts'
import { money } from './format.ts'

interface Props {
  game: GameState
  onChoose: (option: HearingOption) => void
}

/**
 * The county commission hearing.
 *
 * One question — who pays for the network upgrades — with no free answer. The
 * cheapest option for the player's budget is the one that puts the cost on
 * every household in the state for a line built for a single customer, and the
 * dialog says so rather than hiding it behind a number.
 */
export function HearingDialog({ game, onChoose }: Props) {
  const county = game.counties[game.contract.countyFips]
  const condemnations = game.corridors.reduce((n, c) => n + c.condemnations, 0)
  const band = county ? approvalBand(county.approval) : null

  return (
    <div className="overlay">
      <div className="hearing" role="dialog" aria-modal="true" aria-labelledby="hearing-title">
        <span className="briefing-eyebrow">Sumter County Commission</span>
        <h1 id="hearing-title">Who pays for the line?</h1>

        <div className="hearing-context">
          <p>
            The room is full. {condemnations > 0
              ? `You took ${condemnations} ${condemnations === 1 ? 'property' : 'properties'} by force to get here, and the people you took ${condemnations === 1 ? 'it' : 'them'} from are sitting in the third row.`
              : 'Nobody had their land taken from them, which is the only reason this is a hearing and not a protest.'}
          </p>
          {band && (
            <p className="hearing-mood">
              The county is currently <strong className={`tone-${band.tone}`}>{band.label.toLowerCase()}</strong>.
            </p>
          )}
          <p>
            The network upgrades cost <strong>$62M</strong>. The commission wants to know
            who is going to carry it.
          </p>
        </div>

        <ul className="hearing-options">
          {HEARING_OPTIONS.map((o) => (
            <li key={o.id}>
              <button className="hearing-option" onClick={() => onChoose(o)}>
                <div className="hearing-option-head">
                  <span className="hearing-label">{o.label}</span>
                  <span className="hearing-cost">{o.cost > 0 ? money(o.cost) : 'free'}</span>
                </div>
                <p className="hearing-detail">{o.detail}</p>
                <span className={o.approvalDelta >= 0 ? 'hearing-delta up' : 'hearing-delta down'}>
                  {o.approvalDelta >= 0 ? '+' : ''}{o.approvalDelta} county approval
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
