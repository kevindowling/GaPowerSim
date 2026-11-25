import { useEffect, useRef, useState, useCallback, useMemo, type ReactNode } from 'react'
import { useGame } from '../state/gameStore.ts'
import { MapView, type MapTip } from './MapView.tsx'
import { HUD } from './HUD.tsx'
import { BuildPanel } from './panels/BuildPanel.tsx'
import { GridPanel } from './panels/GridPanel.tsx'
import { LandPanel } from './panels/LandPanel.tsx'
import { OpsPanel } from './panels/OpsPanel.tsx'
import { LogPanel } from './panels/LogPanel.tsx'
import { TutorialCoach } from './TutorialCoach.tsx'
import { BriefingDialog, EventDialog, HearingDialog, MenuDialog, ScoreDialog } from './dialogs.tsx'
import { Icon } from './Icon.tsx'
import { STATUS_TEXT } from './DataCenterCard.tsx'
import { plannedFlow } from '../engine/realtime/network.ts'
import { lineGear, needAt, roomAt, sortLines } from '../engine/turn/reach.ts'
import { GearCard } from './GearBuild.tsx'
import { LinePlanner } from './LinePlanner.tsx'
import { CustomersPanel } from './panels/CustomersPanel.tsx'
import { STOPPED, type DataCenter } from '../data/dataCenters.ts'
import { Inspector, LINE_STATUS, PLANT_STATUS } from './Inspector.tsx'
import { countyAt, isMain, mapHit, selectionPoint, subFrom, type MapThings, type Selection } from './mapHit.ts'
import { activeCustomers, beginCompany, firstDue, isExisting, openOffers } from '../engine/customers.ts'
import { focusOf } from '../engine/focus.ts'
import { approvalBand, ratingOf } from '../engine/approval.ts'
import type { GameState } from '../engine/types.ts'
import { useMediaQuery, MOBILE_QUERY } from './useMediaQuery.ts'
import type {
  Marker, Overlay, SitingPreview, CorridorDraw, ParcelTint, NodeDraw, FootprintDraw, DataCenterDraw, SubstationDraw,
} from '../render/mapRenderer.ts'
import { corridorBuffer } from '../engine/geo/polygon.ts'
import { lineClass } from '../data/transmission.ts'
import type { IconKey } from '../render/icons.ts'
import { plantType, type PlantKind } from '../data/plants.ts'
import { assessSubstation, type SubstationSite } from '../engine/turn/substations.ts'
import { substationType } from '../data/newSubstations.ts'
import { assessSite, cellPoint, footprintCells, type SiteAssessment } from '../engine/turn/siting.ts'
import { networkNodes, type NetNode } from '../engine/turn/corridor.ts'
import { capacityDerates } from '../engine/realtime/reliability.ts'
import { approvalFill } from '../render/mapRenderer.ts'
import { airFill, countyEnvLines, projectionLines, waterFill } from './environment.ts'
import type { EnvData } from '../data/loadEnv.ts'
import { firmFlow } from '../engine/realtime/network.ts'
import { formatQuarter } from '../engine/time.ts'
import { money, acres, mw } from './format.ts'

const PLANT_ICON: Record<PlantKind, IconKey> = {
  'gas-ct': 'gasCt',
  'gas-ccgt': 'gasCcgt',
  solar: 'solar',
  battery: 'battery',
  'nuclear-uprate': 'nuclear',
}

const OVERLAYS: Array<{ id: Overlay; label: string; help: string }> = [
  { id: 'none', label: 'Land', help: 'Fields, woods and towns.' },
  { id: 'population', label: 'People', help: 'Where people live. Building near them costs approval.' },
  { id: 'landValue', label: 'Land value', help: 'What land and right-of-way cost.' },
  { id: 'air', label: 'Air', help: 'Fine particles by county. Darker is worse. The yearly limit is 9 µg/m³.' },
  { id: 'water', label: 'Water', help: 'Darker counties have more impaired streams. Orange streams are impaired, blue are good, grey are not assessed.' },
  { id: 'approval', label: 'Approval', help: 'Green is supportive, red is hostile. Only the data center\'s county and those bordering it are rated.' },
]

type Tab = 'build' | 'grid' | 'ops' | 'customers' | 'log'

export function App({ embedded = false }: { embedded?: boolean }) {
  const g = useGame()
  const { game, mapData, scenario, tool, plan, parcels, selectedCorridor } = g
  const { load, ensureBasemap, ensureParcels, setHoverCell } = g

  const [overlay, setOverlay] = useState<Overlay>('none')
  const [layers, setLayers] = useState({ hexes: false, imagery: true, roads: true, water: true })
  const [scale, setScale] = useState(1)
  const [focus, setFocus] = useState<{ x: number; y: number; scale: number } | null>(null)
  const [tab, setTab] = useState<Tab>('build')
  const isMobile = useMediaQuery(MOBILE_QUERY)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [layersOpen, setLayersOpen] = useState(false)

  useEffect(() => { void load() }, [load])
  const fips = game?.contract.countyFips
  useEffect(() => {
    if (!fips) return
    void ensureBasemap()
    void ensureParcels()
  }, [fips, ensureBasemap, ensureParcels])

  // Show every contract when a game opens, or the campus once it has signed.
  const siteCell = game?.contract.siteCell
  useEffect(() => {
    if (!mapData || siteCell === undefined || g.showBriefing) return
    const [x, y] = cellPoint(mapData.grid, siteCell)
    const list = game?.contract.status === 'offered' ? [...activeCustomers(game), ...openOffers(game)] : []
    if (list.length === 0) {
      setFocus({ x, y, scale: isMobile ? 16 : 24 })
      return
    }
    const xs = [x, ...list.map((c) => c.x)]
    const ys = [y, ...list.map((c) => c.y)]
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const wide = window.innerWidth - (isMobile ? 60 : 480)
    const tall = window.innerHeight - (isMobile ? 360 : 220)
    setFocus({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, scale: Math.max(0.7, Math.min(8, wide / (x1 - x0 + 1), tall / (y1 - y0 + 1))) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapData, siteCell, g.showBriefing, game?.contract.status === 'offered'])

  // Follow the work: operations after energizing.
  const picked = g.selection
  useEffect(() => { if (picked && isMobile) setSheetOpen(true) }, [picked, isMobile])
  const operating = game?.phase === 'operate'
  useEffect(() => { if (operating) setTab('ops') }, [operating])

  useEffect(() => {
    if (g.headlines.length === 0) return
    const t = setTimeout(() => useGame.getState().dismissHeadlines(), 9000)
    return () => clearTimeout(t)
  }, [g.headlines])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      useGame.getState().stepBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const overlayRef = useRef(overlay)
  overlayRef.current = overlay
  const tipAt = useCallback((x: number, y: number, cell: number, pxPerKm: number): MapTip | null => {
    const st = useGame.getState()
    if (!st.game || !st.mapData || st.tool.kind === 'route') return null
    const { grid } = st.mapData
    if (st.tool.kind === 'substation') return substationTip(st.game, assessSubstation(st.game, st.tool.kv, cell, grid, st.gridLines()), st.tool.kv)
    if (st.tool.kind === 'site') return siteTip(st.game, assessSite(st.game, st.tool.typeId, cell, grid), st.tool.typeId, st.env, x, y)
    // On the air and water layers the county answers, so lines stay quiet.
    const reading = overlayRef.current === 'air' || overlayRef.current === 'water'
    const hit = mapHit(st.game, grid, x, y, cell, pxPerKm, st.shownCenters(), reading ? undefined : st.mapThings())
    if (hit) return JSON.stringify(hit) === JSON.stringify(st.selection) ? null : hitTip(st.game, hit, st.dataCenters, st.mapThings())
    const county = st.game.counties[countyAt(grid, cell) ?? '']
    if (!county) return null
    if (st.selection?.kind === 'county' && st.selection.fips === county.fips) return null
    return {
      title: `${county.name} County`,
      lines: overlayRef.current === 'air' || overlayRef.current === 'water'
        ? countyEnvLines(st.env?.counties[county.fips], overlayRef.current)
        : [ratingText(st.game, county.fips)],
    }
  }, [])

  const outages = game?.realtime?.outages
  const plants = game?.plants
  const markers = useMemo<Marker[]>(() => {
    if (!game) return []
    const out: Marker[] = [
      { cell: game.system.substationCell, kind: 'substation', label: game.system.substationName, icon: 'tower' },
      ...openOffers(game).map((o): Marker => ({ cell: -1, at: [o.x, o.y], kind: 'datacenter-offer', label: o.name, icon: 'dataCenter' })),
      ...activeCustomers(game).map((c): Marker => ({ cell: c.cell, at: [c.x, c.y], kind: 'datacenter', label: c.name, icon: 'dataCenter' })),
      { cell: game.contract.siteCell, kind: game.contract.status === 'offered' ? 'datacenter-offer' : 'datacenter', label: game.contract.name, icon: 'dataCenter' },
    ]
    for (const b of game.builtSubs ?? []) {
      out.push({ cell: b.cell, kind: b.status === 'in-service' ? 'substation' : 'substation-building', label: b.name, icon: 'tower' })
    }
    const down = new Set(outages?.filter((o) => o.capacityFraction <= 0).map((o) => o.assetId))
    const sites = new Map<number, typeof game.plants>()
    for (const p of game.plants) sites.set(p.cell, [...(sites.get(p.cell) ?? []), p])
    for (const units of sites.values()) {
      const p = units.find((u) => u.status !== 'online') ?? units[0]
      const t = plantType(p.typeId)
      const total = p.status === 'permitting' ? t.permitQuarters : t.buildQuarters
      const mixed = units.some((u) => u.typeId !== p.typeId)
      out.push({
        cell: p.cell,
        kind: units.some((u) => down.has(u.id)) ? 'plant-out'
          : p.status === 'online' ? 'plant-online'
          : p.status === 'construction' ? 'plant-construction' : 'plant-permitting',
        label: units.length === 1 ? p.name
          : mixed ? `${units.length} plants` : `${units.length} × ${t.shortName.toLowerCase()}`,
        count: units.length,
        progress: Math.max(0, (total - p.quartersRemaining) / total),
        icon: PLANT_ICON[p.typeId],
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plants, game?.customers, game?.offers, game?.quarter, game?.contract.status, game?.builtSubs, game?.contract.siteCell, game?.system.substationCell, outages])

  // The header behind the opening shows how the game will start.
  const opened = useMemo(() => (g.showBriefing && game && mapData && g.dataCenters.length > 0
    ? beginCompany(game, g.dataCenters, mapData.counties, mapData.grid) : game), [g.showBriefing, game, mapData, g.dataCenters])

  const committed = game?.corridors
  const buffers = useMemo(
    () => new Map((committed ?? []).map((c) =>
      [c.id, corridorBuffer(c.centerline, lineClass(c.classId).rowHalfWidthKm)])),
    [committed],
  )
  const corridors = useMemo<CorridorDraw[]>(() => {
    const derates = game?.realtime ? capacityDerates(game.realtime) : new Map<string, number>()
    const out: CorridorDraw[] = (committed ?? []).map((c) => ({
      centerline: c.centerline,
      buffer: buffers.get(c.id) ?? [],
      status: c.status,
      available: derates.get(c.id) ?? 1,
      gear: game ? lineGear(game, c) : [],
    }))
    if (plan) out.push({ centerline: plan.centerline, buffer: plan.takings.buffer, status: 'planned', available: 1,
      gear: game ? lineGear(game, { fromNode: plan.from.id, toNode: plan.to.id, classId: plan.classId }) : [] })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed, buffers, outages, plan, game?.equipment, game?.customers])

  const centers = useMemo<DataCenterDraw[]>(() => {
    const picked = g.selection?.kind === 'dc' ? g.selection.id : ''
    const icons = new Set(game ? [...activeCustomers(game), ...openOffers(game)].map((c) => c.id) : [])
    return useGame.getState().shownCenters().filter((d) => !icons.has(d.id)).map((d) => ({
      x: d.x, y: d.y, mw: d.mw, label: d.name, stopped: STOPPED.has(d.status), selected: d.id === picked,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.dataCenters, g.showCenters, scenario, g.selection, game?.customers, game?.offers, game?.quarter])

  const things = g.mapThings()
  const gridSubs = useMemo<SubstationDraw[]>(() => {
    if (!game || !mapData) return []
    const mine = new Set((game.equipment ?? []).map((e) => e.siteId))
    const picked = g.selection?.kind === 'gsub' ? g.selection.id : ''
    return things.substations.filter((s) => !isMain(game, mapData.grid, s)).map((s) => ({
      x: s.x, y: s.y, kv: s.kv, label: s.name, from: subFrom(s.kv), mine: mine.has(s.id), selected: s.id === picked,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [things, game?.equipment, mapData, g.selection])
  const pickedLine = g.selection?.kind === 'xline' ? things.lines[g.selection.index]?.points ?? null : null

  const activeCorridor = game?.corridors.find((c) => c.id === selectedCorridor) ?? null

  const parcelTints = useMemo<Record<string, ParcelTint>>(() => {
    const tints: Record<string, ParcelTint> = {}
    if (plan) {
      for (const t of plan.takings.takings) tints[t.parcelId] = t.severed ? 'severed' : 'taken'
      return tints
    }
    if (activeCorridor && activeCorridor.status === 'acquiring') {
      for (const [id, d] of Object.entries(activeCorridor.deals)) {
        tints[id] = d.status === 'accepted' ? 'accepted'
          : d.status === 'condemned' || d.status === 'condemning' ? 'condemned'
          : d.status === 'blocked' ? 'blocked'
          : d.status === 'holdout' ? 'holdout'
          : d.status === 'offered' ? 'offered'
          : activeCorridor.takings[id]?.severed ? 'severed' : 'taken'
      }
    }
    return tints
  }, [plan, activeCorridor])

  const roads = useMemo(
    () => [...(g.stateRoads?.roads ?? []), ...(g.roads?.roads ?? [])], [g.stateRoads, g.roads])
  const waterways = useMemo(
    () => [...(g.stateWater?.waterways ?? []), ...(g.water?.waterways ?? [])], [g.stateWater, g.water])
  const waterBodies = useMemo(
    () => [...(g.stateWater?.bodies ?? []), ...(g.water?.bodies ?? [])], [g.stateWater, g.water])
  const imagery = useMemo(
    () => (g.imagery ? { images: g.imagery.images, tiles: g.imagery.manifest.tiles } : null), [g.imagery])

  const assessment = g.currentAssessment()
  const siting = useMemo<SitingPreview | null>(() => {
    if (tool.kind !== 'site' || !assessment || !mapData || !game) return null
    const near = assessment.ok && tool.typeId !== 'nuclear-uprate'
    return {
      ok: assessment.ok,
      cells: assessment.cells.length > 0 ? assessment.cells : [g.hoverCell],
      toward: near ? cellPoint(mapData.grid, game.contract.siteCell) : null,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, g.hoverCell, mapData, game?.plants])

  const footprints = useMemo<FootprintDraw[]>(() => {
    if (!mapData || !plants) return []
    const picked = g.selection?.kind === 'site' ? g.selection.cell : -1
    return plants
      .filter((p) => p.typeId !== 'nuclear-uprate' && (plantType(p.typeId).acres > 300 || p.cell === picked))
      .map((p) => ({
        cells: footprintCells(mapData.grid, p.cell, plantType(p.typeId).acres),
        selected: p.cell === picked,
        solar: p.typeId === 'solar',
        stage: p.status === 'outage' ? 'online' as const : p.status,
      }))
  }, [plants, mapData, g.selection])

  const routing = tool.kind === 'route'
  const tappable = useMemo(
    () => (routing ? useGame.getState().tappable() : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routing, g.gis, game?.system.substationCell],
  )

  const lineFrom = tool.kind === 'route' ? plan?.from ?? tool.from : null
  const lineClassId = tool.kind === 'route' ? tool.classId : null
  const sorted = useMemo(() => {
    if (!tappable || !game || !mapData) return undefined
    return lineFrom && lineClassId ? sortLines(game, mapData.grid, lineFrom, lineClassId, tappable) : { enough: tappable, short: [] }
  }, [tappable, game, mapData, lineFrom, lineClassId])

  const probe = useCallback(
    (x: number, y: number, k: number) => useGame.getState().probeRoute(x, y, k), [])
  const drawStart = useCallback(
    (x: number, y: number, k: number) => useGame.getState().beginLine(x, y, k), [])

  const counties = game?.counties
  const env = g.env
  const countyFill = useMemo<Record<string, string> | undefined>(() => {
    if (!game || (overlay !== 'approval' && overlay !== 'air' && overlay !== 'water')) return undefined
    const out: Record<string, string> = {}
    for (const f of Object.keys(counties ?? {})) {
      const r = ratingOf(game, f)
      const fill = overlay === 'approval' ? (r === null ? undefined : approvalFill(r))
        : overlay === 'air' ? airFill(env?.counties[f]) : waterFill(env?.counties[f])
      if (fill) out[f] = fill
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counties, overlay, game?.quarter, game?.contract.approval, env])

  const hitAt = useCallback((x: number, y: number, cell: number, pxPerKm: number) => {
    const s = useGame.getState()
    return s.tool.kind === 'none' && s.game !== null && s.mapData !== null
      && mapHit(s.game, s.mapData.grid, x, y, cell, pxPerKm, s.shownCenters(), s.mapThings()) !== null
  }, [])

  const nodes = useMemo<NodeDraw[]>(() => {
    if (!game || !mapData) return []
    if (tool.kind !== 'route') {
      const at = g.selection && selectionPoint(game, mapData.grid, g.selection)
      return at ? [{ x: at[0], y: at[1], selected: true }] : []
    }
    const picked = new Set([tool.from?.id, plan?.from.id, plan?.to.id])
    const ends = [tool.from, plan?.from, plan?.to]
      .filter((n): n is NetNode => Boolean(n) && /^(tap|grid):/.test(n!.id))
    const flow = lineFrom ? plannedFlow(game) : undefined
    const next = lineFrom ? needAt(game, lineFrom.id, flow)?.nextMw ?? 0 : 0
    // Substations without room for the next phase get no ring.
    const fits = (n: NetNode): boolean => {
      const room = next > 0 && lineClassId && !picked.has(n.id) ? roomAt(game, n, lineClassId, flow) : null
      return room === null || room + 1e-6 >= next
    }
    return [
      ...networkNodes(game, mapData.grid).filter(fits).map((n) => ({ x: n.x, y: n.y, selected: picked.has(n.id) })),
      ...ends.map((n) => ({ x: n.x, y: n.y, selected: true })),
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, plan, game?.plants, mapData, g.selection])

  if (g.loadError) {
    return (
      <div className="splash" role="alert">
        <h1>The map did not load</h1>
        <p>Check your connection and try again. ({g.loadError})</p>
        <button className="btn primary" onClick={() => void load()}>Try again</button>
      </div>
    )
  }
  if (!mapData || !game || !scenario) {
    return <div className="splash"><p>Loading the map of Georgia</p></div>
  }

  const blocked = g.showBriefing ? 'Start first.'
    : game.hearing === 'called' ? 'Answer the commission first.'
    : game.pendingEvent ? 'Answer the pending decision first.' : null

  const unsettled = game.corridors.filter((c) => c.status === 'acquiring')
    .reduce((n, c) => n + Object.values(c.deals).filter((d) => d.status === 'holdout' || d.status === 'pending').length, 0)
  const faults = game.realtime?.outages.length ?? 0
  const tabs: Array<{ id: Tab; label: string; badge?: number }> = [
    { id: 'build', label: 'Build' },
    { id: 'grid', label: 'Grid', badge: unsettled || undefined },
    ...(game.realtime ? [{ id: 'ops' as const, label: 'Operate', badge: faults || undefined }] : []),
    { id: 'customers', label: 'Customers' },
    { id: 'log', label: 'Log' },
  ]
  const current: Tab = tabs.some((t) => t.id === tab) ? tab : 'grid'

  const center = focusOf(game, g.focus, g.dataCenters)
  /** Look at a data center: the header, the panels and the map all turn to it. */
  const showCenter = (id: string): void => {
    g.setTool({ kind: 'none' })
    if (id === 'main') {
      const [x, y] = cellPoint(mapData.grid, game.contract.siteCell)
      g.select({ kind: 'campus' })
      setFocus({ x, y, scale: Math.max(scale, 14) })
      return
    }
    const d = g.dataCenters.find((k) => k.id === id)
    if (!d) return
    g.setShowCenters(true)
    g.select({ kind: 'dc', id }, [d.x, d.y])
    setFocus({ x: d.x, y: d.y, scale: Math.max(scale, 8) })
  }

  /** Open a line's card on the map. Its land offers are there while land is being bought. */
  const openLine = (id: string): void => {
    const c = game.corridors.find((k) => k.id === id)
    if (!c) return
    const [x, y] = c.centerline[c.centerline.length >> 1]
    g.setTool({ kind: 'none' })
    g.select({ kind: 'line', id }, [x, y])
    setFocus({ x, y, scale: Math.max(scale, 14) })
  }

  const planner = tool.kind === 'route' ? (
    <LinePlanner game={game} tool={tool} plan={plan} planNote={g.planNote} parcelsLoading={g.parcelsLoading}
      onSetClass={g.setLineClass} onSetStyle={g.setRouteStyle} onUndoWaypoint={g.undoWaypoint}
      onStartOver={g.stepBack} onCommit={g.commitPlan} onCancel={g.clearPlan} onOrder={g.orderGear} onCancelOrder={g.cancelGear} planSpare={g.planSpare} onSetSpare={g.setPlanSpare} />
  ) : null
  const planAt = plan ? g.planAt ?? ([plan.to.x, plan.to.y] as const) : tool.kind === 'route' && tool.from ? ([tool.from.x, tool.from.y] as const) : null
  const pickedLineId = g.selection?.kind === 'line' ? g.selection.id : null
  const landLine = game.corridors.find((c) => c.id === pickedLineId && c.status === 'acquiring')
  const panels: Record<Tab, () => ReactNode> = {
    build: () => (
      <BuildPanel game={game} focus={center} tool={tool} onSelect={g.setTool} onWithdraw={g.cancelPlant} onExpedite={g.expedite}
        onShow={(cell) => {
          g.setTool({ kind: 'none' })
          g.select({ kind: 'site', cell })
          const [x, y] = cellPoint(mapData.grid, cell)
          setFocus({ x, y, scale: Math.max(scale, 14) })
        }}
        onShowSub={(id) => {
          const b = game.builtSubs?.find((k) => k.id === id)
          if (!b) return
          g.setTool({ kind: 'none' })
          g.select({ kind: 'nsub', id })
          setFocus({ x: b.x, y: b.y, scale: Math.max(scale, 14) })
        }} />
    ),
    grid: () => (
      <GridPanel game={game} focus={center} tool={tool} plan={plan} planner={isMobile ? planner : null}
        selectedCorridor={selectedCorridor}
        onStartRoute={() => g.setTool({ kind: 'route', from: null, classId: '230', style: 'balanced' })}
        onSelectCorridor={openLine} onAbandon={g.abandon} />
    ),
    ops: () => game.realtime && (
      <OpsPanel game={game} rt={game.realtime} onPolicy={g.setPolicy} onVegetation={g.setVegetationSpend}
        onMaintenance={g.setMaintenanceDeferred} onCrews={g.setCrews} onPrioritize={g.prioritize} />
    ),
    customers: () => <CustomersPanel game={game} focusId={g.focus} list={g.dataCenters} onShow={showCenter} />,
    log: () => <LogPanel log={game.log} />,
  }

  const inspecting = g.selection !== null && tool.kind === 'none'
  const details = inspecting ? (
    <Inspector
      game={game} grid={mapData.grid} selection={g.selection!} centers={g.dataCenters} env={g.env} things={things}
      onTapLine={(index) => {
        const at = g.selectionAt
        if (at) g.planFromLine(index, at as [number, number])
        setTab('grid')
        if (isMobile) setSheetOpen(false)
      }}
      land={(c) => (
        <LandPanel key={c.id} game={game} corridor={c} onOfferAll={g.offerAll}
          onSetOffer={g.setOffer} onCondemn={g.condemnParcel} onAbandon={g.abandon} onHoverParcel={g.setHoverParcel} />
      )}
      onClose={() => g.select(null)} onWithdraw={g.cancelPlant} onExpedite={g.expedite}
      onRunProgramme={g.runProgramme} onOrder={g.orderGear} onCancelOrder={g.cancelGear} onSign={g.sign} onSignMain={g.accept} onSetSpare={g.setSpare}
      onPlanLine={(from) => {
        g.planLineFrom(from)
        setTab('grid')
        if (isMobile) setSheetOpen(false)
      }}
      onOpenLine={(id) => {
        g.selectCorridor(id)
        g.select(null)
        setTab('grid')
      }}
    />
  ) : null
  const popover = isMobile ? null
    : planner && g.planGear ? {
        at: g.planGear.at as [number, number], avoid: plan?.centerline,
        content: <GearCard game={game} id={g.planGear.id} kv={g.planGear.kv} onOrder={g.orderGear} onCancelOrder={g.cancelGear} onClose={g.closePlanGear} />,
      }
    : planner && planAt ? {
        at: [planAt[0], planAt[1]] as [number, number], content: planner,
        // Plants and data centers matter more than substations, so they count several times.
        avoid: [
          ...networkNodes(game, mapData.grid).flatMap((n) => Array<readonly [number, number]>(/^(site:|dc:|campus)/.test(n.id) ? 8 : 1).fill([n.x, n.y])),
          ...(plan?.centerline ?? []),
        ],
      }
    : details && g.selectionAt ? { at: g.selectionAt as [number, number], content: details, avoid: landLine?.centerline }
    : null

  // Phones have no room beside a tap, so details go in the sheet.
  const inSheet = isMobile && details !== null
  const content = inSheet ? details : panels[current]()

  const choose = (t: Tab): void => {
    if (inSheet) {
      g.select(null)
      setTab(t)
      setSheetOpen(true)
      return
    }
    if (isMobile && t === current) setSheetOpen((v) => !v)
    else { setTab(t); setSheetOpen(true) }
  }
  const tabBar = (
    <div className="tabs" role="tablist" aria-label="Panels">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={current === t.id && !inSheet}
          className={current === t.id && !inSheet ? 'tab on' : 'tab'} onClick={() => choose(t.id)}>
          {t.label}{t.badge !== undefined && <span className="badge">{t.badge}</span>}
        </button>
      ))}
    </div>
  )
  const coach = !g.showBriefing && game.tutorial && !game.ending && (
    game.tutorial.dismissed
      ? <button className="btn small coach-restore" onClick={() => g.setTutorialHidden(false)}>Show the guide</button>
      : <TutorialCoach key={isMobile ? 'm' : 'd'} game={game} activeTab={landLine ? 'land' : inSheet ? '' : current} startOpen={!isMobile}
          onGo={(t) => {
            const c = game.corridors.find((k) => k.status === 'acquiring')
            if (t === 'land') { if (c) openLine(c.id); else setTab('grid') }
            else { g.select(null); setTab(t) }
            setSheetOpen(true)
          }} onHide={() => g.setTutorialHidden(true)} />
  )

  const credit = [...new Set([
    layers.imagery && g.imagery ? g.imagery.manifest.attribution : null,
    (layers.roads && roads.length > 0) || (layers.water && waterways.length > 0) || (g.showGrid && g.stateGis)
      ? '© OpenStreetMap contributors' : null,
  ].filter(Boolean))].join(' · ')

  const layerBox = (key: keyof typeof layers, label: string): ReactNode => (
    <label className="check">
      <input type="checkbox" checked={layers[key]}
        onChange={(e) => setLayers({ ...layers, [key]: e.target.checked })} />
      {label}
    </label>
  )

  return (
    <div className={`app${isMobile ? ' mobile' : ''}${isMobile && sheetOpen ? ' sheet-open' : ''}`}>
      <HUD game={opened ?? game} onEndQuarter={g.endQuarter} onSpeed={g.setSpeed}
        onMenu={() => g.setShowMenu(true)} onRunProgramme={g.runProgramme} centers={g.dataCenters} focusId={g.showBriefing && opened ? firstDue(opened)?.id ?? g.focus : g.focus} onFocus={showCenter} blocked={blocked} compact={isMobile} embedded={embedded} />

      <div className="body">
        <main className="stage">
          <MapView
            data={mapData} overlay={overlay} showHexes={layers.hexes} markers={markers} dataCenters={centers} substations={gridSubs} pickedLine={pickedLine} siting={siting}
            placing={tool.kind !== 'none'} parcels={parcels?.parcels} parcelTints={parcelTints}
            extraParcels={plan?.parcels} corridors={corridors} hoverParcel={g.hoverParcel}
            storms={game.realtime?.storms} imagery={imagery} roads={roads} waterways={waterways}
            waterBodies={waterBodies} showWater={layers.water} showImagery={layers.imagery}
            showRoads={layers.roads} showGrid={g.showGrid} stateGis={g.stateGis} gis={g.gis}
            selectedCounty={g.selection?.kind === 'county' ? g.selection.fips : null}
            countyFill={countyFill} streams={env?.streams}
            footprints={footprints} hitAt={hitAt} tappable={sorted?.enough} tappableShort={sorted?.short}
            probe={routing ? probe : undefined} onDrawStart={routing ? drawStart : undefined}
            probeKey={plan ?? tool}
            nodes={nodes} waypoints={plan?.waypoints} focus={focus}
            popover={popover}
            tipAt={tipAt} onHoverCell={setHoverCell} onClickMap={g.clickMap} onScaleChange={setScale}
          />

          <div className="map-controls">
            <button className="btn small layers-toggle" aria-expanded={layersOpen}
              onClick={() => setLayersOpen((v) => !v)}>
              <Icon name="layers" /> Layers
            </button>
            {layersOpen && (
              <div className="layers">
                <div className="segmented three" role="group" aria-label="Map colouring">
                  {OVERLAYS.map((o) => (
                    <button key={o.id} className={overlay === o.id ? 'on' : ''}
                      onClick={() => setOverlay(o.id)} aria-pressed={overlay === o.id}>{o.label}</button>
                  ))}
                </div>
                <p className="note">{OVERLAYS.find((o) => o.id === overlay)?.help}</p>
                {(overlay === 'population' || overlay === 'landValue') && (
                  <p className="ramp"><span>Low</span><i className={`ramp-${overlay}`} /><span>High</span></p>
                )}
                <div className="checks">
                  {roads.length > 0 && layerBox('roads', 'Roads and rail')}
                  {waterways.length > 0 && layerBox('water', 'Rivers and lakes')}
                  {g.stateGis && (
                    <label className="check">
                      <input type="checkbox" checked={g.showGrid} onChange={(e) => g.setShowGrid(e.target.checked)} />
                      Existing lines and substations
                    </label>
                  )}
                  {imagery && layerBox('imagery', 'Aerial photo')}
                  {g.dataCenters.length > 0 && (
                    <label className="check">
                      <input type="checkbox" checked={g.showCenters} onChange={(e) => g.setShowCenters(e.target.checked)} />
                      Data centers
                    </label>
                  )}
                  {layerBox('hexes', 'Grid cells')}
                  <p className="fine">Filled data center icon: you have a contract. Outlined icon: a contract you can sign. Dot: no contract.</p>
                </div>
              </div>
            )}
          </div>

          {g.headlines.length > 0 && (
            <div className="toast" role="status">
              <ul>{g.headlines.map((h) => <li key={h}>{h}</li>)}</ul>
              <button className="btn ghost icon-only" onClick={g.dismissHeadlines} aria-label="Dismiss"><Icon name="close" /></button>
            </div>
          )}
          {g.alerts.length > 0 && game.realtime && !game.outcome && (
            <div className={game.realtime.inShortfall ? 'toast alerts' : 'toast'} role="status" aria-live="polite">
              <ul>{g.alerts.slice(0, 4).map((a, i) => <li key={`${i}${a}`}>{a}</li>)}</ul>
              <button className="btn ghost icon-only" onClick={g.dismissAlerts} aria-label="Dismiss alerts"><Icon name="close" /></button>
            </div>
          )}

          {tool.kind !== 'none' && !(popover && planner) && (
            <div className="map-banner" role="status">
              <span>
                {tool.kind === 'substation' ? `Click where the ${tool.kv} kV substation goes.`
                  : tool.kind === 'site' ? `Click where the ${plantType(tool.typeId).name.toLowerCase()} goes.`
                  : g.parcelsLoading ? 'Loading parcels.'
                  : plan ? `${plan.from.label} to ${plan.to.label}, ${plan.lengthKm.toFixed(1)} km. Click the map to bend it.`
                  : tool.from ? `From ${tool.from.label}. Click or drag to where it connects.`
                  : 'Click either end of the line, or drag from one to the other.'}
                {g.planNote && !plan && <em>{g.planNote}</em>}
              </span>
              {plan && <button className="btn small primary" onClick={g.commitPlan}>File</button>}
              {tool.kind === 'route' && (plan || tool.from) && (
                <button className="btn small" onClick={g.stepBack}>Start over</button>
              )}
              <button className="btn small" onClick={() => g.setTool({ kind: 'none' })}>Cancel</button>
            </div>
          )}

          <div className="map-foot">
            {credit && <span className="map-attribution">{credit}</span>}
            <ScaleBar pxPerKm={scale} />
          </div>

          {isMobile && (
            <>
              {coach && <div className="coach-dock">{coach}</div>}
              <div className="sheet">
                {tabBar}
                <div className="sheet-body" role="tabpanel" hidden={!sheetOpen}>{content}</div>
              </div>
            </>
          )}
        </main>

        {!isMobile && (
          <aside className="sidebar">
            {coach}
            {tabBar}
            <div className="sidebar-body" role="tabpanel">{content}</div>
          </aside>
        )}
      </div>

      {g.showMenu ? (
        <MenuDialog game={game} onStart={() => g.startScenario('americus-400')} onClose={() => g.setShowMenu(false)} />
      ) : g.showBriefing ? (
        <BriefingDialog game={game} existing={g.dataCenters.filter(isExisting)} onStart={() => void g.begin()} />
      ) : game.outcome && !g.debriefClosed ? (
        <ScoreDialog game={game} outcome={game.outcome} closing={scenario.closing} onContinue={g.finishDebrief} onCarryOn={g.carryOn} />
      ) : game.hearing === 'called' ? (
        <HearingDialog game={game} onChoose={g.chooseHearing} />
      ) : game.pendingEvent ? (
        <EventDialog game={game} onChoose={g.chooseEvent} />
      ) : null}
    </div>
  )
}

function ratingText(game: GameState, fips: string): string {
  const r = ratingOf(game, fips)
  if (r === null) return 'No rating: not next to a data center you supply'
  const home = fips === game.contract.countyFips
  return `${home ? 'Data center approval' : 'Approval'} ${Math.round(r)}, ${approvalBand(r).label.toLowerCase()}`
}

function substationTip(game: GameState, a: SubstationSite, kv: 115 | 230 | 500): MapTip {
  if (!a.ok) return { title: 'Cannot build here', lines: [a.blocker ?? ''], tone: 'bad' }
  const t = substationType(kv)
  return {
    title: `${a.countyName} County`,
    lines: [
      a.looped ? `On an existing ${kv} kV line, so it joins that line` : `Not on a ${kv} kV line, so it needs lines drawn to it`,
      `In service ${formatQuarter(game.quarter + t.quarters - 1)}`,
      `Land ${money(a.landCost)}, ${acres(t.acres)}`,
      a.approvalCost > 0.5 ? `Approval -${Math.round(a.approvalCost)}` : 'No effect on approval',
    ],
  }
}

function siteTip(
  game: GameState, a: SiteAssessment, typeId: PlantKind, env: EnvData | null, x: number, y: number,
): MapTip {
  if (!a.ok) return { title: 'Cannot build here', lines: [a.blocker ?? ''], tone: 'bad' }
  const t = plantType(typeId)
  return {
    title: `${a.countyName} County`,
    lines: [
      `${mw(t.nameplateMw * t.firmCapacityFraction)} firm, finished ${formatQuarter(game.quarter + t.permitQuarters + t.buildQuarters - 1)}`,
      `Land ${money(a.landCost)}, ${acres(plantType(typeId).acres)}`,
      a.approvalCost > 0 ? `${a.countyFips === game.contract.countyFips ? 'Data center approval' : `${a.countyName} County approval`} -${Math.round(a.approvalCost)}` : 'No effect on approval',
      ...projectionLines(game, env, typeId, a.countyFips, x, y),
      ...a.notes,
    ],
  }
}

function arriving(game: GameState, units: GameState['plants']): number {
  const flow = firmFlow(game)
  return units.reduce((n, p) => n + (flow.plants.get(p.id)?.arrivingMw ?? 0), 0)
}

function hitTip(game: GameState, s: Selection, centers: readonly DataCenter[], things: MapThings): MapTip | null {
  switch (s.kind) {
    case 'nsub': {
      const b = game.builtSubs?.find((k) => k.id === s.id)
      return b ? { title: b.name, lines: [b.status === 'in-service' ? 'In service' : 'Being built'] } : null
    }
    case 'gsub': {
      const x = things.substations.find((k) => k.id === s.id)
      const n = x?.transformers.reduce((t, k) => t + k.count, 0) ?? 0
      return x ? { title: x.name, lines: [`${x.voltages.join(', ')} kV`, n > 0 ? `${n} mapped ${n === 1 ? 'transformer' : 'transformers'}` : 'No transformer mapped'] } : null
    }
    case 'xline': {
      const l = things.lines[s.index]
      return l ? { title: `Existing ${l.kv} kV line`, lines: [] } : null
    }
    case 'dc': {
      const d = centers.find((x) => x.id === s.id)
      const c = activeCustomers(game).find((x) => x.id === s.id)
      const o = openOffers(game).find((x) => x.id === s.id)
      const note = c ? [`Contract, ${c.phasesOn} of ${c.phaseCount} phases on`] : o ? [`Contract open until ${formatQuarter(o.closes)}`] : []
      return d ? { title: d.name, lines: [d.mw === null ? 'MW not published' : mw(d.mw), STATUS_TEXT[d.status] ?? d.status, ...note] } : null
    }
    case 'gear': {
      const t = game.corridors.flatMap((c) => (lineClass(c.classId).kv === s.kv ? lineGear(game, c) : [])).find((x) => x.id === s.id)
      return { title: `${s.kv} kV transformer`, lines: [t?.state === 'missing' ? 'Not built. Click to build it.' : t?.state === 'ordered' ? 'Being built' : 'In service'] }
    }
    case 'campus': return { title: game.contract.name, lines: [`${game.contract.contractedMw} MW ${game.contract.status === 'offered' ? 'contract you can sign' : 'contracted'}`, ratingText(game, game.contract.countyFips)] }
    case 'substation': return { title: game.system.substationName, lines: ['Homes and imports connect here'] }
    case 'line': {
      const c = game.corridors.find((x) => x.id === s.id)
      return c ? { title: c.name, lines: [LINE_STATUS[c.status]] } : null
    }
    case 'site': {
      const units = game.plants.filter((p) => p.cell === s.cell)
      return units.length > 0
        ? { title: units.length === 1 ? units[0].name : `${units.length} units`,
            lines: [...new Set(units.map((p) => PLANT_STATUS[p.status])), `${mw(arriving(game, units))} reaching the campus`] }
        : null
    }
    case 'county': return null
  }
}

function ScaleBar({ pxPerKm }: { pxPerKm: number }) {
  const raw = 110 / Math.max(pxPerKm, 1e-6)
  const pow = 10 ** Math.floor(Math.log10(raw))
  const nice = [1, 2, 5, 10].map((m) => m * pow).find((v) => v >= raw) ?? 10 * pow
  return (
    <div className="scalebar" style={{ width: `${nice * pxPerKm}px` }}>
      <span>{nice >= 1 ? `${nice} km` : `${Math.round(nice * 1000)} m`}</span>
    </div>
  )
}
