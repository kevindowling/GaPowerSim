import { useEffect, useState, useCallback, useMemo } from 'react'
import { useGame } from '../state/gameStore.ts'
import { MapView, type CellReadout } from './MapView.tsx'
import { HUD } from './HUD.tsx'
import { BriefingCard } from './BriefingCard.tsx'
import { BuildPanel } from './panels/BuildPanel.tsx'
import { ContractPanel } from './panels/ContractPanel.tsx'
import { CorridorPanel } from './panels/CorridorPanel.tsx'
import { AcquisitionPanel } from './panels/AcquisitionPanel.tsx'
import { LogPanel } from './panels/LogPanel.tsx'
import { DispatchPanel } from './panels/DispatchPanel.tsx'
import { TutorialCoach } from './TutorialCoach.tsx'
import { HearingDialog } from './HearingDialog.tsx'
import { ScoreScreen } from './ScoreScreen.tsx'
import { currentBeat } from '../engine/tutorial.ts'
import { useMediaQuery, MOBILE_QUERY } from './useMediaQuery.ts'
import { MobileSheet, type SheetTab, type SheetTabDef } from './MobileSheet.tsx'
import type {
  Marker, Overlay, SitingPreview, CorridorDraw, ParcelTint,
} from '../render/mapRenderer.ts'
import { corridorBuffer } from '../engine/geo/polygon.ts'
import { cellCenter } from '../engine/geo/hex.ts'
import { lineClass } from '../data/transmission.ts'
import type { IconKey } from '../render/icons.ts'
import { plantType, type PlantKind } from '../data/plants.ts'
import type { SiteAssessment } from '../engine/turn/siting.ts'
import { money, acres } from './format.ts'

/** Which vector glyph stands for each generation technology. */
const PLANT_ICON: Record<PlantKind, IconKey> = {
  'gas-ct': 'gasCt',
  'gas-ccgt': 'gasCcgt',
  solar: 'solar',
  battery: 'battery',
  'nuclear-uprate': 'nuclear',
}

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

/** Footprint radius in km for a plant's acreage, for the siting preview. */
function footprintRadiusKm(acresValue: number): number {
  const km2 = acresValue / 247.105
  return Math.sqrt(km2 / Math.PI)
}

export function App({ embedded = false }: { embedded?: boolean }) {
  const {
    mapData, loadError, game, scenario, tool, headlines, showBriefing, hoverCell: hoverCellIndex,
    parcels, parcelsLoading, parcelError, plan, selectedCorridor, hoverParcel,
    load, startScenario, accept, setTool, setHoverCell, setHoverParcel, placeAt, endQuarter,
    dismissHeadlines, currentAssessment, setLineClass, clearPlan, commitPlan,
    selectCorridor, offerAll, setOffer, condemnParcel, abandon, parcelById,
    alerts, setSpeed, setPolicy, setVegetationSpend, setMaintenanceDeferred, dismissAlerts,
    chooseHearing, dismissTutorial, finishDebrief,
  } = useGame()

  const [overlay, setOverlay] = useState<Overlay>('none')
  const [showHexes, setShowHexes] = useState(true)
  const [hoverName, setHoverName] = useState<string | null>(null)
  const [hoverCell, setHoverCellLocal] = useState<CellReadout | null>(null)
  const [scale, setScale] = useState(1)
  /** Set once, when the scenario opens, to bring the player to the site. */
  const [focus, setFocus] = useState<{ x: number; y: number; scale: number } | null>(null)

  const isMobile = useMediaQuery(MOBILE_QUERY)
  const [sheetTab, setSheetTab] = useState<SheetTab>('build')
  // Starts collapsed so the first thing a player sees is the map, not a panel.
  const [sheetOpen, setSheetOpen] = useState(false)

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (mapData && !game) startScenario('americus-400')
  }, [mapData, game, startScenario])

  // When the contract is signed, glide from the statewide view down to Sumter
  // County. Starting the player at 0.9 px/km with the campus as a single dot is
  // technically the whole state and practically useless.
  useEffect(() => {
    if (!game || !mapData || showBriefing || focus) return
    const spec = mapData.grid.spec
    const cell = game.contract.siteCell
    const row = Math.floor(cell / spec.cols)
    const [x, y] = cellCenter(spec, cell - row * spec.cols, row)
    setFocus({ x, y, scale: isMobile ? 16 : 26 })
  }, [game, mapData, showBriefing, focus, isMobile])

  const handleHover = useCallback(
    (name: string | null, cell: CellReadout | null, cellIndex: number) => {
      setHoverName(name)
      setHoverCellLocal(cell)
      setHoverCell(cellIndex)
    },
    [setHoverCell],
  )

  // Plants and the campus they serve.
  const markers = useMemo<Marker[]>(() => {
    if (!game) return []
    const out: Marker[] = [{
      cell: game.contract.siteCell,
      kind: 'datacenter',
      label: game.contract.name,
      icon: 'dataCenter',
    }]
    for (const p of game.plants) {
      const t = plantType(p.typeId)
      const total = p.status === 'permitting' ? t.permitQuarters : t.buildQuarters
      out.push({
        cell: p.cell,
        kind: p.status === 'online' ? 'plant-online'
          : p.status === 'construction' ? 'plant-construction'
          : 'plant-permitting',
        label: p.name,
        progress: total > 0 ? (total - p.quartersRemaining) / total : 0,
        icon: PLANT_ICON[p.typeId],
      })
    }
    return out
  }, [game])

  // Committed corridors plus the one being previewed.
  const corridorDraws = useMemo<CorridorDraw[]>(() => {
    const out: CorridorDraw[] = []
    for (const c of game?.corridors ?? []) {
      out.push({
        centerline: c.centerline,
        buffer: corridorBuffer(c.centerline, lineClass(c.classId).rowHalfWidthKm),
        status: c.status,
      })
    }
    if (plan) {
      out.push({ centerline: plan.centerline, buffer: plan.takings.buffer, status: 'planned' })
    }
    return out
  }, [game?.corridors, plan])

  // Colour every parcel the current corridor touches by where its deal stands.
  const parcelTints = useMemo<Record<string, ParcelTint>>(() => {
    const tints: Record<string, ParcelTint> = {}
    if (plan) {
      for (const t of plan.takings.takings) tints[t.parcelId] = t.severed ? 'severed' : 'taken'
    }
    const corridor = game?.corridors.find((c) => c.id === selectedCorridor)
    if (corridor) {
      for (const [id, deal] of Object.entries(corridor.deals)) {
        tints[id] = deal.status === 'accepted' ? 'accepted'
          : deal.status === 'condemned' || deal.status === 'condemning' ? 'condemned'
          : deal.status === 'blocked' ? 'blocked'
          : deal.status === 'holdout' ? 'holdout'
          : corridor.takings[id]?.severed ? 'severed' : 'taken'
      }
    }
    return tints
  }, [plan, game?.corridors, selectedCorridor])

  const activeCorridor = game?.corridors.find((c) => c.id === selectedCorridor) ?? null

  const assessment = currentAssessment()
  const siting = useMemo<SitingPreview | null>(() => {
    if (tool.kind !== 'site' || !assessment) return null
    return {
      cell: hoverCellIndex,
      ok: assessment.ok,
      radiusKm: footprintRadiusKm(plantType(tool.typeId).acres),
    }
  }, [tool, assessment, hoverCellIndex])

  if (loadError) {
    return (
      <div className="fill center">
        <div className="notice">
          <h2>Could not load map data</h2>
          <p className="mono">{loadError}</p>
          <p>Run <code>npm run data</code> to regenerate <code>public/data/</code>.</p>
        </div>
      </div>
    )
  }

  if (!mapData || !game || !scenario) {
    return (
      <div className="fill center">
        <div className="loading">
          <div className="loading-bar"><span /></div>
          <p>Loading Georgia…</p>
        </div>
      </div>
    )
  }

  // The panels, built once and placed either in the desktop sidebar or the
  // mobile sheet. Same components, two arrangements.
  const dispatchPanel = game.realtime && (
    <DispatchPanel
      game={game}
      rt={game.realtime}
      onSpeed={setSpeed}
      onPolicy={setPolicy}
      onVegetation={setVegetationSpend}
      onMaintenance={setMaintenanceDeferred}
    />
  )
  const buildPanel = <BuildPanel game={game} tool={tool} onSelect={setTool} />
  const corridorPanel = (
    <CorridorPanel
      game={game}
      tool={tool}
      plan={plan}
      parcelsLoading={parcelsLoading}
      parcelError={parcelError}
      syntheticParcels={parcels?.synthetic ?? false}
      selectedCorridor={selectedCorridor}
      onStartRoute={() => setTool({ kind: 'route', from: null, classId: '230' })}
      onSetClass={setLineClass}
      onCommit={commitPlan}
      onCancel={clearPlan}
      onSelectCorridor={selectCorridor}
    />
  )
  const acquisitionPanel = activeCorridor && activeCorridor.status !== 'energized' && (
    <AcquisitionPanel
      game={game}
      corridor={activeCorridor}
      parcelById={parcelById}
      onOfferAll={offerAll}
      onSetOffer={setOffer}
      onCondemn={condemnParcel}
      onAbandon={abandon}
      onHoverParcel={setHoverParcel}
    />
  )
  const contractPanel = <ContractPanel game={game} />

  // Unsettled parcels and live faults are the two things that need the player
  // back in a panel, so they get a badge on the tab rather than staying hidden.
  const outstanding = activeCorridor
    ? Object.values(activeCorridor.deals).filter(
        (d) => d.status !== 'accepted' && d.status !== 'condemned').length
    : 0
  const faults = game.realtime?.outages.length ?? 0

  const sheetTabs: SheetTabDef[] = [
    { id: 'build', label: 'Build' },
    {
      id: 'grid',
      label: 'Grid',
      badge: outstanding > 0 ? outstanding : undefined,
      urgent: outstanding > 0,
    },
    { id: 'deal', label: 'Deal' },
    ...(game.realtime
      ? [{
          id: 'ops' as const,
          label: 'Ops',
          badge: faults > 0 ? faults : undefined,
          urgent: faults > 0,
        }]
      : []),
    { id: 'log', label: 'Log' },
  ]

  const sheetContent = sheetTab === 'build' ? buildPanel
    : sheetTab === 'grid' ? <>{corridorPanel}{acquisitionPanel}</>
    : sheetTab === 'deal' ? contractPanel
    : sheetTab === 'ops' ? dispatchPanel
    : <LogPanel log={game.log} />

  return (
    <div className={`app${isMobile ? ' mobile' : ''}${isMobile && sheetOpen ? ' sheet-open' : ''}`}>
      <HUD game={game} onEndQuarter={endQuarter} busy={showBriefing} compact={isMobile} />

      <div className="body">
        <main className="stage">
          <MapView
            data={mapData}
            overlay={overlay}
            showHexes={showHexes}
            markers={markers}
            siting={siting}
            placing={tool.kind === 'site' || tool.kind === 'route'}
            parcels={parcels?.parcels}
            parcelTints={parcelTints}
            corridors={corridorDraws}
            hoverParcel={hoverParcel}
            storms={game.realtime?.storms}
            focus={focus}
            onHoverCounty={handleHover}
            onClickCell={placeAt}
            onScaleChange={setScale}
          />

          <div className="map-controls">
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
              <input type="checkbox" checked={showHexes} onChange={(e) => setShowHexes(e.target.checked)} />
              Grid
            </label>
          </div>

          <div
            className={tool.kind === 'site' && assessment ? 'readout siting' : 'readout'}
            aria-live="polite"
          >
            {tool.kind === 'site' && assessment ? (
              <SiteReadout assessment={assessment} typeId={tool.typeId} />
            ) : hoverName ? (
              <>
                <div className="readout-title">{hoverName} County</div>
                {hoverCell && (
                  <dl className="readout-grid">
                    <dt>Terrain</dt><dd>{TERRAIN_NAMES[hoverCell.terrain] ?? '—'}</dd>
                    <dt>Land</dt><dd>${hoverCell.landValue.toLocaleString()}/acre</dd>
                    <dt>Density</dt><dd>{Math.round((hoverCell.population / 255) * 100)}%</dd>
                  </dl>
                )}
              </>
            ) : (
              <div className="readout-hint">
                Drag to pan · scroll to zoom · <kbd>0</kbd> to reset
              </div>
            )}
          </div>

          <div className="scalebar"><ScaleBar pxPerKm={scale} /></div>

        {isMobile && (
          <MobileSheet
            tabs={sheetTabs}
            active={sheetTab}
            open={sheetOpen}
            onSelect={(t) => { setSheetTab(t); setSheetOpen(true) }}
            onToggle={() => setSheetOpen((v) => !v)}
          >
            {sheetContent}
          </MobileSheet>
        )}
        </main>

        {!isMobile && (
          <aside className="sidebar">
            {dispatchPanel}
            {buildPanel}
            {corridorPanel}
            {acquisitionPanel}
            {contractPanel}
          </aside>
        )}
      </div>

      {!embedded && !isMobile && <LogPanel log={game.log} />}

      {!showBriefing && !game.outcome && (
        <TutorialCoach game={game} onDismiss={dismissTutorial} />
      )}

      {showBriefing && <BriefingCard scenario={scenario} onAccept={accept} />}

      {!showBriefing && currentBeat(game)?.id === 'hearing' && (
        <HearingDialog game={game} onChoose={chooseHearing} />
      )}

      {game.outcome && !game.tutorial?.debriefSeen && (
        <ScoreScreen game={game} outcome={game.outcome} onContinue={finishDebrief} />
      )}

      {alerts.length > 0 && (
        <div className="alert-stack" role="status" aria-live="assertive">
          <div className="alert-head">
            <strong>Grid alerts</strong>
            <button className="btn-link" onClick={dismissAlerts}>Dismiss</button>
          </div>
          <ul>{alerts.slice(0, 6).map((a, i) => <li key={i}>{a}</li>)}</ul>
        </div>
      )}

      {headlines.length > 0 && (
        <div className="overlay soft" onClick={dismissHeadlines}>
          <div className="headlines" role="dialog" aria-modal="true">
            <h2>This quarter</h2>
            <ul>{headlines.map((h, i) => <li key={i}>{h}</li>)}</ul>
            <button className="btn-primary" onClick={dismissHeadlines}>Continue</button>
          </div>
        </div>
      )}
    </div>
  )
}

/** What siting here would actually cost, shown before the click that commits it. */
function SiteReadout({
  assessment, typeId,
}: {
  assessment: SiteAssessment
  typeId: PlantKind
}) {
  const t = plantType(typeId)
  if (!assessment.ok) {
    return (
      <>
        <div className="readout-title tone-bad">Cannot site here</div>
        <p className="readout-blocker">{assessment.blocker}</p>
      </>
    )
  }
  return (
    <>
      <div className="readout-title">{assessment.countyName} County</div>
      <dl className="readout-grid">
        <dt>Land</dt><dd>{money(assessment.landCost)}</dd>
        <dt>Footprint</dt><dd>{acres(t.acres)}</dd>
        <dt>Approval</dt><dd className="tone-bad">−{Math.round(assessment.approvalCost)}</dd>
      </dl>
      {assessment.notes.map((n, i) => <p key={i} className="readout-note">{n}</p>)}
    </>
  )
}

/** A scale bar that snaps to a round distance near 120 px wide. */
function ScaleBar({ pxPerKm }: { pxPerKm: number }) {
  const targetPx = 120
  const rawKm = targetPx / Math.max(pxPerKm, 1e-6)
  const pow = 10 ** Math.floor(Math.log10(rawKm))
  const nice = [1, 2, 5, 10].map((m) => m * pow).find((v) => v >= rawKm) ?? 10 * pow
  const label = nice >= 1 ? `${nice} km` : `${Math.round(nice * 1000)} m`
  return (
    <div className="scalebar-inner" style={{ width: `${nice * pxPerKm}px` }}>
      <span>{label}</span>
    </div>
  )
}
