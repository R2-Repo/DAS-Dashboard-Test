# DAS Canyon Dashboard

**Distributed Acoustic Sensing (DAS) monitoring dashboard for SR-190 Big Cottonwood Canyon, Utah.**

A front-end prototype that simulates a real-world DAS system monitoring a fiber optic cable along a canyon roadway. Features a 3D MapLibre map with terrain, a real-time waterfall heatmap, and live vehicle/anomaly event tracking.

## Quick Start

```bash
npm install
python3 scripts/preprocess_fiber.py   # process GIS data
npm run dev                            # open http://localhost:5173
```

## Architecture

```
data/raw/        → Raw GIS inputs (fiber, road, mileposts, crossings)
data/            → Processed data served by Vite (fiber_channels.json, etc.)
scripts/         → Python preprocessing (fiber stitching, channel generation)
src/             → Frontend modules (map, waterfall, simulation, UI)
test/            → Vitest test suite
```

## Adding Real GIS Data

1. Place your GeoJSON files in `data/raw/`:
   - `fiber.geojson` — fiber optic cable path
   - `road.geojson` — UDOT SR-190 road centerline
   - `mileposts.geojson` — milepost points with `milepost` property
   - `crossings.geojson` — (optional) fiber-road crossing points

2. Run preprocessing: `python3 scripts/preprocess_fiber.py`

3. Start the dashboard: `npm run dev`

## Commands

| Task | Command |
|------|---------|
| Dev server | `npm run dev` |
| Lint | `npm run lint` |
| Tests | `npm run test` |
| Build | `npm run build` |
