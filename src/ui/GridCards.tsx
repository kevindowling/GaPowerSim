import type { GameState } from '../engine/types.ts'
import type { Substation } from '../data/substations.ts'
import type { MapLine } from './mapHit.ts'
import { EQUIPMENT, RUSH_QUARTERS, type EquipmentId } from '../data/equipment.ts'
import { tapClassFor, TAP_RANGE_KM } from '../data/taps.ts'
import { equipmentCost, gearFinish, orderBlocked } from '../engine/turn/equipment.ts'
import { poolMw } from '../engine/realtime/network.ts'
import { formatQuarter } from '../engine/time.ts'
import { money, mw, quarters } from './format.ts'

export function feedsArea(game: GameState, id: string): boolean {
  return game.substations?.some((s) => s.id === id) ?? false
}

const FIRST: Partial<Record<number, EquipmentId>> = { 230: 'sub-230-115', 500: 'area-500' }

/** A real substation and its transformers. */
export function SubstationCard({ game, sub, onOrder, onCancelOrder, onPlanLine }: {
  game: GameState
  sub: Substation
  onOrder: (id: string, rush: boolean, siteId?: string) => void
  onCancelOrder: (id: string) => void
  onPlanLine: () => void
}) {
  const near = feedsArea(game, sub.id)
  const offer = FIRST[sub.kv >= 500 ? 500 : sub.kv >= 230 ? 230 : 0]
  const type = EQUIPMENT.find((e) => e.id === offer)
  const mine = (game.equipment ?? []).filter((e) => e.siteId === sub.id)
  const mapped = sub.transformers.reduce((n, t) => n + t.count, 0)
  const blocked = offer ? orderBlocked(game, offer) : null
  return (
    <>
      <dl className="rows">
        <div><dt>Voltage</dt><dd>{sub.voltages.join(', ')} kV</dd></div>
        <div><dt>Operator</dt><dd>{sub.operator ?? 'Not mapped'}</dd></div>
        <div><dt>Transformers mapped</dt><dd>{mapped === 0 ? 'None' : mapped}</dd></div>
        {sub.transformers.filter((t) => t.rating || t.high).slice(0, 6).map((t, i) => (
          <div key={i}>
            <dt>{t.high && t.low ? `${t.high}/${t.low} kV` : t.high ? `${t.high} kV` : 'Transformer'}{t.count > 1 ? ` × ${t.count}` : ''}</dt>
            <dd>{t.rating ?? 'Size not mapped'}</dd>
          </div>
        ))}
        {mine.map((e) => (
          <div key={e.id}>
            <dt>
              Yours{e.status === 'ordered' && <button className="btn small ghost danger" onClick={() => onCancelOrder(e.id)}>Cancel</button>}
            </dt>
            <dd>{e.status === 'ordered' ? `${mw(type?.mw ?? 0)} in ${formatQuarter(gearFinish(game, e))}` : mw(type?.mw ?? 0)}</dd>
          </div>
        ))}
      </dl>
      {near && type && (
        <>
          <div className="line-head"><span>{type.name}</span><span className="num">{mw(type.mw)}</span></div>
          <p className="note">{blocked ?? type.blurb}</p>
          {!blocked && (
            <div className="row">
              <button className="btn small" onClick={() => onOrder(type.id, false, sub.id)}>
                Order, {money(type.cost)}, {quarters(type.quarters)}
              </button>
              {type.rush && (
                <button className="btn small" onClick={() => onOrder(type.id, true, sub.id)}>
                  From stock, {money(equipmentCost(type.id, true))}, {quarters(RUSH_QUARTERS)}
                </button>
              )}
            </div>
          )}
        </>
      )}
      {near && !type && <p className="note">It steps 115 kV down to local lines. Nothing here limits a campus.</p>}
      {near
        ? <button className="btn small" onClick={onPlanLine}>Plan a line from here</button>
        : <p className="note">It is more than {TAP_RANGE_KM} km from any data center you supply.</p>}
      <p className="fine">From OpenStreetMap. Not every transformer is mapped.</p>
    </>
  )
}

/** An existing line. */
export function LineCard({ game, line, ends, near, onPlanLine }: {
  game: GameState
  line: MapLine
  ends: string[]
  near: boolean
  onPlanLine: () => void
}) {
  const tap = tapClassFor(line.kv)
  let km = 0
  for (let i = 1; i < line.points.length; i++) {
    km += Math.hypot(line.points[i][0] - line.points[i - 1][0], line.points[i][1] - line.points[i - 1][1])
  }
  return (
    <>
      <dl className="rows">
        <div><dt>Voltage</dt><dd>{line.kv} kV</dd></div>
        <div><dt>Length of this section</dt><dd>{km.toFixed(1)} km</dd></div>
        {ends.length > 0 && <div><dt>Ends near</dt><dd>{ends.join(' and ')}</dd></div>}
        {near && tap && <div><dt>Room to spare on {tap.kv} kV lines here</dt><dd>{mw(poolMw(game, tap.kv))}</dd></div>}
        {near && tap && <div><dt>Station to tap it</dt><dd>{money(tap.cost)}, {quarters(tap.quarters)}</dd></div>}
      </dl>
      {!tap ? <p className="note">Lines under 115 kV are too small to tap.</p>
        : near ? <button className="btn small" onClick={onPlanLine}>Plan a line from here</button>
        : <p className="note">It is more than {TAP_RANGE_KM} km from any data center you supply.</p>}
      <p className="fine">Lines are from OpenStreetMap. Room to spare is invented.</p>
    </>
  )
}
