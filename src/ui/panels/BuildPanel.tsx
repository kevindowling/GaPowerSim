import type { GameState } from '../../engine/types.ts'
import { PLANT_TYPES, unitCapex, plantType } from '../../data/plants.ts'
import { canFinishInTime, capacitySummary } from '../../engine/state.ts'
import type { Tool } from '../../state/gameStore.ts'
import { money, mw, acres, quarters } from '../format.ts'

interface Props {
  game: GameState
  tool: Tool
  onSelect: (tool: Tool) => void
  onCancelPlant: (plantId: string) => void
}

/**
 * The generation catalogue.
 *
 * Every option shows firm MW alongside nameplate, because that gap is the whole
 * lesson: 200 MW of solar contributes about 16 MW toward keeping a data center
 * up at three in the morning, and the panel should say so before the player
 * spends a quarter of a billion dollars finding out.
 */
export function BuildPanel({ game, tool, onSelect, onCancelPlant }: Props) {
  const cap = capacitySummary(game)
  const signed = game.contract.status !== 'offered'

  return (
    <section className="panel">
      <h2 className="panel-title">Generation</h2>

      {!signed && (
        <p className="panel-note">Sign the contract before committing capital.</p>
      )}

      {cap.shortfallMw > 0 && signed && (
        <p className="panel-note">
          Still short <strong>{mw(cap.shortfallMw)}</strong> of firm capacity.
          {cap.underConstructionFirmMw > 0 && ` ${mw(cap.underConstructionFirmMw)} is under way.`}
        </p>
      )}

      <ul className="plant-list">
        {PLANT_TYPES.map((t) => {
          const selected = tool.kind === 'site' && tool.typeId === t.id
          // Once the load is served the deadline is behind us; warning that a
          // technology is "too slow" for it would just be noise.
          const inTime = game.energizedQuarter !== null || canFinishInTime(game, t)
          const firm = t.nameplateMw * t.firmCapacityFraction
          const total = t.permitQuarters + t.buildQuarters

          return (
            <li key={t.id}>
              <button
                className={selected ? 'plant-card on' : 'plant-card'}
                onClick={() => onSelect(selected ? { kind: 'none' } : { kind: 'site', typeId: t.id })}
                disabled={!signed}
                aria-pressed={selected}
              >
                <div className="plant-head">
                  <span className="plant-name">{t.name}</span>
                  <span className="plant-cost">{money(unitCapex(t))}</span>
                </div>

                <div className="plant-caps">
                  <span className="cap-firm">{mw(firm)} firm</span>
                  <span className="cap-plate">{mw(t.nameplateMw)} nameplate</span>
                </div>

                <p className="plant-blurb">{t.blurb}</p>

                <div className="plant-facts">
                  <span className={inTime ? '' : 'tone-bad'}>
                    {quarters(total)}{!inTime && ' — too slow'}
                  </span>
                  <span>{acres(t.acres)}</span>
                </div>
              </button>
            </li>
          )
        })}
      </ul>

      {tool.kind === 'site' && (
        <p className="panel-hint on">
          Now click the map to place the {plantType(tool.typeId).name.toLowerCase()}.
          <button className="btn-link" onClick={() => onSelect({ kind: 'none' })}>Cancel</button>
        </p>
      )}

      {game.plants.length > 0 && (
        <>
          <h3 className="panel-subtitle">Sited</h3>
          <ul className="sited-list">
            {game.plants.map((p) => {
              const permitting = p.status === 'permitting'
              return (
                <li key={p.id} className="sited">
                  <div className="sited-main">
                    <span className="sited-name">{p.name}</span>
                    <span className={`sited-status status-${p.status}`}>
                      {p.status === 'permitting' ? `Permitting · ${quarters(p.quartersRemaining)} left`
                        : p.status === 'construction' ? `Building · ${quarters(p.quartersRemaining)} left`
                        : p.status === 'online' ? 'Online'
                        : 'Offline'}
                    </span>
                  </div>
                  {permitting ? (
                    // Somewhere to put a misplaced plant. Only while it is still
                    // paperwork — once construction starts, the site is the site.
                    <button
                      className="btn-link"
                      onClick={() => onCancelPlant(p.id)}
                      title={`Withdraw and recover about ${money(p.landCost * 0.7)} of the land cost`}
                    >
                      Move
                    </button>
                  ) : (
                    <span className="sited-locked" title="Construction has started; the site is fixed.">
                      Fixed
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
