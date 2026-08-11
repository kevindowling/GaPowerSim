import type { GameState } from '../../engine/types.ts'
import { LINE_CLASSES, lineClass } from '../../data/transmission.ts'
import type { Tool } from '../../state/gameStore.ts'
import type { CorridorPlan } from '../../engine/turn/corridor.ts'
import { money, mw, acres, quarters } from '../format.ts'

interface Props {
  game: GameState
  tool: Tool
  plan: CorridorPlan | null
  parcelsLoading: boolean
  parcelError: string | null
  syntheticParcels: boolean
  selectedCorridor: string | null
  onStartRoute: () => void
  onSetClass: (id: Parameters<typeof lineClass>[0]) => void
  onCommit: () => void
  onCancel: () => void
  onSelectCorridor: (id: string) => void
}

/**
 * Route planning.
 *
 * The plan card is where the geometry pays off: it reports not just the length
 * and the cost but how many parcels the line crosses and how many of those it
 * cuts in half. Those last two numbers are what the acquisition phase will
 * actually be fought over, and they change with the shape of the route, not just
 * its length.
 */
export function CorridorPanel({
  game, tool, plan, parcelsLoading, parcelError, syntheticParcels,
  selectedCorridor, onStartRoute, onSetClass, onCommit, onCancel, onSelectCorridor,
}: Props) {
  const routing = tool.kind === 'route'
  const signed = game.contract.status !== 'offered'

  return (
    <section className="panel">
      <h2 className="panel-title">Transmission</h2>

      {parcelError && <p className="panel-note tone-bad">{parcelError}</p>}

      {game.corridors.length > 0 && (
        <ul className="corridor-list">
          {game.corridors.map((c) => {
            const cls = lineClass(c.classId)
            const deals = Object.values(c.deals)
            const settled = deals.filter(
              (d) => d.status === 'accepted' || d.status === 'condemned',
            ).length
            return (
              <li key={c.id}>
                <button
                  className={selectedCorridor === c.id ? 'corridor-card on' : 'corridor-card'}
                  onClick={() => onSelectCorridor(c.id)}
                >
                  <div className="corridor-head">
                    <span className="corridor-name">{cls.name}</span>
                    <span className={`corridor-status status-${c.status}`}>{c.status}</span>
                  </div>
                  <div className="corridor-facts">
                    <span>{c.lengthKm.toFixed(1)} km</span>
                    <span>{mw(cls.ratingMw)}</span>
                    {c.status === 'acquiring' && <span>{settled}/{deals.length} settled</span>}
                    {c.status === 'building' && <span>{c.buildQuartersRemaining} qtr left</span>}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {!routing && !plan && (
        <button className="btn-secondary" onClick={onStartRoute} disabled={!signed}>
          Plan a corridor
        </button>
      )}

      {routing && (
        <>
          <div className="class-picker" role="group" aria-label="Line class">
            {LINE_CLASSES.map((c) => (
              <button
                key={c.id}
                className={tool.classId === c.id ? 'class-btn on' : 'class-btn'}
                onClick={() => onSetClass(c.id)}
                aria-pressed={tool.classId === c.id}
              >
                <span className="class-name">{c.kv} kV{c.circuits > 1 ? ' ×2' : ''}</span>
                <span className="class-rating">{mw(c.ratingMw)}</span>
              </button>
            ))}
          </div>
          <p className="panel-note">{lineClass(tool.classId).blurb}</p>

          {parcelsLoading && <p className="panel-hint">Loading the county cadastre…</p>}

          {!plan && (
            <p className="panel-hint">
              {tool.from === null
                ? 'Click the map where the line starts — usually your plant.'
                : 'Now click where it ends — the campus.'}
              <button className="btn-link" onClick={onCancel}>Cancel</button>
            </p>
          )}
        </>
      )}

      {plan && (
        <div className="plan-card">
          <h3 className="panel-sub">Proposed route</h3>
          <dl className="kv">
            <dt>Length</dt><dd>{plan.lengthKm.toFixed(1)} km</dd>
            <dt>Line cost</dt><dd>{money(plan.lineCapex)}</dd>
            <dt>Right of way</dt><dd>{acres(plan.takings.totalAcres)}</dd>
            <dt>Land cost</dt><dd>{money(plan.rowAppraised)}</dd>
            <dt>Build time</dt><dd>{quarters(plan.buildQuarters)}</dd>
          </dl>

          <div className="plan-people">
            <div className="plan-stat">
              <strong>{plan.takings.parcelsAffected}</strong>
              <span>properties crossed</span>
            </div>
            <div className={plan.takings.parcelsSevered > 0 ? 'plan-stat warn' : 'plan-stat'}>
              <strong>{plan.takings.parcelsSevered}</strong>
              <span>cut in two</span>
            </div>
          </div>

          {plan.takings.parcelsSevered > 0 && (
            <p className="panel-note">
              Severed parcels owe damages on the land that is left, not just the strip taken.
              A route that follows property lines takes the same acres for less.
            </p>
          )}

          <div className="plan-total">
            <span>Total committed</span>
            <strong>{money(plan.lineCapex + plan.rowAppraised)}</strong>
          </div>

          <div className="plan-actions">
            <button className="btn-primary" onClick={onCommit}>Commit this route</button>
            <button className="btn-link" onClick={onCancel}>Redraw</button>
          </div>

          {syntheticParcels && (
            <p className="synthetic-warning">
              These property lines are a <strong>generated stand-in</strong>, not the real
              cadastre. Run <code>npm run fetch:parcels</code> to replace them with surveyed
              boundaries.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
