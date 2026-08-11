import { useEffect, useRef } from 'react'
import type { LogEntry } from '../../engine/types.ts'
import { formatQuarter } from '../../engine/time.ts'

/** The record of what happened, newest last, auto-scrolled. */
export function LogPanel({ log }: { log: readonly LogEntry[] }) {
  const ref = useRef<HTMLOListElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log.length])

  if (log.length === 0) {
    return (
      <div className="logstrip empty">
        <span>Nothing has happened yet. That is the last time that will be true.</span>
      </div>
    )
  }

  return (
    <ol className="logstrip" ref={ref} aria-live="polite" aria-label="Event log">
      {log.map((e, i) => (
        <li key={i} className={e.important ? 'important' : ''}>
          <span className={`log-kind kind-${e.kind}`}>{e.kind}</span>
          <span className="log-quarter">{formatQuarter(e.quarter)}</span>
          <span className="log-text">{e.text}</span>
        </li>
      ))}
    </ol>
  )
}
