import type { GameState } from '../engine/types.ts'
import { equipmentType, RUSH_QUARTERS, type EquipmentId } from '../data/equipment.ts'
import { equipmentCost, gearFinish } from '../engine/turn/equipment.ts'
import { dcNode } from '../engine/realtime/network.ts'
import { formatQuarter } from '../engine/time.ts'
import { Icon } from './Icon.tsx'
import type { EquipmentActions } from './EquipmentList.tsx'
import { money, mw, quarters } from './format.ts'

const SIGN = { missing: '#c2271d', ordered: '#c77700', installed: '#2f7a4d' }

/** The sign drawn on a line. */
export function TransformerSign({ state }: { state: keyof typeof SIGN }) {
  const c = SIGN[state]
  return (
    <svg viewBox="0 0 28 28" width="24" height="24" aria-hidden="true">
      <circle cx="14" cy="14" r="12" fill="#fff" stroke={c} strokeWidth="2.2" strokeDasharray={state === 'missing' ? '4 3' : undefined} />
      <circle cx="11.4" cy="14" r="4.3" fill="none" stroke={c} strokeWidth="1.8" />
      <circle cx="16.6" cy="14" r="4.3" fill="none" stroke={c} strokeWidth="1.8" />
    </svg>
  )
}

type Build = EquipmentActions & { game: GameState; id: string; kv: number }

/** The transformer a line needs at a data center: what there is, and buttons to build it. */
export function GearBuild({ game, id, kv, onOrder, onCancelOrder }: Build) {
  if (!game.equipment) return null
  const site = id === 'main' ? undefined : dcNode(id)
  const typeId = `campus-${kv}` as EquipmentId
  const t = equipmentType(typeId)
  const here = game.equipment.filter((e) => e.typeId === typeId && e.siteId === site)
  const existing = id === 'main' && kv === 115
  const state = existing || here.some((e) => e.status === 'installed') ? 'installed' : here.length > 0 ? 'ordered' : 'missing'
  return (
    <div className="gear-build">
      <div className="gear-head"><TransformerSign state={state} /><strong>{kv} kV transformer</strong><span className="num">{mw(t.mw)}</span></div>
      {existing && <p className="note">One is already here, {mw(game.system.tieMw)}.</p>}
      {here.map((e) => (
        <div key={e.id} className="line-head">
          <span className={e.status === 'ordered' ? 'tone-warn' : 'tone-good'}>
            {e.status === 'ordered' ? `Being built, in service ${formatQuarter(gearFinish(game, e))}` : 'In service'}
          </span>
          {e.status === 'ordered' && <button className="btn small ghost danger" onClick={() => onCancelOrder(e.id)}>Cancel</button>}
        </div>
      ))}
      {state === 'missing' && game.phase !== 'ended' && (
        <div className="gear-buttons">
          <button className="btn small primary" onClick={() => onOrder(typeId, false, site)}>
            Build, {money(t.cost)}, {quarters(t.quarters)}
          </button>
          {t.rush && (
            <button className="btn small" onClick={() => onOrder(typeId, true, site)}>
              Build from stock, {money(equipmentCost(typeId, true))}, {quarters(RUSH_QUARTERS)}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** The same, as a card on the map. */
export function GearCard({ onClose, ...p }: Build & { onClose: () => void }) {
  const name = p.id === 'main' ? p.game.contract.name : p.game.customers?.find((c) => c.id === p.id)?.name ?? ''
  return (
    <section className="inspector gear-card" aria-label={`Transformer at ${name}`}>
      <div className="inspector-head">
        <h2>{name}</h2>
        <button className="btn ghost icon-only" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      </div>
      <GearBuild {...p} />
    </section>
  )
}
