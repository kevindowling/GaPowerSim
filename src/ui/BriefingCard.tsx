import type { Scenario } from '../data/scenarios.ts'
import { formatQuarter } from '../engine/time.ts'
import { money, mw } from './format.ts'

interface Props {
  scenario: Scenario
  onAccept: () => void
}

/** The offer, before anyone has been asked how they feel about it. */
export function BriefingCard({ scenario, onAccept }: Props) {
  const c = scenario.contract
  return (
    <div className="overlay">
      <div className="briefing" role="dialog" aria-modal="true" aria-labelledby="briefing-title">
        <div className="briefing-head">
          <span className="briefing-eyebrow">Scenario {scenario.order}</span>
          <h1 id="briefing-title">{scenario.title}</h1>
          <p className="briefing-sub">{scenario.subtitle}</p>
        </div>

        <div className="briefing-body">
          {scenario.briefing.map((line, i) => <p key={i}>{line}</p>)}
        </div>

        <dl className="briefing-terms">
          <div><dt>Contracted load</dt><dd>{mw(c.contractedMw)}</dd></div>
          <div><dt>In service by</dt><dd>{formatQuarter(c.inServiceQuarter)}</dd></div>
          <div><dt>Capital advanced</dt><dd>{money(c.capexAdvance)}</dd></div>
          <div><dt>Penalty per quarter late</dt><dd>{money(c.latePenaltyPerQuarter)}</dd></div>
        </dl>

        {scenario.basedOn === 'projection' ? (
          <p className="briefing-disclaimer">
            This scenario is a <strong>projection</strong>, not a filed project. Georgia's data
            center pipeline and the grid it strains are real; this particular campus and its
            developer are invented so that no real company is described as having announced
            something it has not.
          </p>
        ) : (
          <div className="briefing-sources">
            <p className="briefing-disclaimer">
              This is a <strong>real project</strong>. The developer, the site, the phase structure
              and the opposition are reported fact. The utility-side deal terms above — the capital
              advance, the deadline, the penalties — are invented to make a game; no such contract
              is public.
            </p>
            <ul>
              {scenario.sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer noopener">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        <button className="btn-primary btn-large" onClick={onAccept}>
          Sign the contract
        </button>
      </div>
    </div>
  )
}
