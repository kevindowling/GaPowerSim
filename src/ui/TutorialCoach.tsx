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
  const beat = currentBeat(game)
  if (!beat) return null

  const index = game.tutorial!.beat
  return (
    <aside className="coach" aria-live="polite">
      <div className="coach-head">
        <span className="coach-step">
          {index + 1} of {BEATS.length}
        </span>
        <button className="coach-close" onClick={onDismiss} aria-label="Dismiss the tutorial">
          ✕
        </button>
      </div>

      <h2 className="coach-title">{beat.title}</h2>
      {beat.body.map((line, i) => <p key={i}>{line}</p>)}

      <div className="coach-progress" role="img" aria-label={`Beat ${index + 1} of ${BEATS.length}`}>
        {BEATS.map((b, i) => (
          <span key={b.id} className={i < index ? 'done' : i === index ? 'now' : ''} />
        ))}
      </div>
    </aside>
  )
}
