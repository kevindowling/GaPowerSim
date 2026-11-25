import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { GameState } from '../engine/types.ts'
import { focusForecast, focusOf, type Focus } from '../engine/focus.ts'
import { phasesOn, phasing } from '../engine/phases.ts'
import { approvalBand, CANCEL_BELOW, ratingOf, STALL_BELOW } from '../engine/approval.ts'
import { quartersToDeadline } from '../engine/state.ts'
import { formatQuarter } from '../engine/time.ts'
import { powerForecast } from '../engine/forecast.ts'
import { hourOfDay, dayOfYear } from '../engine/realtime/load.ts'
import { OPERATING_YEAR_TICKS, TICKS_PER_DAY, type Speed } from '../engine/realtime/types.ts'
import { Icon } from './Icon.tsx'
import { ApprovalCard } from './ApprovalCard.tsx'
import type { DataCenter } from '../data/dataCenters.ts'
import { poolAt } from '../data/sparePower.ts'
import { spareLeft } from '../engine/customers.ts'
import { MoneyCard } from './MoneyCard.tsx'
import { SpareCard } from './SpareCard.tsx'
import { HORIZON_YEAR } from '../data/customerTerms.ts'
import { PowerCard } from './PowerCard.tsx'
import { money, mw, quarters } from './format.ts'

interface Props {
  game: GameState
  onEndQuarter: () => void
  onSpeed: (speed: Speed) => void
  onMenu: () => void
  onRunProgramme: (fips: string, id: string) => void
  centers: readonly DataCenter[]
  focusId: string
  onFocus: (id: string) => void
  blocked: string | null
  compact: boolean
  embedded: boolean
}

const SPEEDS: Array<{ value: Speed; label: string; name: string }> = [
  { value: 0, label: '', name: 'Pause' },
  { value: 1, label: '1h', name: 'One hour a second' },
  { value: 6, label: '6h', name: 'Six hours a second' },
  { value: 24, label: '1d', name: 'One day a second' },
  { value: 72, label: '3d', name: 'Three days a second' },
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

export function clockText(calendarTick: number): string {
  let d = dayOfYear(calendarTick)
  let m = 0
  while (d >= MONTH_DAYS[m]) d -= MONTH_DAYS[m++]
  const h = hourOfDay(calendarTick)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${MONTHS[m]} ${d + 1}, ${pad(Math.floor(h))}:${pad(Math.round((h % 1) * 60))}`
}

export function HUD({ game, onEndQuarter, onSpeed, onMenu, onRunProgramme, centers, focusId, onFocus, blocked, compact, embedded }: Props) {
  const rt = game.realtime
  const focus = focusOf(game, focusId, centers)
  const main = focus.id === 'main'
  const left = main || focus.deadline === null ? quartersToDeadline(game) : focus.deadline - game.quarter
  const done = main ? game.energizedQuarter !== null || game.contract.status === 'failed'
    : focus.deadline === null || focus.cancelled || focus.customer?.status === 'served'

  return (
    <header className={compact ? 'hud compact' : 'hud'}>
      {!compact && !embedded && <strong className="brand">GaPowerSim</strong>}

      <div className="stats">
        {rt ? (
          <Stat label="Date" value={clockText(rt.startTick + rt.tick)} testId="clock"
            note={`Day ${Math.min(365, Math.floor(rt.tick / TICKS_PER_DAY) + 1)} of ${OPERATING_YEAR_TICKS / TICKS_PER_DAY}`} />
        ) : (
          <Stat label="Quarter" value={formatQuarter(game.quarter)}
            note={!focus.signed || done ? `to ${HORIZON_YEAR} Q4`
              : left < 0 ? `${quarters(-left)} late` : compact ? `${left} left` : `${quarters(left)} to deadline`}
            tone={!focus.signed || done ? undefined : left < 0 ? 'bad' : left <= 3 ? 'warn' : undefined} />
        )}
        <StatButton label="Cash" value={money(game.cash)} of=""
          tone={game.cash < -game.creditLimit * 0.7 ? 'bad' : game.cash < 0 ? 'warn' : undefined}
          note={`Credit to ${money(-game.creditLimit)}`}
          card={(close) => <MoneyCard game={game} onClose={close} onFocus={onFocus} />} />
        {!compact && <FocusStat game={game} focus={focus} compact={false} onFocus={onFocus} />}
        {!compact && (!rt || focus.id !== 'main') && <PowerStat game={game} focus={focus} compact={false} />}
        {!compact && <ApprovalStat game={game} focus={focus} compact={false} onRun={onRunProgramme} />}
        {!compact && <SpareStat game={game} centers={centers} compact={false} />}
      </div>

      {game.phase === 'operate' && rt && (
        <div className="speeds" role="group" aria-label="Simulation speed">
          {SPEEDS.map((s) => (
            <button key={s.value} className={rt.speed === s.value ? 'on' : ''}
              onClick={() => onSpeed(s.value)} aria-pressed={rt.speed === s.value}
              aria-label={s.name} title={s.name}>
              {s.value === 0 ? <Icon name="pause" /> : s.label}
            </button>
          ))}
        </div>
      )}
      {game.phase === 'build' && (
        <button className="btn primary" onClick={onEndQuarter} disabled={blocked !== null}
          title={blocked ?? undefined}>
          End quarter
        </button>
      )}
      {game.phase === 'ended' && <span className="stat-label">Scenario over</span>}
      <button className="btn ghost icon-only" onClick={onMenu} aria-label="Menu"><Icon name="menu" /></button>
      {compact && (
        <div className="stat-row">
          <FocusStat game={game} focus={focus} compact onFocus={onFocus} />
          {(!rt || focus.id !== 'main') && <PowerStat game={game} focus={focus} compact />}
          <ApprovalStat game={game} focus={focus} compact onRun={onRunProgramme} />
          <SpareStat game={game} centers={centers} compact />
        </div>
      )}
    </header>
  )
}

/** A header figure that opens its explanation underneath. */
function StatButton({ label, value, of, note, tone, bar, card, end, long }: {
  label: string
  value: string
  of: string
  note?: string
  tone?: 'warn' | 'bad'
  bar?: ReactNode
  card: (close: () => void) => ReactNode
  end?: boolean
  /** Cut a long value short. */
  long?: boolean
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent): void => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [open])

  return (
    <div className={end ? 'stat-wrap end' : 'stat-wrap'} ref={wrap}>
      <button className="stat stat-button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((v) => !v)}>
        <span className="stat-label">{label} <Icon name="chevronDown" /></span>
        <span className={`stat-value${tone === 'bad' ? ' hud-bad' : ''}${long ? ' long' : ''}`} title={long ? value : undefined}>{value} <span className="of">{of}</span></span>
        {note && <span className={tone ? `stat-note hud-${tone}` : 'stat-note'}>{note}</span>}
        {bar && <span className="capbar" aria-hidden="true">{bar}</span>}
      </button>
      {open && card(() => setOpen(false))}
    </div>
  )
}

/** Which data center the header is about, and a list to change it. */
function FocusStat({ game, focus, compact, onFocus }: { game: GameState; focus: Focus; compact: boolean; onFocus: (id: string) => void }) {
  const list = [
    { id: 'main', name: game.contract.name, note: `${phasesOn(game)} of ${phasing(game).count} phases on` },
    ...(game.customers ?? []).map((c) => ({
      id: c.id, name: c.name, note: c.status === 'cancelled' ? 'Cancelled' : `${c.phasesOn} of ${c.phaseCount} phases on`,
    })),
  ]
  return (
    <StatButton label="Data center" value={focus.name} of="" long
      note={compact ? undefined : !focus.signed ? 'Not signed' : focus.cancelled ? 'Cancelled' : `${focus.phasesOn} of ${focus.count} phases on`}
      card={(close) => (
        <section className="power-card" role="dialog" aria-label="Choose a data center">
          <div className="inspector-head">
            <h2>You supply</h2>
            <button className="btn ghost icon-only" onClick={close} aria-label="Close"><Icon name="close" /></button>
          </div>
          <ul className="programmes">
            {list.map((c) => (
              <li key={c.id}>
                <button className="programme" aria-pressed={c.id === focus.id} onClick={() => { onFocus(c.id); close() }}>
                  <span className="programme-name">{c.name}</span>
                  <span className="note">{c.note}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="note">Click any data center on the map to look at it.</p>
        </section>
      )} />
  )
}

function PowerStat({ game, focus, compact }: { game: GameState; focus: Focus; compact: boolean }) {
  const forecast = useMemo(() => powerForecast(game), [game])
  const { now, plannedMw, plannedQuarter, readyQuarter } = focusForecast(forecast, focus)
  const need = focus.needMw
  const share = (v: number): string => `${need > 0 ? Math.min(100, (v / need) * 100) : 0}%`

  const stranded = focus.id !== 'main' ? 0 : [...forecast.points[forecast.points.length - 1].flow.plants.values()]
    .reduce((n, p) => n + (p.limit?.kind === 'no-line' ? p.firmMw : 0), 0)
  const late = readyQuarter !== null && focus.deadline !== null && readyQuarter > focus.deadline
  const note = !focus.signed ? 'Not signed'
    : plannedQuarter === null
      ? stranded > 0.5 ? `${mw(stranded)} has no line` : plannedMw > 0.5 ? 'No more on the way' : 'Nothing filed'
      : `${mw(plannedMw)} by ${formatQuarter(plannedQuarter)}${late ? ', late' : ''}`
  const enough = readyQuarter !== null && !late

  return (
    <StatButton label="Power at Data Center Campus" value={`${Math.round(now)}`} of={`of ${mw(need)}`}
      note={compact ? undefined : note} tone={enough || note === 'Nothing filed' || !focus.signed ? undefined : 'warn'}
      bar={<>
        <span className="under" style={{ width: share(plannedMw) }} />
        <span className="linked" style={{ width: share(now) }} />
        {Array.from({ length: Math.max(0, focus.count - 1) }, (_, i) => (
          <i key={i} style={{ left: share((i + 1) * focus.mwEach) }} />
        ))}
      </>}
      card={(close) => <PowerCard game={game} focus={focus} forecast={forecast} onClose={close} />} />
  )
}

function SpareStat({ game, centers, compact }: { game: GameState; centers: readonly DataCenter[]; compact: boolean }) {
  const left = spareLeft(game)
  return (
    <StatButton label={compact ? 'Grid spare' : 'Spare power on the grid'} value={Math.round(left).toLocaleString()} of="MW left" end
      note={compact ? undefined : `of ${mw(poolAt(game.quarter))}`} tone={left < 0 ? 'bad' : undefined}
      card={(close) => <SpareCard game={game} list={centers} onClose={close} />} />
  )
}

function ApprovalStat({ game, focus, compact, onRun }: {
  game: GameState
  focus: Focus
  compact: boolean
  onRun: (fips: string, id: string) => void
}) {
  const a = focus.fips === null ? null : ratingOf(game, focus.fips)
  const risk = focus.id === 'main' ? game.phase === 'build' && game.contract.status === 'accepted' : focus.customer?.status === 'signed'
  return (
    <StatButton label="Data center approval" value={a === null ? 'None' : `${Math.round(a)}`} of={a === null ? '' : 'of 100'} end
      note={compact ? undefined : a === null ? 'Not signed' : risk && a < STALL_BELOW ? `Cancelled below ${CANCEL_BELOW}` : approvalBand(a).label}
      tone={a === null ? undefined : risk && a < CANCEL_BELOW ? 'bad' : a < STALL_BELOW ? 'warn' : undefined}
      bar={<>
        <span className="linked" style={{ width: `${a ?? 0}%` }} />
        {risk && <i style={{ left: `${CANCEL_BELOW}%` }} />}
      </>}
      card={(close) => <ApprovalCard game={game} focus={focus} onRun={onRun} onClose={close} />} />
  )
}

function Stat({ label, value, note, tone, testId }: {
  label: string
  value: string
  note?: string
  tone?: 'warn' | 'bad'
  testId?: string
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${testId ?? ''} ${tone ? `hud-${tone}` : ''}`}>{value}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  )
}
