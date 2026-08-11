import type { GameState } from '../../engine/types.ts'
import { plantType } from '../../data/plants.ts'
import { approvalBand } from '../../engine/state.ts'
import { formatQuarter } from '../../engine/time.ts'
import { money, mw } from '../format.ts'

interface Props {
  game: GameState
}

/** The deal, the money still owed against it, and who is unhappy about it. */
export function ContractPanel({ game }: Props) {
  const c = game.contract
  const released = c.milestones.filter((m) => m.released)
  const drawn = released.reduce((s, m) => s + c.capexAdvance * m.fraction, 0)

  // Only counties the player has actually touched are worth listing; the other
  // 150 are noise until something happens in them.
  const involved = Object.values(game.counties)
    .filter((s) => s.fips === c.countyFips || game.plants.some((p) => p.countyFips === s.fips))
    .sort((a, b) => a.approval - b.approval)

  return (
    <section className="panel">
      <h2 className="panel-title">The deal</h2>

      <dl className="kv">
        <dt>Customer</dt><dd>{c.developer}</dd>
        <dt>Load</dt><dd>{mw(c.contractedMw)}</dd>
        <dt>In service</dt><dd>{formatQuarter(c.inServiceQuarter)}</dd>
        <dt>Late penalty</dt><dd>{money(c.latePenaltyPerQuarter)}/qtr</dd>
      </dl>

      <h3 className="panel-sub">Capital advance</h3>
      <div className="draw-bar" role="img" aria-label={`${money(drawn)} of ${money(c.capexAdvance)} released`}>
        <span style={{ width: `${(drawn / c.capexAdvance) * 100}%` }} />
      </div>
      <p className="draw-label">
        {money(drawn)} released of {money(c.capexAdvance)}
      </p>

      <ul className="milestones">
        {c.milestones.map((m) => (
          <li key={m.id} className={m.released ? 'done' : ''}>
            <span className="ms-mark" aria-hidden="true">{m.released ? '●' : '○'}</span>
            <span className="ms-label">{m.label}</span>
            <span className="ms-amount">{money(c.capexAdvance * m.fraction)}</span>
          </li>
        ))}
      </ul>

      {(game.penaltiesAccrued > 0 || game.financingCost > 0) && (
        <dl className="kv kv-warn">
          {game.penaltiesAccrued > 0 && (
            <><dt>Penalties</dt><dd>{money(game.penaltiesAccrued)}</dd></>
          )}
          {game.financingCost > 0 && (
            <><dt>Financing</dt><dd>{money(game.financingCost)}</dd></>
          )}
        </dl>
      )}

      {game.plants.length > 0 && (
        <>
          <h3 className="panel-sub">Fleet</h3>
          <ul className="fleet">
            {game.plants.map((p) => {
              const t = plantType(p.typeId)
              const total = p.status === 'permitting' ? t.permitQuarters : t.buildQuarters
              const done = total - p.quartersRemaining
              return (
                <li key={p.id}>
                  <div className="fleet-row">
                    <span className={`dot dot-${p.status}`} aria-hidden="true" />
                    <span className="fleet-name">{p.name}</span>
                    <span className="fleet-mw">{mw(p.nameplateMw * t.firmCapacityFraction)}</span>
                  </div>
                  <div className="fleet-meta">
                    {p.status === 'online'
                      ? `online since ${formatQuarter(p.commissionedQuarter!)}`
                      : `${p.status} · ${p.quartersRemaining} qtr left`}
                  </div>
                  {p.status !== 'online' && (
                    <div className="mini-bar">
                      <span style={{ width: `${(done / total) * 100}%` }} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}

      <h3 className="panel-sub">Counties</h3>
      <ul className="counties">
        {involved.map((s) => {
          const band = approvalBand(s.approval)
          return (
            <li key={s.fips}>
              <span className="county-name">{s.name}</span>
              <span className="county-meter">
                <span className={`meter-fill tone-${band.tone}`} style={{ width: `${s.approval}%` }} />
              </span>
              <span className={`county-band tone-${band.tone}`}>{band.label}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
