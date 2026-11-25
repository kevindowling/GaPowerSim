import type { ReactNode } from 'react'
import type { Corridor, GameState, Plant } from '../engine/types.ts'
import type { Selection } from './mapHit.ts'
import { plantType } from '../data/plants.ts'
import { lineClass } from '../data/transmission.ts'
import { formatQuarter } from '../engine/time.ts'
import { plantFinish, powerForecast } from '../engine/forecast.ts'
import { canExpedite, expediteCost, CANCEL_LAND_RECOVERY } from '../engine/turn/siting.ts'
import { LineCard, SubstationCard } from './GridCards.tsx'
import { TAP_RANGE_KM } from '../data/taps.ts'
import { cellPoint } from '../engine/turn/siting.ts'
import type { MapThings } from './mapHit.ts'
import { SUBSTATION, subNode, SUBSTATION_TX, builtNode, plantNode, regionMw } from '../engine/realtime/network.ts'
import { EquipmentList, type EquipmentActions } from './EquipmentList.tsx'
import { distanceToCenterline, transformerName } from '../engine/realtime/reliability.ts'
import { batteryCapacityMwh } from '../engine/realtime/dispatch.ts'
import type { HexGrid } from '../engine/geo/mapTypes.ts'
import type { EnvData } from '../data/loadEnv.ts'
import type { DataCenter } from '../data/dataCenters.ts'
import { MainOffer, OfferCard } from './CustomerCard.tsx'
import { mainOpen, signBlocked } from '../engine/customers.ts'
import { GearBuild, GearCard } from './GearBuild.tsx'
import { lineGear } from '../engine/turn/reach.ts'
import { Progress } from './Progress.tsx'
import { focusOf } from '../engine/focus.ts'
import { subFinish } from '../engine/turn/substations.ts'
import { inReach } from '../engine/turn/corridor.ts'
import { DataCenterCard } from './DataCenterCard.tsx'
import { CountyCard } from './CountyCard.tsx'
import { Icon } from './Icon.tsx'
import { FIRM_WHY, plantPowerLines } from './power.ts'
import { acres, money, mw, quarters } from './format.ts'

interface Props extends EquipmentActions {
  game: GameState
  grid: HexGrid
  selection: Selection
  centers: readonly DataCenter[]
  env: EnvData | null
  things: MapThings
  onTapLine: (index: number) => void
  onSign: (dcId: string) => void
  onSignMain: () => void
  onSetSpare: (id: string, mw: number) => void
  onClose: () => void
  onWithdraw: (plantId: string) => void
  onExpedite: (plantId: string) => void
  onPlanLine: (fromNode: string) => void
  onOpenLine: (id: string) => void
  /** Offers for a line's land. */
  land: (c: Corridor) => ReactNode
  onRunProgramme: (fips: string, id: string) => void
}

export function Inspector(props: Props) {
  const { game, selection, onClose } = props
  const body = selection.kind === 'site' ? siteBody(props, selection.cell)
    : selection.kind === 'line' ? lineBody(props, selection.id)
    : selection.kind === 'county' ? countyBody(props, selection.fips)
    : selection.kind === 'dc' ? dcBody(props, selection.id)
    : selection.kind === 'nsub' ? builtBody(props, selection.id)
    : selection.kind === 'gsub' ? subBody(props, selection.id)
    : selection.kind === 'xline' ? existingBody(props, selection.index)
    : selection.kind === 'campus' ? campusBody(props)
    : selection.kind === 'gear' ? null
    : substationBody(props)
  const start = selection.kind === 'substation' ? SUBSTATION : null
  if (selection.kind === 'gear') {
    return <GearCard game={game} id={selection.id} kv={selection.kv} onOrder={props.onOrder} onCancelOrder={props.onCancelOrder} onClose={onClose} />
  }
  if (!body) return null
  return (
    <section className="inspector" aria-label={body.title}>
      <div className="inspector-head">
        <h2>{body.title}</h2>
        <button className="btn ghost icon-only" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      </div>
      {body.content}
      {start && game.phase !== 'ended' && (
        <button className="btn small" onClick={() => props.onPlanLine(start)}>Plan a line from here</button>
      )}
    </section>
  )
}

function siteBody({ game, onWithdraw, onExpedite, onPlanLine }: Props, cell: number) {
  const units = game.plants.filter((p) => p.cell === cell)
  if (units.length === 0) return null
  const forecast = powerForecast(game)
  const county = game.counties[units[0].countyFips]?.name ?? ''
  const title = units.length === 1 ? units[0].name : `${units.length} units, ${county} County`

  return {
    title,
    content: (
      <>
        {units.map((p) => {
          const t = plantType(p.typeId)
          const out = game.realtime?.outages.find((o) => o.assetId === p.id)
          const total = p.status === 'permitting' ? t.permitQuarters : t.buildQuarters
          const power = plantPowerLines(game, forecast, p)
          return (
            <div key={p.id} className="unit">
              <div className="line-head">
                <span>{units.length > 1 ? p.name : `${county} County`}</span>
                <span className={out ? 'tone-bad' : `status-${p.status}`}>
                  {out ? 'Out of service' : PLANT_STATUS[p.status]}
                </span>
              </div>
              {p.status !== 'online' && (
                <>
                  <span className="track"><span style={{ width: `${Math.max(0, 1 - p.quartersRemaining / total) * 100}%` }} /></span>
                  <div className="note">
                    {quarters(p.quartersRemaining)} of {p.status === 'permitting' ? 'permitting' : 'construction'} left.
                    Online {formatQuarter(plantFinish(game, p))} if nothing slips.
                  </div>
                </>
              )}
              {out && <div className="note tone-bad">{out.cause}. {out.crews > 0 ? `${out.crews} crews on site.` : 'No crew yet.'}</div>}
              <dl className="rows">
                <div><dt>Firm capacity</dt><dd>{mw(p.nameplateMw * t.firmCapacityFraction)} of {mw(p.nameplateMw)}</dd></div>
                <div><dt>Reaching the campus</dt><dd>{power.now}</dd></div>
                <div><dt>Spent</dt><dd>{money(p.capexSpent)} of {money(p.capexTotal)}</dd></div>
                {t.acres >= 200 && <div><dt>Land</dt><dd>{acres(t.acres)}</dd></div>}
                {p.typeId === 'battery' && p.status === 'online' && (
                  <div><dt>Stored</dt><dd>{Math.round(p.socMwh)} of {batteryCapacityMwh(p)} MWh</dd></div>
                )}
                {p.commissionedQuarter !== null && (
                  <div><dt>Online since</dt><dd>{formatQuarter(p.commissionedQuarter)}</dd></div>
                )}
              </dl>
              {power.notes.map((n) => <div key={n.text} className={n.warn ? 'note tone-warn' : 'note'}>{n.text}</div>)}
              {FIRM_WHY[p.typeId] && <div className="note">{FIRM_WHY[p.typeId]}</div>}
              {(p.status === 'permitting' || canExpedite(p)) && (
                <div className="row">
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
              )}
            </div>
          )
        })}
        {game.phase !== 'ended' && plantNode(units[0]) !== 'substation' && (
          <button className="btn small" onClick={() => onPlanLine(plantNode(units[0]))}>Plan a line from here</button>
        )}
      </>
    ),
  }
}

function subBody(props: Props, id: string) {
  const sub = props.things.substations.find((s) => s.id === id)
  return sub ? {
    title: sub.named ? sub.name : `${sub.kv} kV substation`,
    content: <SubstationCard game={props.game} sub={sub} onOrder={props.onOrder} onCancelOrder={props.onCancelOrder}
      onPlanLine={() => props.onPlanLine(subNode(id))} />,
  } : null
}

function existingBody(props: Props, index: number) {
  const line = props.things.lines[index]
  if (!line) return null
  const ends = [line.points[0], line.points[line.points.length - 1]].flatMap(([x, y]) => {
    let best: string | null = null
    let least = 0.7
    for (const s of props.things.substations) {
      const d = Math.hypot(s.x - x, s.y - y)
      if (d < least) { best = s.name; least = d }
    }
    return best ? [best] : []
  })
  const [sx, sy] = cellPoint(props.grid, props.game.system.substationCell)
  const near = distanceToCenterline(sx, sy, line.points) <= TAP_RANGE_KM
    || line.points.some(([x, y]) => inReach(props.game, props.grid, x, y))
  return {
    title: `Existing ${line.kv} kV line`,
    content: <LineCard game={props.game} line={line} ends={[...new Set(ends)]} near={near} onPlanLine={() => props.onTapLine(index)} />,
  }
}

function progress(props: Props, id: string) {
  return (
    <Progress game={props.game} focus={focusOf(props.game, id, props.centers)} onRun={props.onRunProgramme}
      onSetSpare={props.onSetSpare} onOrder={props.onOrder} onCancelOrder={props.onCancelOrder} onPlanLine={props.onPlanLine} />
  )
}

function dcBody(props: Props, id: string) {
  const { game, centers } = props
  const dc = centers.find((d) => d.id === id)
  const c = game.customers?.find((x) => x.id === id)
  if (c) return { title: c.name, content: progress(props, id) }
  return dc ? {
    title: dc.name,
    // What can be signed comes before the background.
    content: signBlocked(game, dc) === null
      ? <><OfferCard game={game} dc={dc} onSign={props.onSign} /><h3>About it</h3><DataCenterCard dc={dc} sized={false} /></>
      : <DataCenterCard dc={dc}><OfferCard game={game} dc={dc} onSign={props.onSign} /></DataCenterCard>,
  } : null
}

function builtBody({ game, onOrder, onCancelOrder, onPlanLine }: Props, id: string) {
  const b = game.builtSubs?.find((x) => x.id === id)
  if (!b) return null
  return {
    title: b.name,
    content: (
      <>
        <dl className="rows">
          <div><dt>Status</dt><dd>{b.status === 'in-service' ? 'In service' : `In service ${formatQuarter(subFinish(game, b))}`}</dd></div>
          <div><dt>Voltage</dt><dd>{b.kv} kV</dd></div>
          <div><dt>Existing lines</dt><dd>{b.looped ? `On a ${b.kv} kV line` : 'Not on one'}</dd></div>
          <div><dt>Spent</dt><dd>{money(b.capexSpent)} of {money(b.capexTotal)}</dd></div>
        </dl>
        {!b.looped && <p className="note">Draw a line to it from a plant, a data center, another substation or an existing line.</p>}
        <button className="btn small" onClick={() => onPlanLine(builtNode(b.id))}>Plan a line from here</button>
        {b.kv > 115 && (
          <EquipmentList game={game} places={['substation']} only={[b.kv === 500 ? 'sub-500-230' : 'sub-230-115']}
            title="Transformers here" siteId={b.id} onOrder={onOrder} onCancelOrder={onCancelOrder} />
        )}
      </>
    ),
  }
}

function countyBody({ game, grid, env, onRunProgramme }: Props, fips: string) {
  const county = game.counties[fips]
  if (!county) return null
  return {
    title: `${county.name} County`,
    content: <CountyCard game={game} grid={grid} fips={fips} env={env} onRun={onRunProgramme} />,
  }
}

export const PLANT_STATUS: Record<Plant['status'], string> = {
  permitting: 'Permitting', construction: 'Under construction', online: 'Online', outage: 'Out of service',
}

export const LINE_STATUS: Record<string, string> = {
  acquiring: 'Buying land', building: 'Building', energized: 'In service', planned: 'Planned',
}

function lineBody({ game, land, onOpenLine, onOrder, onCancelOrder }: Props, id: string) {
  const c = game.corridors.find((x) => x.id === id)
  if (!c) return null
  const cls = lineClass(c.classId)
  const out = game.realtime?.outages.find((o) => o.assetId === id)
  const flow = game.realtime?.history[game.realtime.history.length - 1]?.lineFlowMw[id]
  return {
    title: c.name,
    content: (
      <>
        <dl className="rows">
          <div><dt>Status</dt><dd className={out ? 'tone-bad' : ''}>{out ? out.cause : LINE_STATUS[c.status]}</dd></div>
          <div><dt>Rating</dt><dd>{mw(cls.ratingMw)}, {c.lengthKm.toFixed(1)} km</dd></div>
          {c.status === 'building' && <div><dt>Construction</dt><dd>{quarters(c.buildQuartersRemaining)} left</dd></div>}
          {c.status !== 'energized' && <div><dt>Spent</dt><dd>{money(c.capexSpent)} of {money(c.capexTotal)}</dd></div>}
          {flow !== undefined && <div><dt>Carrying</dt><dd>{mw(flow)}</dd></div>}
        </dl>
        {lineGear(game, c).filter((t) => t.state !== 'installed').map((t) => (
          <GearBuild key={t.id} game={game} id={t.id} kv={cls.kv} onOrder={onOrder} onCancelOrder={onCancelOrder} />
        ))}
        {c.status === 'acquiring' && land(c)}
        {c.status === 'building' && <button className="btn small" onClick={() => onOpenLine(id)}>Open in Grid</button>}
      </>
    ),
  }
}

function campusBody(props: Props) {
  if (props.game.contract.status === 'offered' && !mainOpen(props.game)) {
    return { title: props.game.contract.name, content: <p className="note">It went to another supplier.</p> }
  }
  if (props.game.contract.status === 'offered') {
    return { title: props.game.contract.name, content: <MainOffer game={props.game} onSign={props.onSignMain} /> }
  }
  return { title: props.game.contract.name, content: progress(props, 'main') }
}

function existingGear(game: GameState, ids: readonly string[], total: number) {
  return ids.map((id) => ({
    name: transformerName(game, id).replace(/ at .*/, ''), mw: total / ids.length,
    out: game.realtime?.outages.some((o) => o.assetId === id) ?? false,
  }))
}

function substationBody({ game, onOrder, onCancelOrder }: Props) {
  const now = game.realtime?.history[game.realtime.history.length - 1]
  return {
    title: game.system.substationName,
    content: (
      <>
      <dl className="rows">
        <div><dt>The region can send</dt><dd>{mw(now?.importLimitMw ?? regionMw(game))}</dd></div>
        {now && <div><dt>Importing</dt><dd>{mw(now.marketMw)}</dd></div>}
        <div><dt>Tie to the campus</dt><dd>{mw(game.system.tieMw)}</dd></div>
        <div><dt>People served</dt><dd>{game.system.servedPopulation.toLocaleString()}</dd></div>
      </dl>
      {game.phase === 'build' && (
        <div className="note">Imports run in the operating year. They do not count toward the campus during the build.</div>
      )}
      <EquipmentList game={game} places={['substation']} title="Transformers here"
        existing={existingGear(game, SUBSTATION_TX, game.system.transformerMw ?? 0)} onOrder={onOrder} onCancelOrder={onCancelOrder} />
      <EquipmentList game={game} places={['area']} title="Existing lines nearby" onOrder={onOrder} onCancelOrder={onCancelOrder} />
      </>
    ),
  }
}
