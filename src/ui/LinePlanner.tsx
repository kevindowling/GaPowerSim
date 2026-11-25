import type { GameState } from '../engine/types.ts'
import { LINE_CLASSES, lineClass, type LineClassId } from '../data/transmission.ts'
import { ROUTE_STYLES, type RouteStyle } from '../engine/geo/fineRoute.ts'
import type { Tool } from '../state/gameStore.ts'
import type { CorridorPlan } from '../engine/turn/corridor.ts'
import { plannedFlow, plannedWithLine, spareRoomMw } from '../engine/realtime/network.ts'
import { assignSpare } from '../engine/customers.ts'
import { linePower, needAt, suggestSpare, type LinePower } from '../engine/turn/reach.ts'
import { Icon } from './Icon.tsx'
import { GearBuild } from './GearBuild.tsx'
import { SpareSlider } from './SpareSlider.tsx'
import { money, mw, acres, quarters, plural } from './format.ts'

interface Props {
  game: GameState
  tool: Extract<Tool, { kind: 'route' }>
  plan: CorridorPlan | null
  planNote: string | null
  parcelsLoading: boolean
  onSetClass: (id: LineClassId) => void
  onSetStyle: (id: RouteStyle) => void
  onUndoWaypoint: () => void
  onStartOver: () => void
  onCommit: () => void
  onCancel: () => void
  onOrder: (id: string, rush: boolean, siteId?: string) => void
  onCancelOrder: (id: string) => void
  planSpare: number | null
  onSetSpare: (mw: number) => void
}

/** The kind of line, its route, and what it would do. */
export function LinePlanner({
  game, tool, plan, planNote, parcelsLoading, onSetClass, onSetStyle, onUndoWaypoint, onStartOver, onCommit, onCancel, onOrder, onCancelOrder, planSpare, onSetSpare,
}: Props) {
  const need = !plan && tool.from ? needAt(game, tool.from.id) : null
  const title = plan ? `${plan.from.label} to ${plan.to.label}` : tool.from ? `From ${tool.from.label}` : 'New line'
  return (
    <section className="inspector planner" aria-label="Plan a line">
      <div className="inspector-head">
        <h2>{title}</h2>
        <button className="btn ghost icon-only" onClick={onCancel} aria-label="Cancel the line"><Icon name="close" /></button>
      </div>
      {parcelsLoading && <p className="prompt">Loading parcels.</p>}
      {!plan && !parcelsLoading && (
        <p className="note">{tool.from ? 'Click or drag to where it connects.' : 'Click either end first.'}</p>
      )}
      {need && (need.leftMw === 0
        ? <p className="note tone-good">Everything filed already brings all its power.</p>
        : <p className="note">It still needs {mw(need.leftMw)}, {mw(need.nextMw)} of it for the next phase. Blue lines and ringed substations have room for that phase.</p>)}
      {planNote && <p className="note tone-bad">{planNote}</p>}

      <div className="segmented four" role="group" aria-label="Voltage">
        {LINE_CLASSES.map((c) => (
          <button key={c.id} className={tool.classId === c.id ? 'on' : ''}
            onClick={() => onSetClass(c.id)} aria-pressed={tool.classId === c.id}>
            <span>{c.kv} kV{c.circuits > 1 ? ' double' : ''}</span>
            <small>{mw(c.ratingMw)}</small>
          </button>
        ))}
      </div>
      <p className="note">{lineClass(tool.classId).blurb} {money(lineClass(tool.classId).capexPerKm)} a km.</p>
      <div className="segmented two" role="group" aria-label="Route style">
        {ROUTE_STYLES.map((s) => (
          <button key={s.id} className={tool.style === s.id ? 'on' : ''}
            onClick={() => onSetStyle(s.id)} aria-pressed={tool.style === s.id}>
            <span>{s.label}</span>
          </button>
        ))}
      </div>
      <p className="note">{ROUTE_STYLES.find((s) => s.id === tool.style)?.blurb}</p>

      {plan && <PlanBody game={game} plan={plan} planSpare={planSpare} onUndoWaypoint={onUndoWaypoint} onOrder={onOrder} onCancelOrder={onCancelOrder} onSetSpare={onSetSpare} />}
      {plan && (
        <div className="row planner-foot">
          <button className="btn primary" onClick={onCommit}>File this route</button>
          <button className="btn" onClick={onStartOver}>Start over</button>
        </div>
      )}
    </section>
  )
}

function PlanBody({ game, plan, planSpare, onUndoWaypoint, onOrder, onCancelOrder, onSetSpare }: {
  game: GameState
  plan: CorridorPlan
  planSpare: number | null
  onUndoWaypoint: () => void
  onOrder: (id: string, rush: boolean, siteId?: string) => void
  onCancelOrder: (id: string) => void
  onSetSpare: (mw: number) => void
}) {
  const line = { fromNode: plan.from.id, toNode: plan.to.id, classId: plan.classId }
  const end = linePower(game, line)
  // As it will be once the line is filed.
  const drafted = end ? assignSpare(game, end.id, planSpare ?? suggestSpare(game, line)) : game
  const p = linePower(drafted, line)
  const why = p && whyPower(drafted, p)
  const before = plannedFlow(game).loads
  const others = [...plannedWithLine(drafted, line).loads].map(([id, then]) => ({ id, then, now: before.get(id) ?? 0 }))
    .filter((r) => r.id !== p?.id && Math.abs(r.then - r.now) >= 0.5)
  const nameOf = (id: string): string => game.customers?.find((c) => c.id === id)?.name ?? game.contract.name

  return (
    <div className="plan">
      <dl className="rows">
        {p && (
          <>
            <div>
              <dt>Power once this is built</dt>
              <dd className={p.then - p.now < 0.5 && p.then + 0.5 < p.needMw ? 'tone-warn' : ''} data-testid="plan-power">
                {mw(p.then)} of {mw(p.needMw)}{p.then - p.now >= 0.5 && `, up from ${mw(p.now)}`}
              </dd>
            </div>
            <div><dt>Phases powered</dt><dd data-testid="plan-phases">{p.phases.on} of {p.phases.count}</dd></div>
          </>
        )}
        {others.map((r) => (
          <div key={r.id}><dt>{nameOf(r.id)}</dt><dd>{mw(r.then)}, up from {mw(r.now)}</dd></div>
        ))}
      </dl>
      {p && (
        <>
          <GearBuild game={game} id={p.id} kv={lineClass(plan.classId).kv} onOrder={onOrder} onCancelOrder={onCancelOrder} />
          <SpareSlider game={drafted} id={p.id} value={p.spareMw} most={Math.max(0, p.needMw - p.baseMw)} arriving={p.spareArriving} onSet={(_, v) => onSetSpare(v)} />
          {why && <p className={p.then + 0.5 < p.needMw ? 'note tone-warn' : 'note tone-good'} data-testid="plan-why">{why}</p>}
        </>
      )}
      <dl className="rows">
        <div><dt>Length</dt><dd>{plan.lengthKm.toFixed(1)} km</dd></div>
        <div><dt>Parcels crossed</dt><dd data-testid="plan-parcels">{plan.takings.parcelsAffected}</dd></div>
        <div><dt>Cut in two</dt><dd data-testid="plan-severed">{plan.takings.parcelsSevered}</dd></div>
        <div><dt>Buildings within 150 m</dt><dd>{plan.buildingsNear}</dd></div>
        <div><dt>Water crossings</dt><dd>{plan.waterCrossings}</dd></div>
        {plan.taps.cost > 0 && (
          <div><dt>Station at the tap</dt><dd data-testid="plan-tap">{money(plan.taps.cost)}{plan.taps.quarters > 0 && `, ${quarters(plan.taps.quarters)}`}</dd></div>
        )}
        <div><dt>Right of way</dt><dd data-testid="plan-acres">{acres(plan.takings.totalAcres)}</dd></div>
        <div><dt>Appraised land</dt><dd>{money(plan.rowAppraised)}</dd></div>
        <div><dt>Construction</dt><dd>{money(plan.lineCapex)}, {quarters(plan.buildQuarters)}</dd></div>
      </dl>
      {plan.blocked > 0 && (
        <p className="note tone-bad">
          {plural(plan.blocked, 'protected parcel')} on this route. It cannot be completed as drawn.
        </p>
      )}
      <p className="note">
        Click the map to bend the route through a point.
        {plan.waypoints.length > 0 && <button className="btn small" onClick={onUndoWaypoint}>Remove last bend</button>}
      </p>
      <p className="fine">Parcels and owners are generated. They are not county records.</p>
    </div>
  )
}

/** Why a line brings what it does. */
function whyPower(game: GameState, p: LinePower): string | null {
  if (p.then + 0.5 >= p.needMw) return 'That is all it needs.'
  const more = p.most - p.then
  if (more < 0.5) {
    return p.id === 'main'
      ? `No more spare power fits this way. The region can send ${mw(spareRoomMw(game, () => true))} through ${game.system.substationName} after homes are served. Upgrade the substation or connect a plant.`
      : 'No more spare power fits this way. Connect a plant, add a line, or upgrade the existing lines nearby.'
  }
  const each = p.needMw / p.phases.count
  const atMost = Math.floor((p.most + 1e-6) / each)
  if (atMost <= p.phases.on) {
    const fix = p.id === 'main' ? `Upgrade ${game.system.substationName} or connect a plant.` : 'Upgrade the existing lines nearby, add another line, or connect a plant.'
    return `The most this can bring is ${mw(p.most)}, and a phase takes ${mw(each)}. ${p.phases.on > 0 ? 'Another phase does not fit.' : 'No phase fits, so no spare power is set aside.'} ${fix}`
  }
  // A missing transformer is marked on the line.
  if (p.needsGear && p.spareMw + 0.5 >= atMost * each - p.baseMw) return null
  return `With more spare power set aside this could bring ${mw(p.most)}.`
}
