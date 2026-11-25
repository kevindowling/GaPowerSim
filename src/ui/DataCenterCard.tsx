import type { ReactNode } from 'react'
import type { DataCenter } from '../data/dataCenters.ts'
import { mw } from './format.ts'

export const STATUS_TEXT: Record<string, string> = {
  proposed: 'Proposed', rezoning: 'In rezoning', approved: 'Approved', 'under construction': 'Under construction',
  operating: 'Operating', withdrawn: 'Withdrawn', denied: 'Denied', 'on hold': 'On hold',
}

const PRECISION: Record<string, string> = {
  parcel: 'the parcel', address: 'the street address', site: 'the site', road: 'a road nearby',
  city: 'the city only', county: 'the county only', unknown: 'not known',
}

/** A reported data center. */
export function DataCenterCard({ dc, children }: { dc: DataCenter; children?: ReactNode }) {
  return (
    <>
      <dl className="rows">
        <div><dt>Asking for</dt><dd>{dc.mw === null ? 'Not published' : mw(dc.mw)}</dd></div>
        <div><dt>Status</dt><dd>{STATUS_TEXT[dc.status] ?? dc.status}</dd></div>
        <div><dt>Developer</dt><dd>{dc.developer ?? 'Not published'}</dd></div>
        <div><dt>County</dt><dd>{dc.county ? `${dc.county.replace(/ County$/, '')}, ${dc.state}` : dc.state}</dd></div>
        <div><dt>Utility</dt><dd>{dc.utility && dc.utility !== 'unknown' ? dc.utility : 'Not published'}</dd></div>
        {dc.target && <div><dt>In service</dt><dd>{dc.target}</dd></div>}
        <div><dt>Location is</dt><dd>{PRECISION[dc.precision] ?? dc.precision}</dd></div>
      </dl>
      {dc.mwNote && <p className="note">{dc.mwNote}</p>}
      {children}
      {dc.where && <p className="fine">Location from <a href={dc.where.url} target="_blank" rel="noreferrer noopener">{dc.where.title}</a>.</p>}
      {dc.sources.length > 0 && (
        <ul className="sources fine">
          {dc.sources.map((s) => (
            <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer noopener">{s.title}</a>{s.date && `, ${s.date}`}</li>
          ))}
        </ul>
      )}
    </>
  )
}
