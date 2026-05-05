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
| PWA | vite-plugin-pwa (Workbox) | web manifest, service worker, offline-oriented caching; see handoff section below |
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
├── vite.config.js          ← Vite base URL (dev vs GitHub Pages), PWA plugin, publicDir=data/, port 5173
├── .github/workflows/      ← `deploy-pages.yml`: build + GitHub Pages on push to main
├── eslint.config.js        ← ESLint flat config with browser globals
├── vitest.config.js        ← Vitest: test/**/*.test.js
├── src/
│   ├── main.js             ← Boot; registers PWA service worker; loads data → map/waterfall/ui → sim
│   ├── base-url.js         ← `getBaseUrl()` wraps `import.meta.env.BASE_URL` for subpath deployments
│   ├── data-loader.js      ← Fetches JSON/GeoJSON using base-aware URLs (GitHub project Pages)
│   ├── map.js              ← MapLibre 3D map: terrain, hillshade, road/fiber/milepost layers, vehicle/anomaly markers
│   ├── waterfall.js         ← Canvas-based DAS waterfall: jet colormap LUT, per-channel noise, scroll/zoom
│   ├── simulation.js        ← Physics engine: vehicle spawning, movement, anomalies, waterfall row generation
│   ├── hazard-controller.js ← Hazards UI: tap map once; rock/snow = fixed 500×500 ft hex patch at click (see docs/HAZARDS.md)
│   ├── hazard-stamp.js      ← Hazard energy → waterfall row
│   ├── hazard-deck-overlay.js ← deck.gl extruded columns for rock slide / avalanche on MapLibre
│   ├── ui.js               ← Sidebar: stats cards, event feed
│   └── styles.css          ← Dark theme CSS (CSS custom properties)
├── test/
│   └── simulation.test.js  ← 12 tests: data integrity, waterfall logic, milepost interpolation
├── data/                   ← Processed data (served by Vite as publicDir)
│   ├── icons/              ← PWA manifest icons (PNG + SVG source); copied to dist root
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
3. Vite's `publicDir` is set to `data/` so JSON/GeoJSON are emitted at the site root of `dist/` (URLs are `BASE_URL + filename`, e.g. `/fiber_channels.json` locally or `/repo-name/fiber_channels.json` on project Pages).
4. `src/data-loader.js` fetches these on page load using URLs prefixed with `getBaseUrl()` so paths stay correct when the app is hosted under a subpath (for example `https://owner.github.io/repo-name/`).

### GitHub Pages, base URL, and PWA (agent handoff)

This repo is intended to run unchanged in **Cursor Cloud / local dev** (`npm run dev`, base `/`) and as a **GitHub Pages** static site (often base `/<repository-name>/` for project pages).

**How `base` is chosen** (see `vite.config.js`):

1. If **`VITE_BASE_URL`** is set (non-empty), it wins. Use a trailing slash for non-root bases (example: `VITE_BASE_URL=/my-repo/`). Set this when the published URL path does not match the GitHub repo name.
2. Else if **`GITHUB_PAGES=true`** and **`GITHUB_REPOSITORY=owner/repo-name`** are set (as in CI), `base` is `/<repo-name>/`.
3. Otherwise `base` is `/`.

The GitHub Actions workflow **`.github/workflows/deploy-pages.yml`** runs on pushes to **`main`**: `npm ci`, production build with **`GITHUB_PAGES=true`**, then uploads **`dist/`** via the Pages artifact/deploy actions. Repo maintainers must enable **Pages with GitHub Actions** as the source in repository settings.

**Runtime vs build**: Map tiles and terrain still require network access; PWA caching improves repeat visits and shell offline behavior but does not replace live tile servers.

**PWA implementation**:

- **`vite-plugin-pwa`** generates **`manifest.webmanifest`**, **`sw.js`**, and Workbox precaching for hashed JS/CSS/HTML and smaller static assets from `publicDir`.
- **`fiber_channels.json`** is large (~3 MB); it is **excluded from precache** (`globIgnores`) and handled by a **runtime `NetworkFirst`** rule so the install/precache bundle stays small. After one successful online load it can be served from cache when offline.
- **`src/main.js`** calls **`registerSW`** from **`virtual:pwa-register`** with `immediate: true` (auto-update registration).
- PWA plugin is **skipped when `mode === 'test'`** so Vitest does not load the virtual module.

**npm**: `vite-plugin-pwa` peer-dependencies may lag Vite major versions; **`package.json`** includes **`overrides`** (`vite-plugin-pwa` → `$vite`, `serialize-javascript`) so `npm install` resolves cleanly on Vite 8. If overrides are removed and install fails, restore them or use the upstream plugin version that officially supports the current Vite.

**Files to touch when changing hosting**:

- Asset/fetch URLs: prefer **`import.meta.env.BASE_URL`** or **`getBaseUrl()`** from `src/base-url.js` for anything loaded from the same origin as the app.
- New root static assets: add under **`data/`** (publicDir) or reference with base-aware paths.
- Icons / manifest fields: `vite.config.js` (`VitePWA` → `manifest`) and **`data/icons/`**.

### Hazards (rock slide, avalanche, crash)

Operator-placed hazards: **docs/HAZARDS.md**. Rock/snow currently use a **fixed ~500×500 ft** deck.gl hex patch at the map click (troubleshooting / visibility isolation). **deck.gl** renders extruded columns; `npm run test:e2e-hazard-deck` sanity-checks column count with the dev server.

### DAS simulation physics model

Key constants (in `src/simulation.js`):

| Parameter | Value | Notes |
|-----------|-------|-------|
| Channel spacing | 2 m | Each channel = 2 meters of fiber |
| Tick interval | 100 ms | One waterfall row per sim tick (browser lab pace, not interrogator PRF) |
| History depth | 256 rows | 25.6 seconds of visible history |
| 1 channel/tick | = 20 m/s ≈ 45 mph | Diagonal slope in waterfall |
| Default view | Full fiber (all channels) | Entire route in the waterfall on load |

Vehicle speed → channels/tick: `speedMph × 0.44704 × 0.1 / 2.0`

### Gotchas and non-obvious notes

- **Vite host binding**: Dev server binds to `0.0.0.0:5173` so the Desktop pane browser can access it. This is configured in `vite.config.js`.
- **Network required**: 3D terrain tiles come from AWS Terrarium (`s3.amazonaws.com/elevation-tiles-prod`), map tiles from OpenStreetMap. No API keys, but network access is required.
- **Python preprocessing has zero pip dependencies**: It uses only `json`, `math`, `os`, `sys` from stdlib. No need to install geopandas/shapely.
- **Sample data vs real data**: `data/raw/` currently contains **sample** GeoJSON generated by `scripts/generate_sample_data.py`. These approximate Big Cottonwood Canyon but are not real GIS data. When the owner pushes real UDOT data, re-run preprocessing.
- **Waterfall view vs fiber length**: The fiber is ~17 km (8676 channels). The default waterfall view shows the full channel range; wheel zoom narrows the window (minimum ~200 channels) but cannot zoom out past the full route. Users can scroll (mouse wheel) and zoom (Shift + scroll) on the waterfall. When zoomed out to the full length, diagonals appear nearly vertical.
- **Waterfall pre-fill**: The buffer is pre-filled with per-channel noise at startup so the waterfall isn't blank. Pre-seeded vehicles produce immediate diagonal tracks.
- **The `data/` directory is in `.gitignore`'s exclusion**: Processed data files ARE committed. If you regenerate them, commit the updated files.
- **GitHub Pages base path**: Local preview of a subpath build: `GITHUB_PAGES=true GITHUB_REPOSITORY=owner/repo-name npm run build && npm run preview` (or set `VITE_BASE_URL` explicitly).

### What to work on next (from Scope.md)

1. **Real GIS data integration**: Owner will push real fiber/road/milepost GeoJSON to `data/raw/`. Re-run preprocessing.
2. **Waterfall polish**: Synchronized hover/click between map and waterfall (highlight corresponding channel/location).
3. **Replay controls**: The play/pause/speed controls exist but replay history (last 5/15/60 min) is not yet implemented.
4. **Layer toggles**: Road/fiber/channel/crossing visibility toggles are not yet in the UI.
5. **Real data adapter**: The frontend is designed so that `src/data-loader.js` can be swapped to consume a real DAS event stream. See `Scope.md` §18 for the adapter pattern.
6. **Anomaly events**: Currently simplistic random bursts. Could be enhanced with more realistic patterns per `Scope.md` §9.3.
