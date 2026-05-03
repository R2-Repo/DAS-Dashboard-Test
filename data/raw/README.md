# Raw GIS Data

Place your raw GIS datasets here. The preprocessing script (`scripts/preprocess_fiber.py`) expects:

| File | Description | Format |
|------|-------------|--------|
| `fiber.geojson` | Fiber optic cable path (may be multiple disconnected segments) | GeoJSON LineString/MultiLineString |
| `road.geojson` | SR-190 road centerline(s); may contain multiple LineStrings (WB + EB) | GeoJSON LineString |
| `mileposts.geojson` | Milepost point features | GeoJSON Point with `milepost`, or UDOT `Measure` (copied to `milepost` at preprocess time) |
| `crossings.geojson` | **Authoritative** fiber–road crossing locations (points on the centerline where the fiber crosses). When this file has Point features, the preprocessor uses them only and does **not** infer crossings from GIS geometry. | GeoJSON Point |

When the final UDOT exports live in `data/` (`SR-190 Fiber.geojson`, both centerline files, `Milepost Linear Measure (LM) Tenth.geojson`, `Fiber Road Crossings.geojson`), running the script copies them into this folder and merges the two centerlines into `road.geojson` before processing.

Run the preprocessing script from the project root:

```bash
python3 scripts/preprocess_fiber.py
```

This will produce processed files in `data/`:
- `fiber_route.geojson` — single continuous ordered fiber line
- `fiber_channels.json` — channel lookup table
- `fiber_crossings.geojson` — crossing points (your `crossings.geojson` when present; otherwise inferred from side-of-road changes)
- `road.geojson` — copy of road centerline
- `mileposts.geojson` — copy of mileposts
