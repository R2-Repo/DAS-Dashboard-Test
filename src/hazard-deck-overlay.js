/**
 * deck.gl mass hazards (rock slide / avalanche) — extruded hex columns on MapLibre terrain.
 *
 * - MapLibre fill-extrusion on hundreds of tiny polygons is unreliable on terrain.
 * - **Non-interleaved** MapboxOverlay: a separate deck canvas stacked on the map. `styles.css` sets
 *   `#map .deck-widget-container { pointer-events: none }` so **touch/scroll still reach MapLibre**.
 *   Interleaved mode shares MapLibre's canvas/WebGL and repeatedly broke **mobile** pan/pinch (mjolnir/Hammer on the same element).
 * - Positions use LNGLAT + terrain altitude (meters); plain lng/lat extrusions sit at sea level and disappear under terrain.
 */
import { COORDINATE_SYSTEM } from '@deck.gl/core';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ColumnLayer } from '@deck.gl/layers';

const overlays = new WeakMap();
const deckHexColumnCounts = new WeakMap();
const lastMassHexFeatures = new WeakMap();

/** When DEM not loaded yet — canyon interior ASL (avoids sea-level basement). */
const FALLBACK_TERRAIN_M = 2750;

/** `queryTerrainElevation` often returns 0 / NaN before terrain tiles load — columns would sit under the mesh. */
function isPlausibleTerrainElevationM(z) {
  return typeof z === 'number' && Number.isFinite(z) && z > 800;
}

function lowZoomColumnBoost(map) {
  const z = typeof map?.getZoom === 'function' ? map.getZoom() : 12;
  // At route overview (~11–13) 2–4 m radius is sub-pixel; inflate so mass hazards read as a pile.
  if (z >= 15.2) return 1;
  return Math.min(8, Math.pow(1.42, Math.max(0, 15.2 - z)));
}

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return [141, 110, 99];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function polygonCentroidLonLat(ring) {
  const n = ring.length > 0 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.length - 1
    : ring.length;
  let lon = 0;
  let lat = 0;
  for (let i = 0; i < n; i++) {
    lon += ring[i][0];
    lat += ring[i][1];
  }
  const k = Math.max(1, n);
  return [lon / k, lat / k];
}

function hexCircumRadiusMeters(centerLat, centerLon, ring) {
  const cosφ = Math.cos((centerLat * Math.PI) / 180);
  let maxSq = 0;
  const n = ring.length > 0 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.length - 1
    : ring.length;
  for (let i = 0; i < n; i++) {
    const dLon = (ring[i][0] - centerLon) * 111320 * Math.max(0.25, Math.abs(cosφ));
    const dLat = (ring[i][1] - centerLat) * 111320;
    const sq = dLon * dLon + dLat * dLat;
    if (sq > maxSq) maxSq = sq;
  }
  return Math.sqrt(maxSq);
}

function terrainMetersAt(map, lon, lat) {
  try {
    const z = map.queryTerrainElevation?.([lon, lat]);
    if (isPlausibleTerrainElevationM(z)) return z;
  } catch {
    /* ignore */
  }
  return FALLBACK_TERRAIN_M;
}

function massHazardColumnData(map, cellFeatures) {
  const zoomBoost = lowZoomColumnBoost(map);
  const out = [];
  for (const f of cellFeatures) {
    const ring = f.geometry?.coordinates?.[0];
    if (!ring?.length) continue;
    const [lon, lat] = polygonCentroidLonLat(ring);
    const altM = terrainMetersAt(map, lon, lat);
    const radius = hexCircumRadiusMeters(lat, lon, ring);
    const props = f.properties ?? {};
    const h = typeof props.height_m === 'number' && Number.isFinite(props.height_m) ? props.height_m : 6;
    const decay = typeof props.decay === 'number' && Number.isFinite(props.decay) ? props.decay : 1;
    const opacity = 0.94 - 0.18 * Math.min(1, Math.max(0, decay));
    const rgb = hexToRgb(props.cell_fill);
    const rM = Math.max(4.5, radius * 1.08 * zoomBoost);
    const elevM = Math.max(42, h * 5 * Math.min(2.2, 0.65 + zoomBoost * 0.22));
    out.push({
      position: [lon, lat, altM],
      radius: rM,
      elevation: elevM,
      fillColor: [...rgb, Math.round(255 * opacity)],
    });
  }
  return out;
}

function applyMassHexDeckLayer(map, cellPolygonFeatures) {
  const overlay = overlays.get(map);
  if (!overlay) return;

  const data = massHazardColumnData(map, cellPolygonFeatures);
  deckHexColumnCounts.set(map, data.length);
  overlay.setProps({
    layers: [
      new ColumnLayer({
        id: 'hazard-mass-hex-columns',
        data,
        coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        diskResolution: 6,
        radius: (d) => d.radius,
        getPosition: (d) => d.position,
        getElevation: (d) => d.elevation,
        getFillColor: (d) => d.fillColor,
        radiusUnits: 'meters',
        extruded: true,
        pickable: false,
        coverage: 1,
      }),
    ],
  });
}

export function attachHazardDeckOverlay(map) {
  if (!map || overlays.has(map)) return;
  deckHexColumnCounts.set(map, 0);
  lastMassHexFeatures.set(map, []);
  const overlay = new MapboxOverlay({
    interleaved: false,
    useDevicePixels: true,
    layers: [],
  });
  map.addControl(overlay, 'bottom-left');
  overlays.set(map, overlay);
  globalThis.requestAnimationFrame?.(() => {
    map.resize();
    refreshHazardDeckHexLayer(map);
  });
}

export function updateHazardDeckHexLayer(map, cellPolygonFeatures) {
  const list = cellPolygonFeatures ?? [];
  lastMassHexFeatures.set(map, list);
  applyMassHexDeckLayer(map, list);
}

export function refreshHazardDeckHexLayer(map) {
  const features = lastMassHexFeatures.get(map);
  if (!features?.length) return;
  applyMassHexDeckLayer(map, features);
}

/** Rows last sent to deck (hex columns). */
export function getHazardDeckHexColumnCount(map) {
  return deckHexColumnCounts.get(map) ?? 0;
}
