import { create } from 'zustand'
import type { MapData } from '../engine/geo/mapTypes.ts'
import { centerlineLength, type Point } from '../engine/geo/polygon.ts'
import { routeLeg, type RouteStyle, type RouteSurface } from '../engine/geo/fineRoute.ts'
import type { Gis } from '../engine/geo/basemapTypes.ts'
import type { GameState } from '../engine/types.ts'
import type { PlantKind } from '../data/plants.ts'
import type { ParcelArchetype, Parcel } from '../engine/parcels/types.ts'
import { inServiceArea, loadDataCenters, type DataCenter } from '../data/dataCenters.ts'
import { loadEnv, type EnvData } from '../data/loadEnv.ts'
import { loadSubstations, type Substation } from '../data/substations.ts'
import { loadMapData } from '../data/loadMapData.ts'
import { createGame } from '../engine/state.ts'
import { endQuarter as resolveQuarter, acceptContract, resolveHearing } from '../engine/turn/resolve.ts'
import type { HearingOption } from '../engine/turn/hearing.ts'
import { migrateApproval } from '../engine/approval.ts'
import { advanceTutorial } from '../engine/tutorial.ts'
import {
  sitePlant, assessSite, cancelPlant, expeditePlant, type SiteAssessment,
} from '../engine/turn/siting.ts'
import { scenario, type Scenario, type ScenarioSite } from '../data/scenarios.ts'
import { project } from '../engine/geo/projection.ts'
import { pointToCell } from '../engine/geo/hex.ts'
import type { LineClassId } from '../data/transmission.ts'
import {
  loadImagery, loadStateRoads, loadCountyRoads, loadStateHydrology, loadCountyHydrology, loadGis,
  type Imagery, type CountyRoads, type Hydrology,
} from '../data/loadBasemap.ts'
import { loadCountyParcels, clearParcelCache, type CountyParcels } from '../data/loadParcels.ts'
import {
  planCorridor, repricePlan, commitCorridor, offerAll as engineOfferAll,
  setOffer as engineSetOffer, condemn as engineCondemn, abandonCorridor as engineAbandon,
  areaSubstations, networkNodes, nodeNear, tapNear, tappableLines, type ExistingLine, type CorridorPlan, type NetNode,
} from '../engine/turn/corridor.ts'
import { stepRealtime, setCrews as engineSetCrews, togglePriority } from '../engine/realtime/operate.ts'
import type { Speed, SheddingPolicy } from '../engine/realtime/types.ts'
import { canJoin, sitesTouch } from '../engine/realtime/network.ts'
import { linePower, roomAt, suggestSpare } from '../engine/turn/reach.ts'
import { runProgramme as engineRunProgramme } from '../engine/turn/community.ts'
import { dropOwnedDeals, ownedCells, refreshSiteLinks } from '../engine/turn/ownedLand.ts'
import { assignSpare, beginCompany, firstDue, signCustomer } from '../engine/customers.ts'
import { continueGame } from '../engine/ending.ts'
import { assessSubstation, buildSubstation } from '../engine/turn/substations.ts'
import { cancelEquipment, orderEquipment } from '../engine/turn/equipment.ts'
import type { EquipmentId } from '../data/equipment.ts'
import { resolveEvent } from '../engine/events/events.ts'
import { countyAt, mapHit, planGearAt, selectionPoint, withBox, type MapThings, type Selection } from '../ui/mapHit.ts'
import { writeSave, readSave, clearSave } from './save.ts'

export type Tool =
  | { kind: 'none' }
  | { kind: 'site'; typeId: PlantKind }
  | { kind: 'substation'; kv: 115 | 230 | 500 }
  | { kind: 'route'; from: NetNode | null; classId: LineClassId; style: RouteStyle }

/** How close a click has to be to count. */
const NODE_REACH_PX = 24
const LINE_REACH_PX = 16

/** What the map shows under the pointer while a line is being drawn. */
export interface RouteDraft {
  from: Point | null
  at: Point
  /** Route to a place that can be connected. */
  line: readonly Point[] | null
  state: 'free' | 'valid' | 'invalid'
  label: string
}

interface Store {
  mapData: MapData | null
  dataCenters: DataCenter[]
  env: EnvData | null
  substations: Substation[]
  loadError: string | null
  game: GameState | null
  scenario: Scenario | null

  tool: Tool
  hoverCell: number
  hoverParcel: string | null
  headlines: string[]
  showBriefing: boolean
  showMenu: boolean
  debriefClosed: boolean

  parcels: CountyParcels | null
  parcelsLoading: boolean
  /** County FIPS whose parcel file is missing, so it is not asked for again. */
  parcelsMissing: string | null
  basemapFor: string | null
  imagery: Imagery | null
  stateRoads: CountyRoads | null
  roads: CountyRoads | null
  stateWater: Hydrology | null
  water: Hydrology | null
  stateGis: Gis | null
  gis: Gis | null

  plan: CorridorPlan | null
  planNote: string | null
  selectedCorridor: string | null
  /** What the map card is showing. */
  selection: Selection | null
  /** Data center the header and panels are about. 'main' is the first. */
  focus: string
  setFocus: (id: string) => void
  showGrid: boolean
  setShowGrid: (show: boolean) => void
  showCenters: boolean
  setShowCenters: (show: boolean) => void
  /** Where on the map it was opened, projected km. */
  selectionAt: Point | null
  alerts: string[]

  load: () => Promise<void>
  startScenario: (id: string, seed?: number) => void
  setShowMenu: (show: boolean) => void
  /** Close the opening and start as Georgia Power. */
  begin: () => Promise<void>
  accept: () => void
  setTool: (tool: Tool) => void
  setHoverCell: (cell: number) => void
  setHoverParcel: (id: string | null) => void
  clickMap: (x: number, y: number, cell: number, pxPerKm: number) => void
  endQuarter: () => void
  dismissHeadlines: () => void

  ensureParcels: () => Promise<void>
  ensureBasemap: () => Promise<void>
  setLineClass: (classId: LineClassId) => void
  setRouteStyle: (style: RouteStyle) => void
  undoWaypoint: () => void
  /** Where the plan was last clicked, projected km. */
  planAt: Point | null
  /** Spare power chosen for the line being planned. Null until it is changed. */
  planSpare: number | null
  /** The transformer opened on the line being planned. */
  planGear: { id: string; kv: number; at: Point } | null
  closePlanGear: () => void
  setPlanSpare: (mw: number) => void
  clearPlan: () => void
  commitPlan: () => void
  selectCorridor: (id: string | null) => void
  select: (selection: Selection | null, at?: Point) => void
  sign: (dcId: string) => void
  setSpare: (id: string, mw: number) => void
  carryOn: () => void
  orderGear: (id: string, rush: boolean, siteId?: string) => void
  cancelGear: (id: string) => void
  runProgramme: (fips: string, id: string) => void
  planLineFrom: (from: string | NetNode) => void
  planFromLine: (index: number, at: Point) => void
  offerAll: (multiple: number, archetype?: ParcelArchetype) => void
  setOffer: (parcelId: string, multiple: number) => void
  condemnParcel: (parcelId: string) => void
  abandon: (corridorId: string) => void
  cancelPlant: (plantId: string) => void
  expedite: (plantId: string) => void

  chooseHearing: (option: HearingOption) => void
  chooseEvent: (index: number) => void
  setTutorialHidden: (hidden: boolean) => void
  finishDebrief: () => void
  setSpeed: (speed: Speed) => void
  setPolicy: (policy: SheddingPolicy) => void
  setVegetationSpend: (value: number) => void
  setMaintenanceDeferred: (value: boolean) => void
  setCrews: (n: number) => void
  prioritize: (assetId: string) => void
  dismissAlerts: () => void

  /** Existing substations and lines a click can open. */
  mapThings: () => MapThings
  /** Data centers drawn on the map. */
  shownCenters: () => DataCenter[]
  currentAssessment: () => SiteAssessment | null
  /** Begin a line at a point. True if there was something there to begin from. */
  beginLine: (x: number, y: number, pxPerKm: number) => boolean
  probeRoute: (x: number, y: number, pxPerKm: number) => RouteDraft | null
  /** Undo the last step of drawing a line. */
  stepBack: () => void
  surface: () => RouteSurface | null
  /** Existing lines that can be tapped from here. */
  tappable: () => ExistingLine[]
  /** Every existing line of 115 kV or more. */
  gridLines: () => ExistingLine[]
}

let tickTimer: ReturnType<typeof setInterval> | null = null
const BEAT_MS = 250
/** Autosave at most this often while the clock runs. */
const SAVE_EVERY_MS = 4000
let lastSave = 0

function stopClock(): void {
  if (tickTimer !== null) clearInterval(tickTimer)
  tickTimer = null
}

function cellOf(site: ScenarioSite, map: MapData): number {
  const [x, y] = project(site.lon, site.lat)
  const [col, row] = pointToCell(map.grid.spec, x, y)
  return row * map.grid.spec.cols + col
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff)
}

/** Fixed by ?seed= in the URL, so a run can be shared or replayed. */
function seedFromUrl(): number | null {
  const v = new URLSearchParams(window.location.search).get('seed')
  const n = v === null ? NaN : Number(v)
  return Number.isFinite(n) ? Math.floor(n) : null
}

const CLEAN = {
  focus: 'main',
  headlines: [] as string[], tool: { kind: 'none' } as Tool, plan: null, planNote: null,
  selectedCorridor: null, selection: null, selectionAt: null, alerts: [] as string[], hoverParcel: null, showMenu: false, debriefClosed: false,
}

export const useGame = create<Store>((set, get) => {
  /** Put a new state in place and save it. */
  const commit = (game: GameState, extra: Partial<Store> = {}): void => {
    set({ game, ...extra })
    writeSave(game)
  }

  const endAt = (x: number, y: number, pxPerKm: number): NetNode | null => {
    const { game, mapData } = get()
    if (!game || !mapData) return null
    return nodeNear(networkNodes(game, mapData.grid), x, y, NODE_REACH_PX / pxPerKm)
      ?? tapNear(game, mapData.grid, get().tappable(), x, y, LINE_REACH_PX / pxPerKm)
  }

  // Only places with a fixed position are worth routing to on every hover.
  const drafts = new Map<string, readonly Point[] | null>()
  const draftLine = (from: NetNode, to: NetNode, style: RouteStyle): readonly Point[] | null => {
    if (/^(tap|grid):/.test(to.id)) return null
    const surface = get().surface()
    if (!surface) return null
    const key = `${from.id}|${to.id}|${style}|${surface.parcels.length}|${surface.buildings?.length ?? 0}|${surface.owned?.size ?? 0}`
    let line = drafts.get(key)
    if (line === undefined) {
      line = routeLeg(surface, [from.x, from.y], [to.x, to.y], style)
      drafts.set(key, line)
    }
    return line
  }

  const replan = (from: NetNode, to: NetNode, waypoints: Point[], classId: LineClassId, style: RouteStyle): void => {
    const surface = get().surface()
    if (!surface) return
    const plan = planCorridor(surface, from, to, classId, style, waypoints)
    set(plan
      ? { plan, planNote: null }
      : { plan: null, planNote: 'No route exists between those points. Protected land may be in the way.' })
  }

  return {
    mapData: null,
    dataCenters: [],
    env: null,
    substations: [],
    loadError: null,
    game: null,
    scenario: null,
    hoverCell: -1,
    showBriefing: true,
    parcels: null,
    parcelsLoading: false,
    parcelsMissing: null,
    basemapFor: null,
    imagery: null,
    stateRoads: null,
    roads: null,
    stateWater: null,
    water: null,
    stateGis: null,
    gis: null,
    ...CLEAN,

    load: async () => {
      try {
        const mapData = await loadMapData()
        void loadDataCenters().then((dataCenters) => set({ dataCenters }))
        const saved = readSave()
        if (saved && (saved.started || saved.contract.status !== 'offered')) {
          if (saved.realtime) saved.realtime.speed = 0
          refreshSiteLinks(saved, mapData.grid)
          dropOwnedDeals(saved, mapData.grid)
          migrateApproval(saved, mapData.counties)
          set({
            mapData, loadError: null, game: saved, scenario: scenario(saved.scenarioId),
            showBriefing: false,
            focus: saved.contract.status === 'offered' ? firstDue(saved)?.id ?? 'main' : 'main',
            selectedCorridor: saved.corridors.find((c) => c.status === 'acquiring')?.id ?? null,
          })
        } else {
          set({ mapData, loadError: null })
          get().startScenario('americus-400', seedFromUrl() ?? undefined)
        }
      } catch (e) {
        set({ loadError: e instanceof Error ? e.message : String(e) })
      }
    },

    startScenario: (id, seed) => {
      const { mapData } = get()
      if (!mapData) return
      const sc = scenario(id)
      stopClock()
      clearSave()
      clearParcelCache()
      const game = createGame(
        sc, cellOf(sc.contract.site, mapData), mapData.counties,
        cellOf(sc.system.site, mapData), seed ?? randomSeed(),
      )
      set({
        ...CLEAN,
        game,
        scenario: sc, showBriefing: true, parcels: null, parcelsMissing: null,
        basemapFor: null, roads: null, water: null, gis: null,
      })
    },

    focus: 'main',
    setFocus: (focus) => set({ focus }),
    planAt: null,
    planSpare: null,
    planGear: null,
    closePlanGear: () => set({ planGear: null }),
    setPlanSpare: (planSpare) => set({ planSpare }),
    showGrid: true,
    setShowGrid: (showGrid) => set({ showGrid }),
    showCenters: true,
    setShowCenters: (showCenters) => set({ showCenters }),

    setShowMenu: (showMenu) => {
      if (showMenu && get().game?.realtime) get().setSpeed(0)
      set({ showMenu })
    },

    begin: async () => {
      const { game, mapData } = get()
      if (!game || !mapData) return
      const dataCenters = get().dataCenters.length > 0 ? get().dataCenters : await loadDataCenters()
      const now = get().game
      if (!now) return
      const next = beginCompany(now, dataCenters, mapData.counties, mapData.grid)
      const list = get().substations
      commit(list.length > 0 ? { ...next, substations: areaSubstations(next, mapData.grid, list) } : next, { showBriefing: false, dataCenters, focus: firstDue(next)?.id ?? 'main' })
    },

    accept: () => {
      const { game } = get()
      if (!game) return
      const next = acceptContract(game)
      set({ focus: 'main' })
      advanceTutorial(next)
      commit(next, { showBriefing: false })
    },

    setTool: (tool) => {
      set({ tool, plan: null, planNote: null, planGear: null, ...(tool.kind !== 'none' && { selection: null }) })
      if (tool.kind === 'route') void get().ensureParcels()
    },

    setHoverCell: (cell) => { if (get().hoverCell !== cell) set({ hoverCell: cell }) },
    setHoverParcel: (id) => { if (get().hoverParcel !== id) set({ hoverParcel: id }) },

    clickMap: (x, y, cell, pxPerKm) => {
      const { game, mapData, tool, plan } = get()
      if (!game || !mapData) return

      if (tool.kind === 'site') {
        const next = sitePlant(game, tool.typeId, cell, mapData.grid)
        if (next === game) {
          set({ planNote: assessSite(game, tool.typeId, cell, mapData.grid).blocker })
          return
        }
        advanceTutorial(next)
        commit(next, { tool: { kind: 'none' }, planNote: null })
        return
      }
      if (tool.kind === 'substation') {
        const lines = get().gridLines()
        const next = buildSubstation(game, tool.kv, cell, mapData.grid, lines)
        if (next === game) {
          set({ planNote: assessSubstation(game, tool.kv, cell, mapData.grid, lines).blocker })
          return
        }
        commit(next, { tool: { kind: 'none' }, planNote: null })
        return
      }
      if (tool.kind === 'none') {
        const fips = countyAt(mapData.grid, cell)
        const open = get().selection
        const again = open?.kind === 'county' && open.fips === fips
        const next = mapHit(game, mapData.grid, x, y, cell, pxPerKm, get().shownCenters(), get().mapThings())
          ?? (fips && !again ? { kind: 'county' as const, fips } : null)
        get().select(next, [x, y])
        return
      }
      if (get().parcelsLoading) return

      if (plan) {
        const gear = planGearAt(game, plan, x, y, pxPerKm)
        if (gear) {
          set({ planGear: gear })
          return
        }
        set({ planGear: null })
        const hit = nodeNear(networkNodes(game, mapData.grid), x, y, NODE_REACH_PX / pxPerKm)
        // With both ends set, a click bends the route through that point.
        if (hit && hit.id !== plan.from.id && hit.id !== plan.to.id) {
          set({ planAt: [hit.x, hit.y], planSpare: null })
          replan(plan.from, hit, plan.waypoints, tool.classId, tool.style)
          return
        }
        if (hit) return
        set({ planAt: [x, y] })
        replan(plan.from, plan.to, insertWaypoint(plan, [x, y]), tool.classId, tool.style)
        return
      }
      const hit = endAt(x, y, pxPerKm)
      if (!hit) {
        set({ planNote: 'Click a plant, the campus, the substation, or a line of 115 kV or more.' })
        return
      }
      if (!tool.from) {
        set({ tool: { ...tool, from: hit }, planNote: null })
        return
      }
      if (!canJoin(tool.from.id, hit.id) || sitesTouch(game, tool.from.id, hit.id)) {
        set({ planNote: 'Those two ends are already joined. Pick a different place.' })
        return
      }
      set({ planAt: [hit.x, hit.y], planSpare: null })
      replan(tool.from, hit, [], tool.classId, tool.style)
    },

    endQuarter: () => {
      const { game } = get()
      if (!game || game.phase !== 'build' || game.pendingEvent || game.hearing === 'called') return
      const { state, headlines } = resolveQuarter(game)
      commit(state, { headlines, tool: { kind: 'none' }, plan: null, planNote: null })
    },

    dismissHeadlines: () => set({ headlines: [] }),

    ensureBasemap: async () => {
      const { game, basemapFor } = get()
      if (!game) return
      const fips = game.contract.countyFips
      if (basemapFor === fips) return
      set({ basemapFor: fips })
      void loadEnv(fips).then((env) => { if (get().game?.contract.countyFips === fips) set({ env }) })
      const [imagery, stateRoads, roads, stateWater, water, stateGis, gis] = await Promise.all([
        loadImagery(), loadStateRoads(), loadCountyRoads(fips),
        loadStateHydrology(), loadCountyHydrology(fips), loadGis('state'), loadGis(fips),
      ])
      if (get().game?.contract.countyFips !== fips) return
      const substations = get().substations.length > 0 ? get().substations : await loadSubstations()
      set({ imagery, stateRoads, roads, stateWater, water, stateGis, gis, substations })
      const { game: now, mapData } = get()
      if (now?.equipment && !now.substations && gis && mapData) {
        const next = { ...now, substations: areaSubstations(now, mapData.grid, substations.length > 0 ? substations : gis.substations) }
        if (next.started || next.contract.status !== 'offered') commit(next)
        else set({ game: next })
      }
    },

    ensureParcels: async () => {
      const { parcels, parcelsLoading, parcelsMissing, game } = get()
      const fips = game?.contract.countyFips
      if (!fips || parcels || parcelsLoading || parcelsMissing === fips) return
      set({ parcelsLoading: true })
      try {
        const loaded = await loadCountyParcels(fips)
        set({ parcels: loaded, parcelsLoading: false })
      } catch {
        // Routing falls back to generated parcels.
        set({ parcelsLoading: false, parcelsMissing: fips })
      }
    },

    setLineClass: (classId) => {
      const { tool, plan } = get()
      const surface = get().surface()
      if (tool.kind !== 'route') return
      set({ tool: { ...tool, classId }, planGear: null })
      if (plan && surface) set({ plan: repricePlan(surface, plan, classId) })
    },

    setRouteStyle: (style) => {
      const { tool, plan } = get()
      if (tool.kind !== 'route') return
      set({ tool: { ...tool, style } })
      if (plan) replan(plan.from, plan.to, plan.waypoints, tool.classId, style)
    },

    undoWaypoint: () => {
      const { tool, plan } = get()
      if (tool.kind !== 'route' || !plan) return
      replan(plan.from, plan.to, plan.waypoints.slice(0, -1), tool.classId, tool.style)
    },

    clearPlan: () => set({ plan: null, planNote: null, planGear: null, tool: { kind: 'none' } }),

    commitPlan: () => {
      const { game, plan, planAt } = get()
      if (!game || !plan) return
      const ends = { fromNode: plan.from.id, toNode: plan.to.id, classId: plan.classId }
      const dc = linePower(game, ends)
      const spared = dc ? assignSpare(game, dc.id, get().planSpare ?? suggestSpare(game, ends)) : game
      const next = commitCorridor(spared, plan)
      advanceTutorial(next)
      const line = next.corridors[next.corridors.length - 1]
      commit(next, {
        plan: null, planNote: null, planGear: null, tool: { kind: 'none' },
        selectedCorridor: line?.id ?? null,
        selection: line ? { kind: 'line', id: line.id } : null, selectionAt: planAt ?? [plan.to.x, plan.to.y],
      })
    },

    selectCorridor: (id) => set({ selectedCorridor: id }),
    select: (selection, at) => {
      const { game, mapData } = get()
      const fixed = selection && game && mapData ? selectionPoint(game, mapData.grid, selection) : null
      const focus = selection?.kind === 'campus' ? 'main' : selection?.kind === 'dc' || selection?.kind === 'gear' ? selection.id : get().focus
      set({ selection, selectionAt: fixed ?? at ?? null, focus, ...(selection?.kind === 'line' && { selectedCorridor: selection.id }) })
    },

    sign: (dcId) => {
      const { game, mapData, dataCenters } = get()
      const dc = dataCenters.find((d) => d.id === dcId)
      if (!game || !mapData || !dc) return
      const next = signCustomer(game, dc, mapData.counties, mapData.grid)
      if (next === game) return
      commit({ ...next, substations: areaSubstations(next, mapData.grid, get().substations) })
    },

    setSpare: (id, mw) => {
      const { game } = get()
      if (game) commit(assignSpare(game, id, mw))
    },

    carryOn: () => {
      const { game } = get()
      if (game) commit(continueGame(game), { debriefClosed: false })
    },

    orderGear: (id, rush, siteId) => {
      const { game } = get()
      if (!game) return
      const next = orderEquipment(game, id as EquipmentId, rush, siteId)
      advanceTutorial(next)
      if (next !== game) commit(next)
    },

    cancelGear: (id) => {
      const { game } = get()
      if (game) commit(cancelEquipment(game, id))
    },

    runProgramme: (fips, id) => {
      const { game } = get()
      if (game) commit(engineRunProgramme(game, fips, id))
    },

    planFromLine: (index, at) => {
      const { game, mapData } = get()
      const line = get().mapThings().lines[index]
      if (!game || !mapData || !line) return
      const tap = tapNear({ ...game, corridors: [] }, mapData.grid, [line], at[0], at[1], 5)
      if (tap) get().planLineFrom(tap)
    },

    planLineFrom: (from) => {
      const { game, mapData } = get()
      if (!game || !mapData) return
      const node = typeof from === 'string'
        ? networkNodes(game, mapData.grid).find((n) => n.id === from) ?? null
        : from
      get().setTool({ kind: 'route', from: node, classId: '230', style: 'balanced' })
    },

    offerAll: (multiple, archetype) => {
      const { game, selectedCorridor } = get()
      if (game && selectedCorridor) commit(engineOfferAll(game, selectedCorridor, multiple, archetype))
    },

    setOffer: (parcelId, multiple) => {
      const { game, selectedCorridor } = get()
      if (game && selectedCorridor) commit(engineSetOffer(game, selectedCorridor, parcelId, multiple))
    },

    condemnParcel: (parcelId) => {
      const { game, selectedCorridor } = get()
      if (game && selectedCorridor) commit(engineCondemn(game, selectedCorridor, parcelId))
    },

    abandon: (corridorId) => {
      const { game } = get()
      if (game) commit(engineAbandon(game, corridorId), { selectedCorridor: null, selection: null })
    },

    cancelPlant: (plantId) => {
      const { game } = get()
      if (!game) return
      const next = cancelPlant(game, plantId)
      if (next !== game) commit(next, { tool: { kind: 'none' } })
    },

    expedite: (plantId) => {
      const { game } = get()
      if (game) commit(expeditePlant(game, plantId))
    },

    chooseHearing: (option) => {
      const { game } = get()
      if (game) commit(resolveHearing(game, option))
    },

    chooseEvent: (index) => {
      const { game } = get()
      if (game) commit(resolveEvent(game, index))
    },

    setTutorialHidden: (hidden) => {
      const { game } = get()
      if (game?.tutorial) commit({ ...game, tutorial: { ...game.tutorial, dismissed: hidden } })
    },

    finishDebrief: () => {
      stopClock()
      set({ showMenu: true, debriefClosed: true })
    },

    setSpeed: (speed) => {
      const { game, mapData } = get()
      if (!game?.realtime || !mapData || game.phase !== 'operate') return
      stopClock()
      game.realtime.speed = speed
      commit({ ...game })
      if (speed === 0) return

      const [minX, minY, maxX, maxY] = mapData.counties.bbox
      const bounds = { minX, minY, maxX, maxY }
      tickTimer = setInterval(() => {
        const current = get().game
        if (!current?.realtime || current.phase !== 'operate') return stopClock()

        const collected: string[] = []
        const steps = current.realtime.speed
        for (let i = 0; i < steps; i++) {
          const { events, severe } = stepRealtime(current, bounds)
          collected.push(...events)
          if (severe) {
            current.realtime.speed = 0
            stopClock()
            break
          }
        }
        set((s) => ({
          game: { ...current },
          alerts: collected.length > 0 ? [...collected.reverse(), ...s.alerts].slice(0, 30) : s.alerts,
        }))
        const now = Date.now()
        if (tickTimer === null || now - lastSave > SAVE_EVERY_MS) {
          lastSave = now
          writeSave(current)
        }
      }, BEAT_MS)
    },

    setPolicy: (policy) => {
      const { game } = get()
      if (!game?.realtime) return
      game.realtime.policy = policy
      commit({ ...game })
    },

    setVegetationSpend: (value) => {
      const { game } = get()
      if (!game?.realtime) return
      game.realtime.vegetationSpend = Math.min(1, Math.max(0, value))
      commit({ ...game })
    },

    setMaintenanceDeferred: (value) => {
      const { game } = get()
      if (!game?.realtime) return
      game.realtime.maintenanceDeferred = value
      commit({ ...game })
    },

    setCrews: (n) => {
      const { game } = get()
      if (!game) return
      engineSetCrews(game, n)
      commit({ ...game })
    },

    prioritize: (assetId) => {
      const { game } = get()
      if (!game) return
      togglePriority(game, assetId)
      commit({ ...game })
    },

    dismissAlerts: () => set({ alerts: [] }),

    mapThings: () => {
      const { substations, stateGis, gis, showGrid } = get()
      if (!showGrid) return { substations: [], lines: [] }
      if (thingsCache?.subs !== substations || thingsCache.state !== stateGis || thingsCache.local !== gis) {
        const all = [...(stateGis?.power ?? []), ...(gis?.power.filter((l) => l.kv < 115) ?? [])]
        thingsCache = {
          subs: substations, state: stateGis, local: gis,
          things: { substations, lines: all.map(withBox) },
        }
      }
      return thingsCache.things
    },

    shownCenters: () => {
      const { scenario: sc, showCenters } = get()
      const dataCenters = get().dataCenters.filter(inServiceArea)
      if (!showCenters) return []
      // The campus marker stands for the scenario's own data center.
      return sc?.id === 'americus-400' ? dataCenters.filter((d) => !d.id.startsWith('liberty-data-centers-americus')) : dataCenters
    },

    currentAssessment: () => {
      const { game, mapData, tool, hoverCell } = get()
      if (!game || !mapData || tool.kind !== 'site' || hoverCell < 0) return null
      return assessSite(game, tool.typeId, hoverCell, mapData.grid)
    },

    gridLines: () => {
      const { stateGis, gis } = get()
      return stateGis?.power ?? gis?.power ?? []
    },

    tappable: () => {
      const { game, mapData } = get()
      // The state file reaches every customer. The county file is the fallback.
      const gis = game?.customers?.length ? get().stateGis ?? get().gis : get().gis
      if (!game || !mapData || !gis) return []
      const key = `${game.system.substationCell}|${(game.customers ?? []).filter((c) => c.status !== 'cancelled').map((c) => c.id).join()}`
      if (tapCache?.gis !== gis || tapCache.key !== key) {
        tapCache = { gis, key, lines: tappableLines(game, mapData.grid, gis.power) }
      }
      return tapCache.lines
    },

    beginLine: (x, y, pxPerKm) => {
      const { tool, plan, parcelsLoading } = get()
      if (tool.kind !== 'route' || plan || parcelsLoading) return false
      const hit = endAt(x, y, pxPerKm)
      if (!hit) return false
      if (tool.from) return hit.id === tool.from.id
      set({ tool: { ...tool, from: hit }, planNote: null })
      return true
    },

    probeRoute: (x, y, pxPerKm) => {
      const { game, mapData, tool, plan } = get()
      if (!game || !mapData || tool.kind !== 'route') return null
      const here: Point = [x, y]
      if (plan) {
        const gear = planGearAt(game, plan, x, y, pxPerKm)
        if (gear) return { from: null, at: gear.at, line: null, state: 'valid', label: 'Build the transformer' }
        const near = nodeNear(networkNodes(game, mapData.grid), x, y, NODE_REACH_PX / pxPerKm)
        return near ? null : { from: null, at: here, line: null, state: 'free', label: 'Bend the route here' }
      }
      const hit = endAt(x, y, pxPerKm)
      const from = tool.from
      if (!from) {
        return hit
          ? { from: null, at: [hit.x, hit.y], line: null, state: 'valid', label: `Start at ${hit.label}` }
          : { from: null, at: here, line: null, state: 'free', label: 'Pick a marked place' }
      }
      const start: Point = [from.x, from.y]
      if (!hit) {
        const km = Math.hypot(x - from.x, y - from.y)
        return { from: start, at: here, line: null, state: 'free', label: `${km.toFixed(1)} km` }
      }
      const at: Point = [hit.x, hit.y]
      if (!canJoin(from.id, hit.id) || sitesTouch(game, from.id, hit.id)) {
        return {
          from: start, at, line: null, state: 'invalid',
          label: from.id === hit.id ? 'This is the start' : 'Already joined',
        }
      }
      const line = draftLine(from, hit, tool.style)
      const km = line ? centerlineLength([...line]) : Math.hypot(at[0] - from.x, at[1] - from.y)
      const room = roomAt(game, hit, tool.classId)
      const spare = room === null ? '' : room < 0.5 ? ', nothing to spare at this voltage' : `, ${Math.round(room).toLocaleString()} MW to spare`
      return {
        from: start, at, line, state: 'valid',
        label: `Connect to ${hit.label}, ${line ? '' : 'about '}${km.toFixed(1)} km${spare}`,
      }
    },

    stepBack: () => {
      const { tool, plan, selection, planGear } = get()
      if (planGear) set({ planGear: null })
      else if (plan) set({ plan: null, planNote: null, tool: { ...tool, from: null } as Tool })
      else if (tool.kind === 'route' && tool.from) set({ tool: { ...tool, from: null }, planNote: null })
      else if (tool.kind !== 'none') get().setTool({ kind: 'none' })
      else if (selection) set({ selection: null })
    },

    surface: () => {
      const { game, mapData, parcels, gis } = get()
      if (!mapData) return null
      return {
        grid: mapData.grid,
        owned: game ? ownedCells(game, mapData.grid) : undefined,
        parcels: parcels?.parcels ?? NO_PARCELS,
        buildings: gis?.buildings,
        powerLines: gis?.power,
      }
    },
  }
})

let thingsCache: { subs: Substation[]; state: Gis | null; local: Gis | null; things: MapThings } | null = null
const NO_PARCELS: Parcel[] = []
let tapCache: { gis: Gis; key: string; lines: ExistingLine[] } | null = null

/** Place a new waypoint on whichever leg it lengthens least. */
function insertWaypoint(plan: CorridorPlan, p: Point): Point[] {
  const stops: Point[] = [[plan.from.x, plan.from.y], ...plan.waypoints, [plan.to.x, plan.to.y]]
  const d = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1])
  let best = 0
  let least = Infinity
  for (let i = 1; i < stops.length; i++) {
    const extra = d(stops[i - 1], p) + d(p, stops[i]) - d(stops[i - 1], stops[i])
    if (extra < least) { least = extra; best = i - 1 }
  }
  const out = [...plan.waypoints]
  out.splice(best, 0, p)
  return out
}

// Used by the browser tests.
if (typeof window !== 'undefined') {
  ;(window as unknown as { __game: typeof useGame }).__game = useGame
}
