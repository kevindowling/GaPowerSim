import type { ReactNode } from 'react'

export type SheetTab = 'build' | 'grid' | 'deal' | 'ops' | 'log'

export interface SheetTabDef {
  id: SheetTab
  label: string
  /** Small count or status shown on the tab, e.g. outstanding parcels. */
  badge?: string | number
  /** Draws attention when something needs the player. */
  urgent?: boolean
}

interface Props {
  tabs: readonly SheetTabDef[]
  active: SheetTab
  open: boolean
  onSelect: (tab: SheetTab) => void
  onToggle: () => void
  children: ReactNode
}

/**
 * The mobile panel surface.
 *
 * On a phone the map has to be the screen — a corridor is drawn by touching two
 * points on it, and you cannot aim at a 73 px stripe. So the panels move into a
 * sheet that sits over the bottom of the map and collapses to just its tab bar,
 * which is the only piece that is always on screen.
 *
 * Tapping the active tab collapses the sheet, so getting back to a full-height
 * map is always one touch away from wherever you are.
 */
export function MobileSheet({ tabs, active, open, onSelect, onToggle, children }: Props) {
  return (
    <div className={open ? 'sheet open' : 'sheet'}>
      <div className="sheet-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            aria-expanded={active === t.id ? open : undefined}
            className={
              (active === t.id ? 'sheet-tab on' : 'sheet-tab') + (t.urgent ? ' urgent' : '')
            }
            onClick={() => (active === t.id ? onToggle() : onSelect(t.id))}
          >
            <span className="sheet-tab-label">{t.label}</span>
            {t.badge !== undefined && t.badge !== '' && (
              <span className="sheet-badge">{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      <div className="sheet-body" role="tabpanel" aria-hidden={!open}>
        <button
          className="sheet-grip"
          onClick={onToggle}
          aria-label={open ? 'Collapse panel' : 'Expand panel'}
        >
          <span />
        </button>
        <div className="sheet-scroll">{children}</div>
      </div>
    </div>
  )
}
