# GIS inputs (optional scratch)

The app and `scripts/preprocess_fiber.py` read **only** the canonical UDOT filenames in **`data/`** (see that folder). Nothing in this directory is required for a normal build.

| Path | Purpose |
|------|---------|
| `../sample_generated/` | Output of `python3 scripts/generate_sample_data.py` (gitignored). Copy files into `data/` only if you want to experiment with synthetic geometry. |

To regenerate processed assets after changing GIS under `data/`:

```bash
python3 scripts/preprocess_fiber.py
```

Outputs: `fiber_route.geojson`, `fiber_channels.json`, `fiber_crossings.geojson`, `road.geojson`, `mileposts.geojson`, `simulation_config.json` in `data/`.
