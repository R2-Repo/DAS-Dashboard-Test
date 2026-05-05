# User-placed hazards (simulation + map)

## What it does

- **Crash**: One tap on the map. Snaps to the nearest lane (when road geometry is valid). **Size** and **Vehicles (1–3)** shape the waterfall impulse and the 3D footprint on the map.
- **Rock slide / avalanche (troubleshooting build)**: One tap on the map. A **fixed ~500×500 ft** patch of deck.gl hex-style columns is drawn centered on the **click point** (axis-aligned square in ground meters). **Size slider and road-aligned span are ignored** for placement geometry so we can isolate visibility. If the click is far from the modeled road, placement falls back to the **nearest fiber channel** for waterfall indexing only.
- **Waterfall**: Each tick, `src/hazard-stamp.js` stamps energy into the row for all active hazards (channel span is derived from the ~500 ft footprint along fiber indices).
- **3D map**: **deck.gl** `ColumnLayer` (see `src/hazard-deck-overlay.js`) draws extruded columns for mass-hazard cells. MapLibre `fill-extrusion` draws the crash footprint.

## Source files

| File | Role |
|------|------|
| `src/hazard-controller.js` | Sidebar: arm kind, tap-to-place; square preview while rock/snow armed |
| `src/simulation.js` | `addHazardAtLngLat`, `buildFixedFootHexPatchFeatures`, `getMassHazardPreviewLine`, `syncHazardMapLayer` |
| `src/hazard-stamp.js` | Waterfall signatures per kind |
| `src/hazard-deck-overlay.js` | deck.gl overlay on MapLibre (non-interleaved) |
| `src/map.js` | Anomaly GeoJSON source; splits cell polygons to deck vs MapLibre |

## Headless check

With the dev server running on port 5173:

```bash
npm run test:e2e-hazard-deck
```

This asserts that placing a rock slide creates many deck.gl columns (`getHazardDeckHexColumnCount`) and that the deck canvas exists.

## Troubleshooting

- **No visible columns at first**: Terrain DEM can return 0 before tiles load; the overlay falls back to a plausible elevation and scales column width at low zoom. After placing rock or snow, the map **auto-zooms** toward the hazard. If columns still look small, zoom in further (≥15).
- **deck.gl vs MapLibre**: Mass hazard cells are drawn by deck (`ColumnLayer`), not the fiber layer. Toggle fiber visibility does not affect hazards.

## Road data requirement

**Crash** uses road centerlines when valid. The **temporary** rock/snow patch uses the click location and does not require the fiber map layer to be visible; waterfall span still uses fiber channel indices near the click.
