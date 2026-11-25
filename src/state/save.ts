import type { GameState } from '../engine/types.ts'
import { STATE_VERSION } from '../engine/state.ts'

const KEY = 'gapowersim.save'

// Storage throws in some sandboxed iframes. The game still has to run there.
export function writeSave(game: GameState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(game))
  } catch { /* unavailable or full */ }
}

export function readSave(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const game = JSON.parse(raw) as GameState
    return game.version === STATE_VERSION ? game : null
  } catch {
    return null
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY)
  } catch { /* unavailable */ }
}
