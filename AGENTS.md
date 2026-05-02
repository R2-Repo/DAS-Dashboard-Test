# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

DAS (Distributed Acoustic Sensing) Canyon Dashboard — a front-end-only prototype that simulates real-world DAS monitoring of a fiber optic cable along a canyon roadway. See `Scope/Scope.md` for the full design specification.

### Tech stack

- **Runtime**: Node.js 20 LTS
- **Build tool**: Vite (dev server + production build)
- **Map library**: MapLibre GL JS (raster tiles from OpenStreetMap)
- **Linting**: ESLint (flat config in `eslint.config.js`)
- **Testing**: Vitest (test files in `test/`)
- **No backend / no database** — purely static frontend with simulated data

### Common commands

| Task | Command |
|------|---------|
| Dev server | `npm run dev` (serves on `http://localhost:5173`) |
| Lint | `npm run lint` |
| Tests | `npm run test` |
| Build | `npm run build` |
| Preview prod build | `npm run preview` |

### Gotchas

- The Vite dev server binds to `0.0.0.0:5173` so it is accessible from the Desktop pane browser.
- Map tiles are loaded from `https://tile.openstreetmap.org` — requires network access.
- The `data/` directory is served as `publicDir` by Vite; static GeoJSON and JSON data files go there.
- `src/` contains the frontend modules; `test/` contains Vitest test files.
