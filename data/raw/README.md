# Raw GIS Data

Place your raw GIS datasets here. The preprocessing script (`scripts/preprocess_fiber.py`) expects:

| File | Description | Format |
|------|-------------|--------|
| `fiber.geojson` | Fiber optic cable path (may be multiple disconnected segments) | GeoJSON LineString/MultiLineString |
| `road.geojson` | UDOT SR-190 road centerline | GeoJSON LineString |
| `mileposts.geojson` | Milepost point features (linear referenced to tenths) | GeoJSON Point with `milepost` property |
| `crossings.geojson` | (Optional) Known fiber-road crossing points | GeoJSON Point |

Run the preprocessing script from the project root:

```bash
python3 scripts/preprocess_fiber.py
```

This will produce processed files in `data/`:
- `fiber_route.geojson` — single continuous ordered fiber line
- `fiber_channels.json` — channel lookup table
- `fiber_crossings.geojson` — detected crossing points
- `road.geojson` — copy of road centerline
- `mileposts.geojson` — copy of mileposts
