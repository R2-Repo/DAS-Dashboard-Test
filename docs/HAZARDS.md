# User-placed hazards (simulation + map)

## What it does

- **Crash**: One tap on the map. Snaps to the nearest lane (when road geometry is valid). **Size** and **Vehicles (1–3)** shape the waterfall impulse and the 3D footprint on the map.
- **Rock slide / avalanche**: One tap on the map. **Extent along the route** is derived from the **road centerline** (same geometry as traffic), not from dragging and not from the fiber map layer. **Size** sets how many meters of road are covered; that span is mapped to fiber **channel indices** for the DAS waterfall and for deck.gl columns.
- **Waterfall**: Each tick, `src/hazard-stamp.js` stamps energy into the row for all active hazards.
- **3D map**: **deck.gl** `ColumnLayer` (see `src/hazard-deck-overlay.js`) draws extruded hex-style columns for mass hazards. MapLibre `fill-extrusion` draws the crash footprint and non-cell debris styling.

## Source files

| File | Role |
|------|------|
| `src/hazard-controller.js` | Sidebar: arm kind, size, tap-to-place; road-aligned preview line while armed |
| `src/simulation.js` | `addHazardAtLngLat`, road span for mass hazards, `getMassHazardPreviewLine`, `syncHazardMapLayer` |
| `src/hazard-stamp.js` | Waterfall signatures per kind |
| `src/hazard-deck-overlay.js` | deck.gl overlay on MapLibre (non-interleaved) |
| `src/map.js` | Anomaly GeoJSON source; splits cell polygons to deck vs MapLibre |

## Headless check

With the dev server running on port 5173:

```bash
npm run test:e2e-hazard-deck
```

This asserts that placing a rock slide creates many deck.gl columns (`getHazardDeckHexColumnCount`).

## Road data requirement

Mass hazards use **EB/WB road centerlines** from processed `road.geojson`. If lane geometry is missing or too short, placement falls back to channel-only span around the snapped fiber point.
