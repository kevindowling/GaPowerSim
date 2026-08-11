/**
 * The one mutable thing in the app.
 *
 * The engine produces new GameState values; this store just holds the current
 * one plus the UI-only state that has no business inside the simulation (which
 * tool is active, what the pointer is over). Keeping that split means a save
 * file is `state.game` and nothing else.
 */

import { create } from 'zustand'
import type { MapData } from '../engine/geo/mapTypes.ts'
import type { GameState } from '../engine/types.ts'
import type { PlantKind } from '../data/plants.ts'
import { loadMapData } from '../data/loadMapData.ts'
import { createGame, resetPlantCounter } from '../engine/state.ts'
import { endQuarter as resolveQuarter, acceptContract } from '../engine/turn/resolve.ts'
import { sitePlant, assessSite, type SiteAssessment } from '../engine/turn/siting.ts'
import { scenario, type Scenario } from '../data/scenarios.ts'
import { project } from '../engine/geo/projection.ts'
import { pointToCell } from '../engine/geo/hex.ts'
import type { LineClassId } from '../data/transmission.ts'
import { loadCountyParcels, clearParcelCache, type CountyParcels } from '../data/loadParcels.ts'
import {
  planCorridor, commitCorridor, offerAll as engineOfferAll, setOffer as engineSetOffer,
  condemn as engineCondemn, abandonCorridor as engineAbandon, resetCorridorCounter,
  type CorridorPlan,
} from '../engine/turn/corridor.ts'
import type { Parcel } from '../engine/parcels/types.ts'

export type Tool =
  | { kind: 'none' }
  | { kind: 'site'; typeId: PlantKind }
  /** Picking the two ends of a new transmission corridor. */
  | { kind: 'route'; from: number | null; classId: LineClassId }

interface Store {
  mapData: MapData | null
  loadError: string | null
  game: GameState | null
  scenario: Scenario | null

  tool: Tool
  hoverCell: number
  hoverParcel: string | null
  /** Headlines from the most recent quarter, shown as a summary card. */
  headlines: string[]
  showBriefing: boolean

  /** Parcels for the scenario county, loaded on demand. */
  parcels: CountyParcels | null
  parcelsLoading: boolean
  parcelError: string | null

  /** The route currently being previewed, before it is committed. */
  plan: CorridorPlan | null
  /** Which corridor the acquisition panel is showing. */
  selectedCorridor: string | null

  load: () => Promise<void>
  startScenario: (id: string) => void
  accept: () => void
  dismissBriefing: () => void
  setTool: (tool: Tool) => void
  setHoverCell: (cell: number) => void
  setHoverParcel: (id: string | null) => void
  placeAt: (cell: number) => void
  endQuarter: () => void
  dismissHeadlines: () => void

  ensureParcels: () => Promise<void>
  setLineClass: (classId: LineClassId) => void
  clearPlan: () => void
  commitPlan: () => void
  selectCorridor: (id: string | null) => void
  offerAll: (multiple: number) => void
  setOffer: (parcelId: string, multiple: number) => void
  condemnParcel: (parcelId: string) => void
  abandon: (corridorId: string) => void

  /** Assessment of the hovered cell for the active siting tool, if any. */
  currentAssessment: () => SiteAssessment | null
  parcelById: (id: string) => Parcel | undefined
}

/** Resolve a scenario's lon/lat site to a grid cell index. */
function siteCellOf(sc: Scenario, map: MapData): number {
  const [x, y] = project(sc.contract.site.lon, sc.contract.site.lat)
  const [col, row] = pointToCell(map.grid.spec, x, y)
  return row * map.grid.spec.cols + col
}

export const useGame = create<Store>((set, get) => ({
  mapData: null,
  loadError: null,
  game: null,
  scenario: null,
  tool: { kind: 'none' },
  hoverCell: -1,
  hoverParcel: null,
  headlines: [],
  showBriefing: true,
  parcels: null,
  parcelsLoading: false,
  parcelError: null,
  plan: null,
  selectedCorridor: null,

  load: async () => {
    try {
      const mapData = await loadMapData()
      set({ mapData, loadError: null })
    } catch (e) {
      set({ loadError: e instanceof Error ? e.message : String(e) })
    }
  },

  startScenario: (id) => {
    const { mapData } = get()
    if (!mapData) return
    const sc = scenario(id)
    resetPlantCounter()
    resetCorridorCounter()
    clearParcelCache()
    const game = createGame(sc, siteCellOf(sc, mapData), mapData.counties)
    set({
      game, scenario: sc, showBriefing: true, headlines: [], tool: { kind: 'none' },
      parcels: null, plan: null, selectedCorridor: null, parcelError: null,
    })
  },

  accept: () => {
    const { game } = get()
    if (!game) return
    set({ game: acceptContract(game), showBriefing: false })
  },

  dismissBriefing: () => set({ showBriefing: false }),

  setTool: (tool) => {
    set({ tool, plan: null })
    // Routing needs the cadastre; start fetching as soon as the tool is picked
    // rather than making the player wait after their first click.
    if (tool.kind === 'route') void get().ensureParcels()
  },

  setHoverCell: (cell) => {
    if (get().hoverCell !== cell) set({ hoverCell: cell })
  },

  setHoverParcel: (id) => {
    if (get().hoverParcel !== id) set({ hoverParcel: id })
  },

  placeAt: (cell) => {
    const { game, mapData, tool, parcels } = get()
    if (!game || !mapData) return

    if (tool.kind === 'site') {
      const assessment = assessSite(game, tool.typeId, cell, mapData.grid)
      if (!assessment.ok) return
      set({ game: sitePlant(game, tool.typeId, cell, mapData.grid), tool: { kind: 'none' } })
      return
    }

    if (tool.kind === 'route') {
      if (tool.from === null) {
        set({ tool: { ...tool, from: cell }, plan: null })
        return
      }
      // Second click closes the route and prices it.
      const plan = planCorridor(
        mapData.grid, tool.from, cell, tool.classId, parcels?.parcels ?? [],
      )
      set({ plan })
    }
  },

  endQuarter: () => {
    const { game, parcels } = get()
    if (!game) return
    const lookup = new Map((parcels?.parcels ?? []).map((p) => [p.id, p]))
    const { state, headlines } = resolveQuarter(game, { parcels: lookup })
    set({ game: state, headlines })
  },

  dismissHeadlines: () => set({ headlines: [] }),

  ensureParcels: async () => {
    const { parcels, parcelsLoading, game } = get()
    if (parcels || parcelsLoading || !game) return
    set({ parcelsLoading: true, parcelError: null })
    try {
      const loaded = await loadCountyParcels(game.contract.countyFips)
      set({ parcels: loaded, parcelsLoading: false })
    } catch (e) {
      set({
        parcelsLoading: false,
        parcelError: e instanceof Error ? e.message : String(e),
      })
    }
  },

  setLineClass: (classId) => {
    const { tool, mapData, parcels } = get()
    if (tool.kind !== 'route') return
    set({ tool: { ...tool, classId } })
    // Re-price the existing route at the new voltage rather than making the
    // player redraw it — the right-of-way width, and so the taking, changes.
    const { plan } = get()
    if (plan && mapData && tool.from !== null) {
      const last = plan.cells[plan.cells.length - 1]
      set({ plan: planCorridor(mapData.grid, tool.from, last, classId, parcels?.parcels ?? []) })
    }
  },

  clearPlan: () => set({ plan: null, tool: { kind: 'none' } }),

  commitPlan: () => {
    const { game, plan, parcels } = get()
    if (!game || !plan) return
    const next = commitCorridor(game, plan, parcels?.parcels ?? [])
    set({
      game: next,
      plan: null,
      tool: { kind: 'none' },
      selectedCorridor: next.corridors[next.corridors.length - 1]?.id ?? null,
    })
  },

  selectCorridor: (id) => set({ selectedCorridor: id }),

  offerAll: (multiple) => {
    const { game, selectedCorridor } = get()
    if (!game || !selectedCorridor) return
    set({ game: engineOfferAll(game, selectedCorridor, multiple) })
  },

  setOffer: (parcelId, multiple) => {
    const { game, selectedCorridor } = get()
    if (!game || !selectedCorridor) return
    set({ game: engineSetOffer(game, selectedCorridor, parcelId, multiple) })
  },

  condemnParcel: (parcelId) => {
    const { game, selectedCorridor } = get()
    if (!game || !selectedCorridor) return
    const parcel = get().parcelById(parcelId)
    if (!parcel) return
    set({ game: engineCondemn(game, selectedCorridor, parcelId, parcel) })
  },

  abandon: (corridorId) => {
    const { game } = get()
    if (!game) return
    set({ game: engineAbandon(game, corridorId), selectedCorridor: null })
  },

  parcelById: (id) => get().parcels?.parcels.find((p) => p.id === id),

  currentAssessment: () => {
    const { game, mapData, tool, hoverCell } = get()
    if (!game || !mapData || tool.kind !== 'site' || hoverCell < 0) return null
    return assessSite(game, tool.typeId, hoverCell, mapData.grid)
  },
}))
