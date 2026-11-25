import type { GameState } from '../engine/types.ts'
import { spareAssigned, spareCharge, spareLeft } from '../engine/customers.ts'
import { SPARE_ENERGY } from '../data/customerTerms.ts'
import { poolAt } from '../data/sparePower.ts'
import { money, mw } from './format.ts'

/** Set spare power aside for a data center. 'main' is the first. */
export function SpareSlider({ game, id, value, most, arriving, onSet }: {
  game: GameState
  id: string
  value: number
  most: number
  arriving: number
  onSet: (id: string, mw: number) => void
}) {
  if (!game.equipment || game.phase === 'ended') return null
  const left = spareLeft(game)
  const max = Math.min(most, value + Math.max(0, left))
  return (
    <>
      <h3>Spare power</h3>
      <label className="field">
        <span>Set aside</span>
        <input type="range" min={0} max={Math.max(0, Math.floor(max))} step={1} value={Math.min(value, max)}
          onChange={(e) => onSet(id, Number(e.target.value))} aria-label="Spare power set aside" />
        <span className="num">{mw(value)}</span>
      </label>
      <p className="note">
        {mw(Math.max(0, left))} of {mw(poolAt(game.quarter))} is left to share. {value > 0 && `${mw(arriving)} of this arrives on the lines you have. `}
        It costs {money(spareCharge(1, 1))} a MW each quarter once phases are on, and ${SPARE_ENERGY} a MWh.
        {spareAssigned(game) > poolAt(game.quarter) && ' More is set aside than there is, so the rest is being bought at twice the price.'}
      </p>
    </>
  )
}
