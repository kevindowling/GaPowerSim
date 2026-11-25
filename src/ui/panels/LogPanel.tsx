import type { LogEntry } from '../../engine/types.ts'
import { formatQuarter } from '../../engine/time.ts'

export function LogPanel({ log }: { log: readonly LogEntry[] }) {
  return (
    <div className="panel">
      <h2>Log</h2>
      {log.length === 0 && <p className="note">Sign the contract to begin.</p>}
      <ol className="log" aria-label="Event log">
        {log.slice().reverse().map((e, i) => (
          <li key={log.length - i} className={e.important ? 'important' : ''}>
            <span className="log-when">{formatQuarter(e.quarter)}</span>
            <span>{e.text}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
