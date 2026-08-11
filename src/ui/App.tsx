import { useEffect, useState, useCallback } from 'react'
import { loadMapData } from '../data/loadMapData.ts'
import type { MapData } from '../engine/geo/mapTypes.ts'
import { MapView, type CellReadout } from './MapView.tsx'
import type { Overlay } from '../render/mapRenderer.ts'

const TERRAIN_NAMES: Record<number, string> = {
  0: 'Outside Georgia',
  1: 'Coastal Plain',
  2: 'Piedmont',
  3: 'Blue Ridge',
  4: 'Valley and Ridge',
  5: 'Appalachian Plateau',
  6: 'Coastal Marsh',
}

const OVERLAYS: Array<{ id: Overlay; label: string }> = [
  { id: 'none', label: 'Terrain' },
  { id: 'population', label: 'People' },
  { id: 'landValue', label: 'Land value' },
]

export function App({ embedded = false }: { embedded?: boolean }) {
  const [data, setData] = useState<MapData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<Overlay>('none')
  const [showHexes, setShowHexes] = useState(true)
  const [hoverName, setHoverName] = useState<string | null>(null)
  const [hoverCell, setHoverCell] = useState<CellReadout | null>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    let cancelled = false
    loadMapData()
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [])

  const handleHover = useCallback((name: string | null, cell: CellReadout | null) => {
    setHoverName(name)
    setHoverCell(cell)
  }, [])

  if (error) {
    return (
      <div className="fill center">
        <div className="notice">
          <h2>Could not load map data</h2>
          <p className="mono">{error}</p>
          <p>Run <code>npm run data</code> to regenerate <code>public/data/</code>.</p>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="fill center">
        <div className="loading">
          <div className="loading-bar"><span /></div>
          <p>Loading Georgia…</p>
        </div>
      </div>
    )
  }

  const inState = data.grid.manifest.inStateCells
  const areaKm2 = Math.round(inState * data.grid.manifest.hexAreaKm2)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>GaPowerSim</strong>
          <span className="sub">Georgia Power · 2026</span>
        </div>

        <div className="controls">
          <div className="seg" role="group" aria-label="Map overlay">
            {OVERLAYS.map((o) => (
              <button
                key={o.id}
                className={overlay === o.id ? 'seg-btn on' : 'seg-btn'}
                onClick={() => setOverlay(o.id)}
                aria-pressed={overlay === o.id}
              >
                {o.label}
              </button>
            ))}
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={showHexes}
              onChange={(e) => setShowHexes(e.target.checked)}
            />
            Grid
          </label>
        </div>
      </header>

      <main className="stage">
        <MapView
          data={data}
          overlay={overlay}
          showHexes={showHexes}
          onHoverCounty={handleHover}
          onScaleChange={setScale}
        />

        <div className="readout" aria-live="polite">
          {hoverName ? (
            <>
              <div className="readout-title">{hoverName} County</div>
              {hoverCell && (
                <dl className="readout-grid">
                  <dt>Terrain</dt>
                  <dd>{TERRAIN_NAMES[hoverCell.terrain] ?? '—'}</dd>
                  <dt>Land</dt>
                  <dd>${hoverCell.landValue.toLocaleString()}/acre</dd>
                  <dt>Density</dt>
                  <dd>{Math.round((hoverCell.population / 255) * 100)}%</dd>
                </dl>
              )}
            </>
          ) : (
            <div className="readout-hint">
              Drag to pan · scroll to zoom · <kbd>0</kbd> to reset
            </div>
          )}
        </div>

        <div className="scalebar">
          <ScaleBar pxPerKm={scale} />
        </div>
      </main>

      {!embedded && (
        <footer className="statusbar">
          <span>{data.counties.counties.length} counties</span>
          <span>{inState.toLocaleString()} cells · {areaKm2.toLocaleString()} km²</span>
          <span className="muted">M0 · map foundation</span>
        </footer>
      )}
    </div>
  )
}

/** A scale bar that snaps to a round distance near 120 px wide. */
function ScaleBar({ pxPerKm }: { pxPerKm: number }) {
  const targetPx = 120
  const rawKm = targetPx / Math.max(pxPerKm, 1e-6)
  const pow = 10 ** Math.floor(Math.log10(rawKm))
  const nice = [1, 2, 5, 10].map((m) => m * pow).find((v) => v >= rawKm) ?? 10 * pow
  const widthPx = nice * pxPerKm
  const label = nice >= 1 ? `${nice} km` : `${Math.round(nice * 1000)} m`
  return (
    <div className="scalebar-inner" style={{ width: `${widthPx}px` }}>
      <span>{label}</span>
    </div>
  )
}
