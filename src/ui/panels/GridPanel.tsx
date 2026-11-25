import type { ReactNode } from 'react'
import type { GameState } from '../../engine/types.ts'
import { lineClass } from '../../data/transmission.ts'
import type { Tool } from '../../state/gameStore.ts'
import { isTapped, type CorridorPlan } from '../../engine/turn/corridor.ts'
import { plannedFlow, poolMw } from '../../engine/realtime/network.ts'
import type { Focus } from '../../engine/focus.ts'
import { TAP_CLASSES } from '../../data/taps.ts'
import { money, mw, quarters } from '../format.ts'

interface Props {
  game: GameState
  focus: Focus
  tool: Tool
  plan: CorridorPlan | null
  /** Shown here on phones. */
  planner: ReactNode
  selectedCorridor: string | null
  onStartRoute: () => void
  onSelectCorridor: (id: string) => void
  onAbandon: (id: string) => void
}

const STATUS: Record<string, string> = {
  acquiring: 'Buying land', building: 'Building', energized: 'In service', planned: 'Planned',
}

export function GridPanel({
  game, focus, tool, plan, planner, selectedCorridor, onStartRoute, onSelectCorridor, onAbandon,
}: Props) {
  const routing = tool.kind === 'route'
  const planned = plannedFlow(game).loads.get(focus.id) ?? 0
  const usedKv = (kv: number): boolean => game.corridors.some((c) =>
    c.fromNode.startsWith(`grid:${kv}:`) || c.toNode.startsWith(`grid:${kv}:`))
  const flows = game.realtime?.history[game.realtime.history.length - 1]?.lineFlowMw

  return (
    <div className="panel">
      <h2>Lines</h2>
      {focus.signed && !focus.cancelled && (game.plants.length > 0 || focus.spareMw > 0) && (
        <p className={planned + 1e-6 >= focus.needMw ? 'note tone-good' : 'note tone-warn'}>
          When everything filed is finished, {mw(planned)} of {mw(focus.needMw)} firm can reach {focus.name}.
        </p>
      )}
      <ul className="lines">
        <li className="line">
          <div className="line-head">
            <span>Existing tie to {game.system.substationName}</span>
            <span className="status-energized">In service</span>
          </div>
          <div className="note">
            {mw(game.system.tieMw)}{flows && `, carrying ${mw(flows.tie ?? 0)}`}
          </div>
        </li>
        {TAP_CLASSES.filter((t) => usedKv(t.kv)).map((t) => (
          <li key={t.kv} className="line">
            <div className="line-head"><span>Existing {t.kv} kV lines</span><span className="status-energized">In service</span></div>
            <div className="note">
              {mw(poolMw(game, t.kv))} to spare{flows && `, carrying ${mw(flows[`pool:${t.kv}`] ?? 0)} of yours`}
            </div>
          </li>
        ))}
        {game.corridors.map((c) => {
          const deals = Object.values(c.deals)
          const settled = deals.filter((d) => d.status === 'accepted' || d.status === 'condemned').length
          return (
            <li key={c.id} className={selectedCorridor === c.id ? 'line on' : 'line'}>
              <button className="line-pick" onClick={() => onSelectCorridor(c.id)}>
                <span className="line-head">
                  <span>{c.name}</span>
                  <span className={`status-${c.status}`}>{STATUS[c.status]}</span>
                </span>
                <span className="note">
                  {c.lengthKm.toFixed(1)} km, {mw(lineClass(c.classId).ratingMw)}
                  {c.status === 'acquiring' && `, ${settled} of ${deals.length} parcels`}
                  {c.status === 'building' && `, ${quarters(c.buildQuartersRemaining)} left`}
                  {c.status === 'energized' && flows && `, carrying ${mw(flows[c.id] ?? 0)}`}
                </span>
              </button>
              {c.status !== 'energized' && selectedCorridor === c.id && !isTapped(game, c.id) && (
                <button className="btn small danger" onClick={() => onAbandon(c.id)}>Abandon this route</button>
              )}
            </li>
          )
        })}
      </ul>

      {!routing && (
        <button className="btn wide" onClick={onStartRoute} disabled={game.phase === 'ended'}>Plan a line</button>
      )}

      {routing && planner}
      {routing && !plan && (
        <p className="fine">
          Tapping an existing line:{' '}
          {TAP_CLASSES.map((t) => `${t.kv} kV, ${money(t.cost)}, ${t.spareMw} MW to spare`).join('; ')}.
          Power taken on an existing line arrives at {game.system.substationName}.
        </p>
      )}
    </div>
  )
}
