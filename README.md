# DAS Canyon Dashboard

**Distributed Acoustic Sensing (DAS) monitoring dashboard for SR-190 Big Cottonwood Canyon, Utah.**

A front-end prototype that simulates a real-world DAS system monitoring a fiber optic cable along a canyon roadway. Designed so real vendor DAS data can replace the simulation later with minimal frontend changes.

## Features

- **3D MapLibre map** with terrain and hillshade (AWS Terrarium tiles, no API key)
- **Real-time waterfall heatmap** with jet colormap and physics-based diagonal vehicle tracks
- **Live event feed** showing vehicle detections and anomaly alerts by route + milepost
- **Stats dashboard** with active vehicle count, average speed, directional counts, anomalies
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
data/            → UDOT GeoJSON sources + processed outputs (Vite publicDir)
scripts/         → Python preprocessing (no pip deps — stdlib only)
src/             → Frontend modules (map, waterfall, simulation, UI)
test/            → Vitest test suite
Scope/           → Full design spec and domain research
```

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
| `scripts/generate_sample_data.py` | Optional synthetic GeoJSON into `data/sample_generated/` (gitignored) |

## GIS inputs

Place UDOT exports in **`data/`** with these names (then run preprocessing):

| File | Description | Geometry |
|------|-------------|----------|
| `SR-190 Fiber.geojson` | Fiber path (may be disconnected segments) | LineString / MultiLineString |
| `SR-190 Centerline WB Down Cyn.geojson` | Westbound centerline | LineString |
| `SR-190 Centerline EB Up Cyn.geojson` | Eastbound centerline (optional but recommended) | LineString |
| `Milepost Linear Measure (LM) Tenth.geojson` | Milepost points (`Measure` → milepost in preprocess) | Point |
| `Fiber Road Crossings.geojson` | Optional authoritative crossing points on the centerline | Point |

1. Run preprocessing:
   ```bash
   python3 scripts/preprocess_fiber.py
   ```

2. Start the dashboard:
   ```bash
   npm run dev
   ```

The preprocessing script will:
- Stitch disconnected fiber segments into a single continuous line (nearest-endpoint greedy algorithm)
- Generate channel points every 2 meters along the fiber
- Interpolate milepost values from your milepost point dataset
- Compute side-of-road (north/south) relative to the road centerline(s)
- Use crossing Points from `Fiber Road Crossings.geojson` when present; otherwise infer crossings from geometry
- Output `fiber_route.geojson`, `fiber_channels.json`, `fiber_crossings.geojson`, `road.geojson`, `mileposts.geojson`, and `simulation_config.json`

## DAS Physics Model

The simulation is calibrated to real-world DAS parameters:

| Parameter | Value |
|-----------|-------|
| Channel spacing | 2 m |
| Sample rate | 10 Hz (100ms per waterfall row) |
| Waterfall history | 256 rows (25.6 seconds) |
| Speed → slope | 45 mph ≈ 1 channel/tick |
| Vehicle signal width | 1–3 channels (car) / 2–4 channels (truck) |
| Default view | 600 channels (~1.2 km) |

## Commands

| Task | Command |
|------|---------|
| Dev server | `npm run dev` |
| Lint | `npm run lint` |
| Tests | `npm run test` |
| Tests (watch) | `npm run test:watch` |
| Build | `npm run build` |
| Preview prod | `npm run preview` |

## Future Integration

When real DAS data becomes available, the integration path is:

```
vendor DAS output → translator/adapter → clean frontend JSON schema → existing UI
```

Only `src/data-loader.js` needs to change. See `Scope/Scope.md` §18 for details.
