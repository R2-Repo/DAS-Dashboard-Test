# SR-190 Big Cottonwood Canyon

A small **web app** for SR-190 Big Cottonwood Canyon, Utah: a map of the road and a simple synthetic view along the fiber. You can add vehicles and see how they might show up. Built so real sensing data could plug in later.

## Features

- **3D MapLibre map** with terrain and hillshade (AWS Terrarium tiles, no API key)
- **Real-time waterfall heatmap** with jet colormap and physics-based diagonal vehicle tracks
- **Live event feed** showing vehicle detections and anomaly alerts by route + milepost
- **Sidebar stats** (vehicles, speed, direction counts, alerts)
- **Simulation engine** calibrated to real SR-190 canyon road physics
- **Python preprocessing pipeline** for GIS data (fiber stitching, channel generation, milepost interpolation)

## Quick Start

```bash
npm install
python3 scripts/preprocess_fiber.py   # process GIS data → data/
npm run dev                            # open http://localhost:5173
```

## Architecture

```
data/raw/        → Raw GIS inputs (fiber, road, mileposts, crossings)
data/            → Processed data served by Vite (fiber_channels.json, etc.)
docs/            → Deep-dive docs (waterfall + traffic rebuild guide)
scripts/         → Python preprocessing (no pip deps — stdlib only)
src/             → Frontend modules (map, waterfall, simulation, UI)
test/            → Vitest test suite
Scope/           → Full design spec and domain research
```

### Documentation

| Doc | Contents |
|-----|----------|
| [`docs/waterfall-traffic-rebuild.md`](docs/waterfall-traffic-rebuild.md) | How the waterfall, vehicle traces, simulation ticks, and map stay in sync—constants, data flow, file ownership, dual road/legacy paths, and a rebuild checklist |
| [`Scope/Scope.md`](Scope/Scope.md) | Full product/design specification |

### Frontend modules

| Module | Purpose |
|--------|---------|
| `src/main.js` | Boot sequence: load data → init map/waterfall/UI → start simulation |
| `src/map.js` | MapLibre 3D map with terrain, road/fiber/milepost/crossing layers, vehicle markers |
| `src/waterfall.js` | Canvas-based DAS waterfall renderer with jet colormap LUT |
| `src/simulation.js` | Physics engine: vehicle spawning/movement, anomalies, waterfall row generation |
| `src/ui.js` | Sidebar: stats cards and scrolling event feed |
| `src/data-loader.js` | Fetches processed JSON/GeoJSON from Vite publicDir |

### Preprocessing scripts

| Script | Purpose |
|--------|---------|
| `scripts/preprocess_fiber.py` | Stitch fiber segments → channel lookup table → crossings → side-of-road |
| `scripts/generate_sample_data.py` | Generate sample Big Cottonwood Canyon GeoJSON for development |

## Adding Real GIS Data

1. Place your GeoJSON files in `data/raw/`:

   | File | Description | Geometry |
   |------|-------------|----------|
   | `fiber.geojson` | Fiber optic cable path (may be disconnected segments) | LineString / MultiLineString |
   | `road.geojson` | UDOT SR-190 road centerline | LineString |
   | `mileposts.geojson` | Milepost points with `milepost` property (to tenths) | Point |
   | `crossings.geojson` | (Optional) Known fiber-road crossing points | Point |

2. Run preprocessing:
   ```bash
   python3 scripts/preprocess_fiber.py
   ```

3. Run the app:
   ```bash
   npm run dev
   ```

The preprocessing script will:
- Stitch disconnected fiber segments into a single continuous line (nearest-endpoint greedy algorithm)
- Generate channel points every 2 meters along the fiber
- Interpolate milepost values from your milepost point dataset
- Compute side-of-road (north/south) relative to the road centerline
- Detect fiber-road crossings and label nearby channels
- Output `fiber_route.geojson`, `fiber_channels.json`, `fiber_crossings.geojson`, and `simulation_config.json`

## DAS Physics Model

The simulation uses **2 m** channel spacing and a **100 ms** sim tick (one waterfall row per tick — a browser-lab choice, not interrogator PRF):

| Parameter | Value |
|-----------|-------|
| Channel spacing | 2 m |
| Sim tick / waterfall row | 100 ms (`TICK_MS` in `src/simulation.js`) |
| Waterfall history | 256 rows (25.6 s at 100 ms/tick) |
| Speed → slope | 45 mph ≈ 1 channel/tick |
| Vehicle signal width | 1–3 channels (car) / 2–4 channels (truck) |
| Default view | Full fiber (all channels on load) |

## Commands

| Task | Command |
|------|---------|
| Dev server | `npm run dev` |
| Lint | `npm run lint` |
| Tests | `npm run test` |
| Tests (watch) | `npm run test:watch` |
| Build | `npm run build` |
| Preview prod | `npm run preview` |
| Verify map (headless Chrome) | `npm run verify:map` — requires Chrome/Chromium; set `CHROME_PATH` if needed |
| Verify waterfall traces | `npm run verify:waterfall` — same; checks demo fleet produces visible vehicle energy on canvas |

After changing waterfall rendering, vehicle stamping, or map–sim coupling, run **`npm run build`** then **`npm test`** and, when possible, the **`verify:*`** scripts locally or in CI.

## Future Integration

When real DAS data becomes available, the integration path is:

```
vendor DAS output → translator/adapter → clean frontend JSON schema → existing UI
```

Only `src/data-loader.js` needs to change. See `Scope/Scope.md` §18 for details.
