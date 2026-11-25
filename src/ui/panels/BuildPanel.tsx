import type { GameState } from '../../engine/types.ts'
import { PLANT_TYPES, unitCapex, plantType } from '../../data/plants.ts'
import { canFinishInTime, capacitySummary } from '../../engine/state.ts'
import { canExpedite, expediteCost, CANCEL_LAND_RECOVERY } from '../../engine/turn/siting.ts'
import { nodesRoutedToCampus, plannedFlow, plantNode } from '../../engine/realtime/network.ts'
import { batteryCapacityMwh } from '../../engine/realtime/dispatch.ts'
import type { Tool } from '../../state/gameStore.ts'
import type { Focus } from '../../engine/focus.ts'
import { yearText } from '../environment.ts'
import { FIRM_MEANING } from '../power.ts'
import { SUBSTATION_TYPES } from '../../data/newSubstations.ts'
import { money, mw, acres, quarters } from '../format.ts'

interface Props {
  game: GameState
  focus: Focus
  tool: Tool
  onSelect: (tool: Tool) => void
  onWithdraw: (plantId: string) => void
  onExpedite: (plantId: string) => void
  onShow: (cell: number) => void
  onShowSub: (id: string) => void
}

export function BuildPanel({ game, focus, tool, onSelect, onWithdraw, onExpedite, onShow, onShowSub }: Props) {
  const cap = capacitySummary(game)
  const joined = nodesRoutedToCampus(game)
  const planned = cap.onlineFirmMw + cap.underConstructionFirmMw

  return (
    <div className="panel">
      <h2>Generation</h2>
      <p className="note">
        {!focus.signed ? <><strong>{focus.name}</strong> is not signed.</>
          : <><strong>{focus.name}</strong> needs {mw(focus.needMw)} of firm power. What you have filed will bring it <strong>{mw(plannedFlow(game).loads.get(focus.id) ?? 0)}</strong>.</>}
        {game.plants.length > 0 && <> You have filed {mw(planned)} of firm plants.</>}
        {' '}{FIRM_MEANING}
      </p>

      <ul className="plants">
        {PLANT_TYPES.map((t) => {
          const on = tool.kind === 'site' && tool.typeId === t.id
          const slow = game.energizedQuarter === null && !canFinishInTime(game, t)
          return (
            <li key={t.id}>
              <button className={on ? 'plant on' : 'plant'} aria-pressed={on}
                disabled={game.phase === 'ended'}
                onClick={() => onSelect(on ? { kind: 'none' } : { kind: 'site', typeId: t.id })}>
                <span className="plant-name">{t.name}</span>
                <span className="plant-cost">{money(unitCapex(t))}</span>
                <span className="plant-firm">{mw(t.nameplateMw * t.firmCapacityFraction)} firm of {mw(t.nameplateMw)}</span>
                <span className={slow ? 'plant-time tone-bad' : 'plant-time'}>
                  {quarters(t.permitQuarters + t.buildQuarters)}{slow && ', late'}
                </span>
                {on && (
                  <span className="plant-more">
                    {t.blurb} {acres(t.acres)}. Running cost ${t.variableCostPerMwh} a MWh. {yearText(t.id)}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>

      {tool.kind === 'site' && (
        <p className="prompt">
          Click the map to place it.
          <button className="btn small" onClick={() => onSelect({ kind: 'none' })}>Cancel</button>
        </p>
      )}

      <h3>Substations</h3>
      <ul className="plants">
        {SUBSTATION_TYPES.map((t) => {
          const on = tool.kind === 'substation' && tool.kv === t.kv
          return (
            <li key={t.kv}>
              <button className={on ? 'plant on' : 'plant'} aria-pressed={on} disabled={game.phase === 'ended' || !game.equipment}
                onClick={() => onSelect(on ? { kind: 'none' } : { kind: 'substation', kv: t.kv })}>
                <span className="plant-name">New {t.kv} kV substation</span>
                <span className="plant-cost">{money(t.cost)}</span>
                <span className="plant-firm">{acres(t.acres)}</span>
                <span className="plant-time">{quarters(t.quarters)}</span>
                {on && (
                  <span className="plant-more">
                    Place it on an existing {t.kv} kV line to join that line, or anywhere and draw lines to it. Add transformers by clicking it.
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
      {(game.builtSubs ?? []).length > 0 && (
        <ul className="sited-list">
          {game.builtSubs!.map((b) => (
            <li key={b.id} className="sited">
              <div className="sited-main">
                <button className="sited-name" onClick={() => onShowSub(b.id)}>{b.name}</button>
                <span className={b.status === 'in-service' ? 'status-online' : 'status-construction'}>
                  {b.status === 'in-service' ? 'In service' : `Building, ${quarters(b.quartersRemaining)} left`}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {game.plants.length > 0 && (
        <>
          <h3>Your plants</h3>
          <ul className="sited-list">
            {game.plants.map((p) => {
              const t = plantType(p.typeId)
              const linked = joined.has(plantNode(p))
              const total = p.status === 'permitting' ? t.permitQuarters : t.buildQuarters
              const out = game.realtime?.outages.find((o) => o.assetId === p.id)
              return (
                <li key={p.id} className="sited">
                  <div className="sited-main">
                    <button className="sited-name" onClick={() => onShow(p.cell)} title="Show on the map">{p.name}</button>
                    <span className={out ? 'tone-bad' : `status-${p.status}`}>
                      {out ? `Out: ${out.cause}`
                        : p.status === 'permitting' ? `Permitting, ${quarters(p.quartersRemaining)} left`
                        : p.status === 'construction' ? `Building, ${quarters(p.quartersRemaining)} left`
                        : 'Online'}
                    </span>
                  </div>
                  {p.status !== 'online' && (
                    <span className="track">
                      <span style={{ width: `${Math.max(0, 1 - p.quartersRemaining / total) * 100}%` }} />
                    </span>
                  )}
                  {p.typeId === 'battery' && p.status === 'online' && (
                    <span className="note">{Math.round(p.socMwh)} of {batteryCapacityMwh(p)} MWh stored</span>
                  )}
                  {!linked && <span className="note tone-warn">No line to the campus yet</span>}
                  <div className="sited-actions">
                    {p.status === 'permitting' && (
                      <button className="btn small" onClick={() => onWithdraw(p.id)}>
                        Withdraw, recover {money(p.landCost * CANCEL_LAND_RECOVERY)}
                      </button>
                    )}
                    {canExpedite(p) && (
                      <button className="btn small" onClick={() => onExpedite(p.id)}>
                        Expedite one quarter, {money(expediteCost(p))}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
