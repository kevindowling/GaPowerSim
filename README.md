# GaPowerSim

A simulation game about building power generation and transmission for Georgia's
data center boom, played on the real map of Georgia.

It's 2026. AI data centers are landing across the state faster than the grid can
absorb them. The deal sounds easy — the data centers front the budget — until you
discover that every plant lands in somebody's county, and every megawatt has to
travel down a corridor of poles that crosses somebody's land. When a landowner
says no, your only tools are more money, a longer route, or eminent domain. Then
the power has to actually stay on.

**Status: M5 — the Americus tutorial is finished and playable end to end.**
Nine beats from signing the contract to the scorecard: site generation, route a
corridor across real property, fight the people who say no, answer to the county
commission, energize, and then hold it together when the storm arrives. See
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
no AI-generated imagery. The map is drawn from data; plant, data-centre and
transmission glyphs are vector paths from [Material Design
Icons](https://github.com/Templarian/MaterialDesign) (Pictogrammers, Apache-2.0),
of which only the eight the game draws are vendored — see
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). The favicon is hand-written SVG.

### The map data

| Dataset | Source | Real? |
|---|---|---|
| County boundaries | US Census cartographic boundaries, via the `us-atlas` npm package | Yes |
| Physiographic terrain | Georgia's actual provinces, split on the real Fall Line through Columbus–Macon–Augusta | Yes |
| Population / land value | Modelled from the city list in `src/data/cities.ts` | Approximate |
| Protected land, hydrology | — | **Missing** |
| Land parcels | — | **Not yet fetched** (see below) |

### Why route shape matters

A corridor does not buy whole properties. It buys a strip across them, and what
is owed is the value of that strip plus the damage done to what is left. That
second part is computed from the actual geometry of the remainder, which makes
the *shape* of a route matter and not just its length:

| | acres taken | severed | appraised |
|---|---|---|---|
| Quarles Planting Co. | 5 of 158 | no | $30K |
| Nesmith Pecan Co. | 13 of 213 | **cut in two** | **$206K** |

Roughly 2.6× the acreage and 7× the compensation, entirely because of where the
line fell. Hugging a property line is a real strategy the real map rewards.

Saying no has three answers and all of them cost. Pay more, and every remaining
holdout hears about the comparable. Condemn, and you spend quarters in court,
legal fees, county approval — and every remaining owner on that corridor gets
harder to deal with. Reroute, and the line gets longer across worse ground.

### Then it has to stay on

Energizing switches the game from quarters to fifteen-minute intervals. Two very
different customers share one wire: a data centre that draws the same power at
4am in February as at 5pm in August, and a county whose demand doubles on a
summer evening — which is exactly when thermal plants are derated and the margin
is thinnest.

Plants trip. Storms cross the map and put structures on the ground. Crews are
limited, so a downed line gets them before a tripped turbine. And the choice made
back at routing time finally settles up:

| | rating | one circuit lost | campus |
|---|---|---|---|
| 230 kV single circuit | 400 MW | 0 MW | **dark** |
| 230 kV double circuit | 800 MW | 400 MW | still up |

Redundancy costs half again as much, looks like waste for years, and is invisible
right up until the night it isn't.

When there genuinely isn't enough, someone gets curtailed, and the game makes you
say in advance who. Protecting the contract keeps the campus whole and turns the
lights off in Sumter County. Protecting homes means eating the penalties. There
is no option that costs nothing.

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
county, strips owner PII at ingest, and vendors the result into
`public/data/parcels/`. That fetch is a **developer action, run once** — a player
never touches a county server.

Two ways to run it:

```bash
# If you have the county's FeatureServer URL (set it in scripts/fetch-parcels.ts)
npm run fetch:parcels -- --county 13261

# Or download the layer from the county's portal as GeoJSON and point at it.
# This needs no network access at all.
npm run fetch:parcels -- --county 13261 --file ~/Downloads/Parcels.geojson
```

Owner *names* are synthesized rather than real. Georgia parcel ownership is
public record, but naming identifiable private individuals at their home address
inside a public web game about seizing their property is a different act from
mapping their lot, and the puzzle loses nothing by generating them. Real
boundaries, real acreage, real assessed values; invented people. Institutional
owners stay real where they carry meaning.

> **Environment note:** the sandbox this was developed in blocks egress to
> census.gov, ArcGIS, qPublic and the Georgia state clearinghouse — all four
> return HTTP 403 policy denials — so the real parcel fetch could not be run
> here, and the committed Sumter cadastre is the generated stand-in. County
> boundaries were sourced from npm for the same reason. Use the `--file` form
> above, or run the fetch from an unrestricted network.

## Milestones

- [x] **M0** Scaffold, geo pipeline, statewide map with pan/zoom and hex LOD
- [x] **M1** Turn loop, Americus 400 MW contract, plant siting, budget
- [x] **M2** Parcel pipeline, corridor takings, severance damage, eminent domain
- [x] **M3** Energization, real-time dispatch, power flow, unserved energy
- [x] **M4** Reliability: forced outages, storms, line breaks, cascades
- [x] **M5** Tutorial script, scoring, embed polish
- [ ] **M6** Real-world data accuracy pass
- [ ] **M7** Campaign: adjacency unlock, cumulative grid, scenario 2+

## The tutorial

Nine beats, each gated on the previous one, and each taught by consequence
rather than by tooltip. The player is never told "solar will not work" — they are
shown firm capacity next to nameplate and allowed to find out. They are never
told "buy the second circuit" — they are offered it, and six beats later a storm
arrives.

1. **The deal** — 400 MW, a hard date, and a penalty for every quarter you miss it
2. **Something has to make it** — firm capacity, not nameplate
3. **Something has to carry it** — a plant with nowhere to send its output serves nobody
4. **Somebody owns all of it** — every parcel under the line has an owner
5. **And somebody will say no** — pay, condemn, or reroute; there is no fourth option
6. **Sumter County has questions** — who pays for the upgrades, with no free answer
7. **Energize** — the game stops being about deadlines
8. **Now keep it on** — flat campus load stacked on a county that peaks in the heat
9. **The night it matters** — the storm, and the voltage class you picked in beat 3

A beat completes because the player did the thing, never because they clicked
past a dialog — the beat system only reads game state. The coach can be
dismissed permanently at any point.

The debrief scores five separate currencies rather than one number, because the
argument the game is making is that they trade against each other. Land taken by
force is scored apart from county approval on purpose: a county can forgive you,
and the record still exists. The headline says the uncomfortable part out loud —
"You met every date, and the people of Sumter County sat in the dark to make it
happen" is a more honest summary of some runs than 83/100.

## Controls

Drag to pan · scroll to zoom · arrow keys to move · <kbd>+</kbd>/<kbd>-</kbd> to
zoom · <kbd>0</kbd> to reset the view.
