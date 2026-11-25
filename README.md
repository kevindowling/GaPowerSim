# GaPowerSim

You are Georgia Power. You start with your own money and the data centers it
already supplies. Build plants, lines and substations to reach the ones that are
waiting, and sign new ones. Liberty, outside Americus, comes with a guide and an
hour-by-hour operating year. Your balance at the end of 2034 is your score.

The map is real: county lines, rivers, streets, rail, buildings, parks and the
existing transmission grid. Land parcels, owners and the contract terms are
generated.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm test           # engine tests
npm run test:e2e   # browser tests
npm run build      # typecheck and build to dist/
```

Games save in the browser. Each game has a random seed, shown in the menu. Open
`/?seed=123` to replay one.

## How it plays

Build phase, one quarter at a time:

- Site plants. Towns, water, parks and occupied land are refused. Combined-cycle
  plants need a river or lake, or a pipeline to one.
- Plan a line between your plant, the substation and the campus. Pick a voltage
  and a route style, and click the map to bend the route.
- Sign other data centers from the Customers tab. Each has its own phases,
  payments and approval. They share your cash and Georgia Power's spare power.
- Build substations, on an existing line or on their own.
- Order transformers. A line serves the campus only through one of its own
  voltage. Substations and existing lines can be upgraded too.
- Tap an existing line of 115 kV or more, or one of your own. Existing lines have
  limited room, need a station, and deliver to the local substation.
- Click a plant, a line, the campus or the substation to see its status.
- Buy easements. Every owner has a hidden price. Paying a lot raises the going
  rate, and condemning raises everyone's price. A few owners never sell.
- Answer the county commission and the decisions that come up.
- The developer pays on signing, and again when each phase's power arrives. A late
  payment loses 10% a quarter.
- Keep cash above the credit limit. If it runs out, or you are nine quarters
  late, the game ends.
- The data center has an approval rating. If it is below 25 when a build quarter
  ends, the data center is cancelled and the rest of the funding is never paid.
  Some events raise or lower it without asking you. Counties bordering its own
  have ratings too, and their opinion can spread to it. No other county has one.
- The data center turns on one phase at a time, as firm power reaches it, and
  pays for the phases that are on. Americus has four of 100 MW. The operating
  year starts with all of them on.
- Click Power at Data Center Campus to see what will arrive, by quarter.

Operating year, in fifteen-minute steps:

- Every phase is drawing power. Homes peak on summer evenings.
- Imports are limited and shrink in hot weather. Batteries hold four hours.
- Plants trip, storms take lines down, and crews fix them.
- When power runs short, your policy decides whether homes or the campus lose it.

Your balance at the end is your score.

After the first data center's year you can carry on supplying the others to the
end of 2034.

## Code

```
src/engine/   simulation, no DOM, seeded random numbers
src/render/   canvas map
src/ui/       React interface
src/data/     scenarios, plants, line types, loaders
scripts/      data pipeline
public/data/  generated map data, committed
tests/        vitest and playwright
```

The grid is a transport model: max flow over line ratings, dispatched in cost
order (`src/engine/realtime/network.ts`, `dispatch.ts`). It does not solve power
flow. Routing is A* on a 60 m grid built from parcels, buildings, water and
existing lines (`src/engine/geo/fineRoute.ts`).

## Map data

| Data | Source |
|---|---|
| Counties | US Census, via `us-atlas` |
| Rivers, lakes, wetlands, streets, rail, buildings, parks, power lines, substations | OpenStreetMap, Geofabrik Georgia extract |
| Statewide roads | OpenStreetMap |
| Terrain | Georgia's physiographic provinces by county |
| Population and land value | Modelled from `src/data/cities.ts`, unchecked |
| Data centers | `research/datacenters.json`, with sources for each |
| Spare power | Georgia PSC staff testimony, 12 Nov 2025 |
| Transformer sizes and prices | PG&E 2025 unit cost guide (California ISO) |
| Air | EPA monitors 2023-2025, EPA model 2022 where there is none |
| Water | EPA ATTAINS, Georgia 2026 assessment |
| Substations | OpenStreetMap, `research/osm` |
| Parcels | Generated for Sumter County, generated on the fly elsewhere |
| Plant and line costs | Plausible 2026 figures, unchecked |

To refresh the OpenStreetMap layers (needs GDAL):

```bash
curl -LO https://download.geofabrik.de/north-america/us/georgia-latest.osm.pbf
npm run build:gis -- --pbf georgia-latest.osm.pbf
npm run build:hexgrid
```

The "Fetch map data" workflow does the same on GitHub, runs the tests, commits
and deploys. `npm run verify:data` checks the files and lists what is unchecked.

`npx tsx scripts/build-datacenters.ts` and `npx tsx scripts/build-env.ts` rebuild
`public/data` from `research/`.

Real Sumter parcels can be loaded with
`npm run fetch:parcels -- --county 13261 --file parcels.geojson`. Owner names are
dropped on the way in and replaced with generated ones.

OpenStreetMap data is © OpenStreetMap contributors, ODbL-1.0. Icons are Material
Design Icons, Apache-2.0. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Deploying

Set Settings, Pages, Source to GitHub Actions once. After that every push to main
is checked, tested and published. To embed the game:

```html
<iframe src="https://<user>.github.io/<repo>/embed.html" width="100%" height="720" title="GaPowerSim"></iframe>
```
