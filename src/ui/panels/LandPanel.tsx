import { useEffect, useState } from 'react'
import type { GameState, Corridor } from '../../engine/types.ts'
import { ARCHETYPE_LABEL, type ParcelArchetype } from '../../engine/parcels/types.ts'
import {
  acceptanceProbability, condemnationApprovalCost, condemnationLegalCost, highestMultiplePaid,
  negotiationContext, offerAmount, MAX_OFFER, type ParcelDeal,
} from '../../engine/parcels/negotiation.ts'
import type { Taking } from '../../engine/parcels/takings.ts'
import type { CorridorParcel } from '../../engine/types.ts'
import { isTapped, wouldReceive } from '../../engine/turn/corridor.ts'
import { money, acres, plural } from '../format.ts'

interface Props {
  game: GameState
  corridor: Corridor
  onOfferAll: (multiple: number, archetype?: ParcelArchetype) => void
  onSetOffer: (parcelId: string, multiple: number) => void
  onCondemn: (parcelId: string) => void
  onAbandon: (corridorId: string) => void
  onHoverParcel: (id: string | null) => void
}

interface Row { deal: ParcelDeal; parcel: CorridorParcel; taking: Taking }

const STATUS: Record<ParcelDeal['status'], string> = {
  pending: 'No offer yet', offered: 'Offer sent', accepted: 'Signed', holdout: 'Refused',
  condemning: 'In court', condemned: 'Condemned', blocked: 'Protected',
}

const settled = (r: Row): boolean => r.deal.status === 'accepted' || r.deal.status === 'condemned'
const open = (r: Row): boolean => ['pending', 'offered', 'holdout'].includes(r.deal.status)
const START_OFFER: Record<ParcelArchetype, number> = {
  timber: 1.1, industrial: 1.4, public: 1.3, 'row-crop': 1.6, homestead: 2.2, church: 3, historic: 1,
}

const GROUP_ORDER: ParcelArchetype[] = [
  'row-crop', 'timber', 'homestead', 'industrial', 'public', 'church', 'historic',
]

export function LandPanel({
  game, corridor, onOfferAll, onSetOffer, onCondemn, onAbandon, onHoverParcel,
}: Props) {
  const [offers, setOffers] = useState<Record<string, number>>({})
  const [showAll, setShowAll] = useState(false)
  useEffect(() => () => onHoverParcel(null), [onHoverParcel])
  useEffect(() => { setOffers({}) }, [game.quarter])

  const rows: Row[] = Object.entries(corridor.deals).map(([id, deal]) => ({
    deal, parcel: corridor.parcels[id], taking: corridor.takings[id],
  })).filter((r) => r.parcel && r.taking)

  const groups = GROUP_ORDER.filter((a) => rows.some((r) => r.parcel.archetype === a)).map((a) => {
    const of = rows.filter((r) => r.parcel.archetype === a)
    return { archetype: a, rows: of, open: of.filter(open), done: of.filter(settled).length }
  })

  const done = rows.filter(settled).length
  const blocked = rows.filter((r) => r.deal.status === 'blocked').length
  const waiting = rows.filter((r) => r.deal.status === 'offered').length
  const best = highestMultiplePaid(corridor)
  const attention = rows
    .filter((r) => r.deal.status === 'holdout' || r.deal.status === 'condemning' || r.deal.status === 'blocked')
  const list = (showAll ? rows : attention)
    .slice().sort((a, b) => b.taking.appraisedTotal - a.taking.appraisedTotal)

  return (
    <div className="land">
      <div className="progress">
        <span className="track"><span style={{ width: `${(done / Math.max(1, rows.length)) * 100}%` }} /></span>
        <span className="acq-count">{done} of {rows.length} settled</span>
      </div>
      <dl className="rows">
        <div><dt>Paid</dt><dd>{money(corridor.rowPaid)}</dd></div>
        {best > 0 && <div><dt>Going rate</dt><dd>{best.toFixed(2)}× appraisal</dd></div>}
        {corridor.condemnations > 0 && <div><dt>Condemned</dt><dd className="tone-bad">{corridor.condemnations}</dd></div>}
        {corridor.legalCosts > 0 && <div><dt>Legal fees</dt><dd>{money(corridor.legalCosts)}</dd></div>}
      </dl>
      {blocked > 0 && (
        <p className="note tone-bad">
          {plural(blocked, 'parcel')} cannot be acquired. Abandon this route and draw another.
        </p>
      )}
      {rows.length === 0 && <p className="note">This route stays on land you own. Construction starts next quarter.</p>}
      {waiting > 0 && <p className="note">{plural(waiting, 'offer')} out. Owners answer when the quarter ends.</p>}

      {corridor.status === 'acquiring' && groups.some((g) => g.open.length > 0) && (
        <>
          <h3>Offer by group</h3>
          <ul className="groups">
            {groups.filter((g) => g.open.length > 0).map((g) => {
              const sent = g.open.filter((r) => r.deal.status === 'offered')
              const sentAt = sent.length > 0 ? Math.max(...sent.map((r) => r.deal.offerMultiple)) : 0
              const refusals = g.open.map((r) => r.deal.refusedAt).filter((v) => v > 0)
              const start = refusals.length > 0
                ? Math.min(MAX_OFFER, Math.max(START_OFFER[g.archetype], Math.min(...refusals) + 0.4))
                : START_OFFER[g.archetype]
              const m = offers[g.archetype] ?? (sentAt || start)
              const ctx = negotiationContext(game, corridor, g.rows[0].parcel.countyFips)
              const get = g.open.filter((r) => wouldReceive(r.deal, m))
              const expect = get.reduce((n, r) => n + acceptanceProbability(r.parcel, r.taking, r.deal, ctx, m), 0)
              const cost = get.reduce((n, r) => n + r.taking.appraisedTotal * m, 0)
              const same = get.length > 0 && get.every(
                (r) => r.deal.status === 'offered' && Math.abs(r.deal.offerMultiple - m) < 1e-9)
              return (
                <li key={g.archetype} className="group">
                  <div className="line-head">
                    <span>{ARCHETYPE_LABEL[g.archetype]}</span>
                    <span className="note">{g.open.length} open of {g.rows.length}</span>
                  </div>
                  <div className="row">
                    <input type="range" min={1} max={MAX_OFFER} step={0.05} value={m}
                      aria-label={`Offer to ${ARCHETYPE_LABEL[g.archetype]} owners, times appraisal`}
                      onChange={(e) => setOffers({ ...offers, [g.archetype]: Number(e.target.value) })} />
                    <span className="num">{m.toFixed(2)}×</span>
                    <button className="btn small" disabled={get.length === 0 || same}
                      onClick={() => onOfferAll(m, g.archetype)}>
                      {same ? 'Sent' : sent.length > 0 ? 'Change' : 'Send'}
                    </button>
                  </div>
                  {sent.length > 0 && (
                    <div className="sent">
                      {plural(sent.length, 'offer')} out at {sentAt.toFixed(2)}×. Answers come when the quarter ends.
                    </div>
                  )}
                  <div className="note">
                    {get.length === 0
                      ? 'All of them have refused this much. Raise it, or settle them one by one below.'
                      : `Goes to ${get.length}. ${expect < 0.5 ? 'Few would sign' : `About ${Math.round(expect)} would sign`}. Up to ${money(cost)}.`}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {rows.length > 0 && <div className="line-head">
        <h3>{showAll ? 'All parcels' : 'Needs attention'}</h3>
        <button className="btn small" onClick={() => setShowAll((v) => !v)} aria-pressed={showAll}>
          {showAll ? 'Show problems only' : `Show all ${rows.length}`}
        </button>
      </div>}
      {rows.length > 0 && list.length === 0 && <p className="note">No refusals so far.</p>}
      <ul className="parcels">
        {list.map(({ deal, parcel, taking }) => {
          const ctx = negotiationContext(game, corridor, parcel.countyFips)
          const next = Math.min(MAX_OFFER, Math.max(deal.offerMultiple, deal.refusedAt) + 0.5)
          return (
            <li key={parcel.id} className={`parcel is-${deal.status}`}
              onMouseEnter={() => onHoverParcel(parcel.id)} onMouseLeave={() => onHoverParcel(null)}>
              <div className="line-head">
                <span className="owner">{parcel.owner}</span>
                <span className={`parcel-status s-${deal.status}`}>{STATUS[deal.status]}</span>
              </div>
              <div className="note">
                {ARCHETYPE_LABEL[parcel.archetype]}, {acres(taking.takenAcres)} of {acres(parcel.acres)}
                {taking.severed && ', cut in two'}
              </div>
              <div className="note">
                {deal.status === 'accepted' || deal.status === 'condemned'
                  ? `Paid ${money(deal.paid)}`
                  : `Appraised ${money(taking.appraisedTotal)}${
                      deal.status === 'offered' ? `, offered ${money(offerAmount(taking, deal))}` : ''}${
                      deal.refusedAt > 0 ? `, refused ${deal.refusedAt.toFixed(2)}×` : ''}`}
              </div>
              {deal.status === 'condemning' && (
                <div className="note">{plural(deal.condemnationQuarters, 'quarter')} left in court</div>
              )}
              {(deal.status === 'holdout' || deal.status === 'pending') && (
                <div className="row">
                  {deal.refusedAt < MAX_OFFER ? (
                    <button className="btn small" onClick={() => onSetOffer(parcel.id, next)}>
                      Offer {next.toFixed(2)}×, {Math.round(acceptanceProbability(parcel, taking, deal, ctx, next) * 100)}% likely
                    </button>
                  ) : <span className="note">Refused the highest offer.</span>}
                  <button className="btn small danger" onClick={() => onCondemn(parcel.id)}>
                    Condemn, {money(condemnationLegalCost(taking))} and -{condemnationApprovalCost(parcel)} approval
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {corridor.status === 'acquiring' && !isTapped(game, corridor.id) && (
        <button className="btn danger wide" onClick={() => onAbandon(corridor.id)}>Abandon this route</button>
      )}
    </div>
  )
}
