import type { GameState, Outcome } from '../engine/types.ts'
import { scoreParts } from '../engine/scoring.ts'

interface Props {
  game: GameState
  outcome: Outcome
  onContinue: () => void
}

const PART_LABELS: Array<{ key: keyof ReturnType<typeof scoreParts>; label: string; note: string }> = [
  { key: 'onTime', label: 'On time', note: 'Energized against the date you promised' },
  { key: 'capital', label: 'Capital', note: 'What is left of the advance' },
  { key: 'community', label: 'Community', note: 'Approval across every county you touched' },
  { key: 'reliability', label: 'Reliability', note: 'Contracted energy actually delivered' },
  { key: 'restraint', label: 'Restraint', note: 'Land taken by force' },
]

/**
 * The debrief.
 *
 * Five separate currencies rather than one number, because the argument the game
 * is making is that they trade against each other. The headline says the
 * uncomfortable part out loud — a run can score well and still be one you would
 * not want your name on.
 */
export function ScoreScreen({ game, outcome, onContinue }: Props) {
  const parts = scoreParts(game)

  return (
    <div className="overlay">
      <div className="score" role="dialog" aria-modal="true" aria-labelledby="score-title">
        <div className="score-head">
          <div>
            <span className="briefing-eyebrow">Americus · debrief</span>
            <h1 id="score-title">{outcome.headline}</h1>
          </div>
          <div className={`score-grade grade-${outcome.grade}`}>
            <strong>{outcome.grade}</strong>
            <span>{outcome.score}/100</span>
          </div>
        </div>

        <ul className="score-parts">
          {PART_LABELS.map(({ key, label, note }) => {
            const value = parts[key]
            return (
              <li key={key}>
                <div className="score-part-head">
                  <span className="score-part-label">{label}</span>
                  <span className="score-part-value">{Math.round(value)}/20</span>
                </div>
                <div className="score-bar">
                  <span
                    className={value >= 15 ? 'good' : value >= 8 ? 'fair' : 'bad'}
                    style={{ width: `${(value / 20) * 100}%` }}
                  />
                </div>
                <span className="score-part-note">{note}</span>
              </li>
            )
          })}
        </ul>

        <dl className="score-lines">
          {outcome.lines.map((line) => (
            <div key={line.label}>
              <dt>{line.label}</dt>
              <dd className={`tone-${line.tone}`}>{line.value}</dd>
            </div>
          ))}
        </dl>

        <p className="score-next">
          Sumter County stays lit from here — it is yours now, and it keeps drawing
          whatever happens next. Georgia has roughly seventeen gigawatts of announced
          data centre demand still looking for a home.
        </p>

        <button className="btn-primary btn-large" onClick={onContinue}>
          Continue
        </button>
      </div>
    </div>
  )
}
