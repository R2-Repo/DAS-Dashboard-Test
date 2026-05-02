import { getBaseUrl } from './base-url.js';

/**
 * Data loader — fetches all processed GIS and config files from Vite's publicDir.
 *
 * Files are served from the `data/` directory (configured as publicDir in vite.config.js).
 * To swap in real DAS data, replace the fetch URLs or add a WebSocket/SSE adapter here.
 */
export async function loadData() {
  const base = getBaseUrl();
  const [fiberRoute, road, mileposts, crossings, channels, config] = await Promise.all([
    fetchJSON(`${base}fiber_route.geojson`),
    fetchJSON(`${base}road.geojson`),
    fetchJSON(`${base}mileposts.geojson`),
    fetchJSON(`${base}fiber_crossings.geojson`),
    fetchJSON(`${base}fiber_channels.json`),
    fetchJSON(`${base}simulation_config.json`),
  ]);

  return { fiberRoute, road, mileposts, crossings, channels, config };
}

async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to load ${url}: ${resp.status}`);
  return resp.json();
}
