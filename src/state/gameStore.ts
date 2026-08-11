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

export type Tool =
  | { kind: 'none' }
  | { kind: 'site'; typeId: PlantKind }

interface Store {
  mapData: MapData | null
  loadError: string | null
  game: GameState | null
  scenario: Scenario | null

  tool: Tool
  hoverCell: number
  /** Headlines from the most recent quarter, shown as a summary card. */
  headlines: string[]
  showBriefing: boolean

  load: () => Promise<void>
  startScenario: (id: string) => void
  accept: () => void
  dismissBriefing: () => void
  setTool: (tool: Tool) => void
  setHoverCell: (cell: number) => void
  placeAt: (cell: number) => void
  endQuarter: () => void
  dismissHeadlines: () => void

  /** Assessment of the hovered cell for the active siting tool, if any. */
  currentAssessment: () => SiteAssessment | null
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
  headlines: [],
  showBriefing: true,

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
    const game = createGame(sc, siteCellOf(sc, mapData), mapData.counties)
    set({ game, scenario: sc, showBriefing: true, headlines: [], tool: { kind: 'none' } })
  },

  accept: () => {
    const { game } = get()
    if (!game) return
    set({ game: acceptContract(game), showBriefing: false })
  },

  dismissBriefing: () => set({ showBriefing: false }),

  setTool: (tool) => set({ tool }),

  setHoverCell: (cell) => {
    if (get().hoverCell !== cell) set({ hoverCell: cell })
  },

  placeAt: (cell) => {
    const { game, mapData, tool } = get()
    if (!game || !mapData || tool.kind !== 'site') return
    const assessment = assessSite(game, tool.typeId, cell, mapData.grid)
    if (!assessment.ok) return
    set({ game: sitePlant(game, tool.typeId, cell, mapData.grid), tool: { kind: 'none' } })
  },

  endQuarter: () => {
    const { game } = get()
    if (!game) return
    const { state, headlines } = resolveQuarter(game)
    set({ game: state, headlines })
  },

  dismissHeadlines: () => set({ headlines: [] }),

  currentAssessment: () => {
    const { game, mapData, tool, hoverCell } = get()
    if (!game || !mapData || tool.kind !== 'site' || hoverCell < 0) return null
    return assessSite(game, tool.typeId, hoverCell, mapData.grid)
  },
}))
