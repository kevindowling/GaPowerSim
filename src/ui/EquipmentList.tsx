import type { GameState } from '../engine/types.ts'
import { EQUIPMENT, RUSH_QUARTERS, equipmentType, type EquipmentId, type EquipmentPlace } from '../data/equipment.ts'
import { equipmentCost, gearFinish, gearName, orderBlocked } from '../engine/turn/equipment.ts'
import { formatQuarter } from '../engine/time.ts'
import { money, mw, quarters } from './format.ts'

export interface EquipmentActions {
  onOrder: (id: string, rush: boolean, siteId?: string) => void
  onCancelOrder: (id: string) => void
}

/** What has been ordered for a place, and what can be. */
export function EquipmentList({ game, places, title, existing, siteId, only, onOrder, onCancelOrder }: EquipmentActions & {
  game: GameState
  places: readonly EquipmentPlace[]
  title: string
  /** Where, if not at the first campus or its substation. */
  siteId?: string
  only?: readonly EquipmentId[]
  existing?: Array<{ name: string; mw: number; out: boolean }>
}) {
  if (!game.equipment) return null
  const mine = game.equipment.filter((e) => places.includes(equipmentType(e.typeId).place) && e.siteId === siteId)
  const down = new Set(game.realtime?.outages.map((o) => o.assetId))
  return (
    <>
      <h3>{title}</h3>
      {(existing?.length || mine.length > 0) as boolean && (
        <dl className="rows">
          {existing?.map((e) => (
            <div key={e.name}><dt>{e.name}</dt><dd className={e.out ? 'tone-bad' : ''}>{e.out ? 'Out of service' : mw(e.mw)}</dd></div>
          ))}
          {mine.map((e) => (
            <div key={e.id}>
              <dt>
                {equipmentType(e.typeId).name}
                {e.status === 'ordered' && (
                  <button className="btn small ghost danger" onClick={() => onCancelOrder(e.id)}
                    aria-label={`Cancel ${gearName(game, e)}`}>Cancel</button>
                )}
              </dt>
              <dd className={down.has(e.id) ? 'tone-bad' : e.status === 'ordered' ? 'tone-warn' : ''}>
                {down.has(e.id) ? 'Out of service'
                  : e.status === 'ordered' ? `${mw(equipmentType(e.typeId).mw)} in ${formatQuarter(gearFinish(game, e))}`
                  : mw(equipmentType(e.typeId).mw)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {game.phase !== 'ended' && (
        <ul className="orders">
          {EQUIPMENT.filter((t) => places.includes(t.place) && (!only || only.includes(t.id))).map((t) => {
            const blocked = orderBlocked(game, t.id, siteId)
            return (
              <li key={t.id}>
                <div className="line-head"><span>{t.name}</span><span className="num">{mw(t.mw)}</span></div>
                <div className="note">{blocked ?? t.blurb}</div>
                {!blocked && (
                  <div className="row">
                    <button className="btn small" onClick={() => onOrder(t.id, false, siteId)}>
                      Order, {money(t.cost)}, {quarters(t.quarters)}
                    </button>
                    {t.rush && (
                      <button className="btn small" onClick={() => onOrder(t.id, true, siteId)}>
                        From stock, {money(equipmentCost(t.id, true))}, {quarters(RUSH_QUARTERS)}
                      </button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
