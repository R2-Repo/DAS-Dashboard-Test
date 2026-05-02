# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

DAS (Distributed Acoustic Sensing) Canyon Dashboard for **SR-190 Big Cottonwood Canyon, Utah**. Front-end-only prototype that simulates real-world DAS monitoring of a fiber optic cable along a canyon roadway. The full design specification is in `Scope/Scope.md` — read it for domain context, data model definitions, and acceptance criteria.

**Current state**: Working prototype with synthetic sample data. Real GIS data (fiber path, road centerline, mileposts) has not been added yet — the owner will push those to `data/raw/` as GeoJSON files.

### Tech stack

| Layer | Technology | Notes |
|-------|------------|-------|
| Runtime | Node.js 20 LTS | installed via nodesource apt repo |
| Build tool | Vite | dev server + production build |
| Map | MapLibre GL JS | 3D terrain via AWS Terrarium tiles (no API key) |
| Linting | ESLint 10 | flat config in `eslint.config.js` |
| Testing | Vitest 4 | test files in `test/` |
| Preprocessing | Python 3.12 | stdlib only (`json`, `math`, `os`) — no pip dependencies |
| Backend / DB | None | purely static frontend with simulated data |

### Repository structure

```
/workspace
├── index.html              ← Vite entry point (dashboard layout + DOM structure)
├── package.json            ← npm scripts: dev, build, lint, test
├── vite.config.js          ← Vite: publicDir=data/, port 5173, host 0.0.0.0
├── eslint.config.js        ← ESLint flat config with browser globals
├── vitest.config.js        ← Vitest: test/**/*.test.js
├── src/
│   ├── main.js             ← Boot: loads data → init map/waterfall/ui → start sim
│   ├── data-loader.js      ← Fetches all JSON/GeoJSON from publicDir
│   ├── map.js              ← MapLibre 3D map: terrain, hillshade, road/fiber/milepost layers, vehicle/anomaly markers
│   ├── waterfall.js         ← Canvas-based DAS waterfall: jet colormap LUT, per-channel noise, scroll/zoom
│   ├── simulation.js        ← Physics engine: vehicle spawning, movement, anomalies, waterfall row generation
│   ├── ui.js               ← Sidebar: stats cards, event feed
│   └── styles.css          ← Dark theme CSS (CSS custom properties)
├── test/
│   └── simulation.test.js  ← 12 tests: data integrity, waterfall logic, milepost interpolation
├── data/                   ← Processed data (served by Vite as publicDir)
│   ├── fiber_route.geojson ← Stitched continuous fiber line
│   ├── fiber_channels.json ← Channel lookup table (8676 channels @ 2m spacing)
│   ├── fiber_crossings.geojson
│   ├── road.geojson
│   ├── mileposts.geojson
│   └── simulation_config.json
├── data/raw/               ← Raw GIS input files (sample data currently; real data TBD)
│   ├── fiber.geojson
│   ├── road.geojson
│   ├── mileposts.geojson
│   └── crossings.geojson
├── scripts/
│   ├── preprocess_fiber.py  ← Stitch fiber segments → channel table → crossings → side-of-road
│   └── generate_sample_data.py ← Generate sample Big Cottonwood Canyon GeoJSON
└── Scope/
    └── Scope.md            ← Full design spec and domain research (850 lines)
```

### Common commands

| Task | Command |
|------|---------|
| Install deps | `npm install` |
| Dev server | `npm run dev` (serves on `http://localhost:5173`) |
| Lint | `npm run lint` |
| Tests | `npm run test` |
| Tests (watch) | `npm run test:watch` |
| Build | `npm run build` |
| Preview prod build | `npm run preview` |
| Generate sample data | `python3 scripts/generate_sample_data.py` |
| Preprocess GIS data | `python3 scripts/preprocess_fiber.py` |

### Data pipeline

```
data/raw/*.geojson  →  python3 scripts/preprocess_fiber.py  →  data/*.json / data/*.geojson
                                                                      ↓
                                                               Vite serves as publicDir
                                                                      ↓
                                                            src/data-loader.js fetches at /filename
```

1. Raw GIS files go in `data/raw/` (fiber.geojson, road.geojson, mileposts.geojson, crossings.geojson)
2. Run `python3 scripts/preprocess_fiber.py` to produce processed files in `data/`
3. Vite's `publicDir` is set to `data/` so all JSON/GeoJSON files are served at root (e.g. `/fiber_channels.json`)
4. `src/data-loader.js` fetches these on page load

### DAS simulation physics model

Key constants (in `src/simulation.js`):

| Parameter | Value | Notes |
|-----------|-------|-------|
| Channel spacing | 2 m | Each channel = 2 meters of fiber |
| Tick interval | 100 ms (10 Hz) | One waterfall row per tick |
| History depth | 256 rows | 25.6 seconds of visible history |
| 1 channel/tick | = 20 m/s ≈ 45 mph | Diagonal slope in waterfall |
| Default view | 600 channels | ~1.2 km of fiber visible |

Vehicle speed → channels/tick: `speedMph × 0.44704 × 0.1 / 2.0`

### Gotchas and non-obvious notes

- **Vite host binding**: Dev server binds to `0.0.0.0:5173` so the Desktop pane browser can access it. This is configured in `vite.config.js`.
- **Network required**: 3D terrain tiles come from AWS Terrarium (`s3.amazonaws.com/elevation-tiles-prod`), map tiles from OpenStreetMap. No API keys, but network access is required.
- **Python preprocessing has zero pip dependencies**: It uses only `json`, `math`, `os`, `sys` from stdlib. No need to install geopandas/shapely.
- **Sample data vs real data**: `data/raw/` currently contains **sample** GeoJSON generated by `scripts/generate_sample_data.py`. These approximate Big Cottonwood Canyon but are not real GIS data. When the owner pushes real UDOT data, re-run preprocessing.
- **Waterfall view vs fiber length**: The fiber is ~17 km (8676 channels). The default waterfall view shows 600 channels (~1.2 km). Users can scroll (mouse wheel) and zoom (Shift + scroll) on the waterfall. If the view is too wide, diagonals appear nearly vertical.
- **Waterfall pre-fill**: The buffer is pre-filled with per-channel noise at startup so the waterfall isn't blank. Pre-seeded vehicles produce immediate diagonal tracks.
- **The `data/` directory is in `.gitignore`'s exclusion**: Processed data files ARE committed. If you regenerate them, commit the updated files.

### What to work on next (from Scope.md)

1. **Real GIS data integration**: Owner will push real fiber/road/milepost GeoJSON to `data/raw/`. Re-run preprocessing.
2. **Waterfall polish**: Synchronized hover/click between map and waterfall (highlight corresponding channel/location).
3. **Replay controls**: The play/pause/speed controls exist but replay history (last 5/15/60 min) is not yet implemented.
4. **Layer toggles**: Road/fiber/channel/crossing visibility toggles are not yet in the UI.
5. **Real data adapter**: The frontend is designed so that `src/data-loader.js` can be swapped to consume a real DAS event stream. See `Scope.md` §18 for the adapter pattern.
6. **Anomaly events**: Currently simplistic random bursts. Could be enhanced with more realistic patterns per `Scope.md` §9.3.
