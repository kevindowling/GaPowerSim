import { useState } from 'react'
import type { GameState, Corridor } from '../../engine/types.ts'
import type { Parcel } from '../../engine/parcels/types.ts'
import { ARCHETYPE_LABEL } from '../../engine/parcels/types.ts'
import { acceptanceProbability, offerAmount } from '../../engine/parcels/negotiation.ts'
import { countyApproval } from '../../engine/state.ts'
import { money, acres } from '../format.ts'

interface Props {
  game: GameState
  corridor: Corridor
  parcelById: (id: string) => Parcel | undefined
  onOfferAll: (multiple: number) => void
  onSetOffer: (parcelId: string, multiple: number) => void
  onCondemn: (parcelId: string) => void
  onAbandon: (corridorId: string) => void
  onHoverParcel: (id: string | null) => void
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'No offer yet',
  offered: 'Offer on the table',
  accepted: 'Signed',
  holdout: 'Refused',
  condemning: 'In court',
  condemned: 'Taken',
  blocked: 'Cannot be taken',
}

/**
 * Right-of-way acquisition, parcel by parcel.
 *
 * The list is ordered by how much trouble each owner is, so the handful that
 * will decide the schedule are at the top rather than buried among the forty
 * timber tracts that signed without reading.
 */
export function AcquisitionPanel({
  game, corridor, parcelById, onOfferAll, onSetOffer, onCondemn, onAbandon, onHoverParcel,
}: Props) {
  const [bulkMultiple, setBulkMultiple] = useState(1.25)

  const rows = Object.entries(corridor.deals)
    .map(([parcelId, deal]) => ({
      deal,
      parcel: parcelById(parcelId),
      taking: corridor.takings[parcelId],
    }))
    .filter((r): r is { deal: typeof r.deal; parcel: Parcel; taking: NonNullable<typeof r.taking> } =>
      Boolean(r.parcel && r.taking))

  const order: Record<string, number> = {
    blocked: 0, holdout: 1, condemning: 2, pending: 3, offered: 4, accepted: 5, condemned: 6,
  }
  rows.sort((a, b) =>
    (order[a.deal.status] ?? 9) - (order[b.deal.status] ?? 9)
    || b.taking.appraisedTotal - a.taking.appraisedTotal)

  const settled = rows.filter(
    (r) => r.deal.status === 'accepted' || r.deal.status === 'condemned').length
  const blocked = rows.filter((r) => r.deal.status === 'blocked').length

  return (
    <section className="panel">
      <h2 className="panel-title">Right of way</h2>

      <div className="acq-progress">
        <div className="acq-bar">
          <span style={{ width: `${(settled / Math.max(1, rows.length)) * 100}%` }} />
        </div>
        <span className="acq-count">{settled} of {rows.length} settled</span>
      </div>

      <dl className="kv">
        <dt>Paid so far</dt><dd>{money(corridor.rowPaid)}</dd>
        {corridor.legalCosts > 0 && (<><dt>Legal</dt><dd>{money(corridor.legalCosts)}</dd></>)}
        {corridor.condemnations > 0 && (
          <><dt>Condemned</dt><dd className="tone-bad">{corridor.condemnations}</dd></>
        )}
      </dl>

      {blocked > 0 && (
        <p className="panel-note tone-bad">
          {blocked} {blocked === 1 ? 'parcel is' : 'parcels are'} protected and cannot be taken
          at any price. This route can never be completed — reroute around it.
        </p>
      )}

      {corridor.condemnations > 0 && (
        <p className="panel-note">
          Word has got around. Every owner still holding out on this line is harder to deal
          with than they were.
        </p>
      )}

      {corridor.status === 'acquiring' && (
        <div className="bulk-offer">
          <label>
            Offer everyone
            <input
              type="range"
              min={1}
              max={4}
              step={0.05}
              value={bulkMultiple}
              onChange={(e) => setBulkMultiple(Number(e.target.value))}
            />
            <strong>{bulkMultiple.toFixed(2)}×</strong>
          </label>
          <button className="btn-secondary" onClick={() => onOfferAll(bulkMultiple)}>
            Send offers
          </button>
        </div>
      )}

      <ul className="parcel-list">
        {rows.map(({ deal, parcel, taking }) => {
          const chance = acceptanceProbability(
            parcel, taking, deal,
            countyApproval(game, parcel.countyFips),
            corridor.condemnations,
          )
          const canAct = deal.status !== 'accepted' && deal.status !== 'condemned'
            && deal.status !== 'condemning'

          return (
            <li
              key={parcel.id}
              className={`parcel-row status-${deal.status}`}
              onMouseEnter={() => onHoverParcel(parcel.id)}
              onMouseLeave={() => onHoverParcel(null)}
            >
              <div className="parcel-head">
                <span className="parcel-owner">{parcel.owner}</span>
                <span className="parcel-status">{STATUS_LABEL[deal.status]}</span>
              </div>

              <div className="parcel-meta">
                <span>{ARCHETYPE_LABEL[parcel.archetype]}</span>
                <span>{acres(taking.takenAcres)} of {acres(parcel.acres)}</span>
              </div>

              {taking.severed && (
                <div className="parcel-severed">
                  Cut into {taking.remainderPieces} pieces · severance
                  {' '}{Math.round(taking.severanceFactor * 100)}%
                </div>
              )}

              <div className="parcel-money">
                <span>Appraised {money(taking.appraisedTotal)}</span>
                {deal.status === 'accepted' || deal.status === 'condemned' ? (
                  <strong>Paid {money(deal.paid)}</strong>
                ) : (
                  <span>Offer {money(offerAmount(taking, deal))}</span>
                )}
              </div>

              {canAct && deal.status !== 'blocked' && (
                <div className="parcel-actions">
                  <span className={`chance chance-${chance > 0.6 ? 'high' : chance > 0.3 ? 'mid' : 'low'}`}>
                    {Math.round(chance * 100)}% likely
                  </span>
                  <button
                    className="btn-tiny"
                    onClick={() => onSetOffer(parcel.id, deal.offerMultiple + 0.5)}
                  >
                    Offer {(deal.offerMultiple + 0.5).toFixed(2)}×
                  </button>
                  <button className="btn-tiny danger" onClick={() => onCondemn(parcel.id)}>
                    Condemn
                  </button>
                </div>
              )}

              {deal.status === 'condemning' && (
                <div className="parcel-actions">
                  <span className="chance chance-low">
                    {deal.condemnationQuarters} more {deal.condemnationQuarters === 1 ? 'quarter' : 'quarters'} in court
                  </span>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {corridor.status !== 'energized' && (
        <button className="btn-link danger" onClick={() => onAbandon(corridor.id)}>
          Abandon this route
        </button>
      )}
    </section>
  )
}
