# GaPowerSim

A simulation game about building power generation and transmission for Georgia's
data center boom, played on the real map of Georgia.

It's 2026. AI data centers are landing across the state faster than the grid can
absorb them. The deal sounds easy — the data centers front the budget — until you
discover that every plant lands in somebody's county, and every megawatt has to
travel down a corridor of poles that crosses somebody's land. When a landowner
says no, your only tools are more money, a longer route, or eminent domain. Then
the power has to actually stay on.

**Status: M0 — map foundation.** The real map of Georgia renders and is
explorable. The game systems on top of it are in progress; see
[Milestones](#milestones).

## Quick start

```bash
npm install
npm run data      # regenerate public/data/ from source (already committed)
npm run dev       # http://localhost:5173
```

```bash
npm run build     # typecheck + static build into dist/
npm test          # engine unit tests (vitest)
npm run test:e2e  # browser smoke tests (playwright)
```

## Embedding

The build is a self-contained static site with no backend and no external
requests. Deploy `dist/` anywhere and drop one tag into the host page:

```html
<iframe
  src="https://your-host.example/gapowersim/embed.html"
  width="100%"
  height="720"
  style="border:0"
  loading="lazy"
  title="GaPowerSim"
></iframe>
```

`embed.html` is the chrome-free variant — it drops the status bar so the host
page supplies the surrounding furniture. `index.html` is the standalone page.

Asset URLs are all relative, so the build works at any path. Styles are scoped
under `#root` and cannot leak into the host page, and the map captures wheel
events over the canvas so zooming doesn't scroll the host out from under it.

## How it's built

```
scripts/          build-time data pipeline (run by developers, not players)
src/engine/       pure TypeScript simulation — no DOM, no React, deterministic
src/render/       Canvas 2D map renderer, camera, palette
src/ui/           React shell
src/data/         curated real-world datasets
public/data/      generated + vendored map data, committed to the repo
tests/            vitest (engine) and playwright (browser)
```

`src/engine` never imports the DOM or React. All simulation state lives there,
runs off a seeded PRNG, and is unit-testable headlessly. The renderer and UI read
engine state; they never own it.

### Rendering

Georgia is ~152,000 hex cells. Drawing them as polygons at statewide zoom would
be pointless as well as slow — each cell would be under a pixel — so terrain is
baked once into a 414×556 raster and blitted as one image, county outlines draw
as vectors on top, and real hexagons only appear once a cell is large enough on
screen to be worth seeing.

All visuals are vector or data-driven. There is no bitmap art in this project and
no generated imagery; the favicon is hand-written SVG.

### The map data

| Dataset | Source | Real? |
|---|---|---|
| County boundaries | US Census cartographic boundaries, via the `us-atlas` npm package | Yes |
| Physiographic terrain | Georgia's actual provinces, split on the real Fall Line through Columbus–Macon–Augusta | Yes |
| Population / land value | Modelled from the city list in `src/data/cities.ts` | Approximate |
| Protected land, hydrology | — | **Missing** |
| Land parcels | — | **Not yet fetched** (see below) |

Two independent checks confirm the geometry pipeline: the rasterised state comes
out at 152,666 km² against Georgia's actual 153,910 km² land area (0.8%), and the
projection reproduces true spherical area to within 0.1%, which is what makes
parcel acreage arithmetic trustworthy later.

`npm run verify:data` re-runs those checks and reports every record still
carrying unverified values, so "we haven't checked this yet" stays visible
instead of quietly becoming "this is true".

### Parcel data

The eminent-domain mechanic runs on real parcel geometry: a corridor centerline
buffered to right-of-way width, intersected against actual parcel polygons, so
takings are computed by real acreage — including partial takings and severance
damage, which is what makes the *shape* of a route matter and not just its
length.

Georgia has no free statewide parcel download; parcel data is county-by-county
through ArcGIS Hub and qPublic portals. `scripts/fetch-parcels.ts` pulls a
county, clips it to the scenario's study area, simplifies it, strips owner PII at
ingest, and vendors the result into `public/data/parcels/`. That fetch is a
**developer action, run once** — a player never touches a county server.

Owner *names* are synthesized rather than real. Georgia parcel ownership is
public record, but naming identifiable private individuals at their home address
inside a public web game about seizing their property is a different act from
mapping their lot, and the puzzle loses nothing by generating them. Real
boundaries, real acreage, real assessed values; invented people. Institutional
owners stay real where they carry meaning.

> **Environment note:** the sandbox this was developed in blocks egress to
> census.gov, ArcGIS and qPublic, so the parcel fetch has not been run here. The
> pipeline is written to be run from an unrestricted network, and county
> boundaries were sourced from npm instead for the same reason.

## Milestones

- [x] **M0** Scaffold, geo pipeline, statewide map with pan/zoom and hex LOD
- [ ] **M1** Turn loop, Americus 400 MW contract, plant siting, budget
- [ ] **M2** Parcel pipeline, corridor takings, severance damage, eminent domain
- [ ] **M3** Energization, real-time dispatch, power flow, unserved energy
- [ ] **M4** Reliability: forced outages, storms, line breaks, cascades
- [ ] **M5** Tutorial script, scoring, embed polish
- [ ] **M6** Real-world data accuracy pass
- [ ] **M7** Campaign: adjacency unlock, cumulative grid, scenario 2+

## Controls

Drag to pan · scroll to zoom · arrow keys to move · <kbd>+</kbd>/<kbd>-</kbd> to
zoom · <kbd>0</kbd> to reset the view.
