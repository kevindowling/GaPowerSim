import { useState } from 'react'
import type { GameState } from '../engine/types.ts'
import { BEATS, beatIndex, currentBeat, type TutorialBeat } from '../engine/tutorial.ts'
import { Icon } from './Icon.tsx'

const TAB_NAMES: Record<TutorialBeat['focus'], string> = {
  build: 'Build', grid: 'Grid', land: 'land offers', customers: 'Customers', ops: 'Operate',
}

export function TutorialCoach({ game, activeTab, startOpen, onGo, onHide }: {
  game: GameState
  activeTab: string
  startOpen: boolean
  onGo: (tab: TutorialBeat['focus']) => void
  onHide: () => void
}) {
  const [open, setOpen] = useState(startOpen)
  const beat = currentBeat(game)
  if (!beat) return null
  const i = beatIndex(game)

  return (
    <section className={open ? 'coach' : 'coach collapsed'} aria-label="Guide" aria-live="polite">
      <div className="coach-head">
        <h2 className="coach-title">{beat.title}</h2>
        <span className="coach-step">{i + 1} of {BEATS.length}</span>
        <button className="btn ghost icon-only" onClick={() => setOpen((v) => !v)}
          aria-expanded={open} aria-label={open ? 'Collapse the guide' : 'Expand the guide'}>
          <Icon name={open ? 'chevronUp' : 'chevronDown'} />
        </button>
        <button className="btn ghost icon-only" onClick={onHide} aria-label="Hide the guide"><Icon name="close" /></button>
      </div>
      {open && (
        <>
          {beat.body.map((line) => <p key={line}>{line}</p>)}
          {beat.focus !== activeTab && (
            <button className="btn small" onClick={() => onGo(beat.focus)}>Open {TAB_NAMES[beat.focus]}</button>
          )}
        </>
      )}
    </section>
  )
}
