import { useState } from 'react'
import type { GameState } from '../engine/types.ts'
import { BEATS, currentBeat } from '../engine/tutorial.ts'

interface Props {
  game: GameState
  onDismiss: () => void
}

/**
 * The coach.
 *
 * Sits out of the way, states what this beat is about, and gets out of the
 * player's hands — every beat completes because the player did the thing, never
 * because they clicked "next". It can be dismissed permanently, because a
 * tutorial that cannot be turned off is a nag.
 */
export function TutorialCoach({ game, onDismiss }: Props) {
  // Collapsible because on a phone the full card covers half the map, and the
  // map is what the player is being asked to act on.
  const [open, setOpen] = useState(true)
  const beat = currentBeat(game)
  if (!beat) return null

  const index = game.tutorial!.beat
  return (
    <aside className={open ? 'coach' : 'coach collapsed'} aria-live="polite">
      <div className="coach-head">
        <span className="coach-step">
          {index + 1} of {BEATS.length}
        </span>
        <div className="coach-actions">
          <button
            className="coach-collapse"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? 'Collapse the hint' : 'Expand the hint'}
          >
            {open ? '▾' : '▴'}
          </button>
          <button className="coach-close" onClick={onDismiss} aria-label="Dismiss the tutorial">
            ✕
          </button>
        </div>
      </div>

      <button
        className="coach-title-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <h2 className="coach-title">{beat.title}</h2>
      </button>

      {open && beat.body.map((line, i) => <p key={i}>{line}</p>)}

      <div className="coach-progress" role="img" aria-label={`Beat ${index + 1} of ${BEATS.length}`}>
        {BEATS.map((b, i) => (
          <span key={b.id} className={i < index ? 'done' : i === index ? 'now' : ''} />
        ))}
      </div>
    </aside>
  )
}
