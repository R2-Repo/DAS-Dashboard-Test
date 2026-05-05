/**
 * deck.gl extruded mass hazards (rock slide / avalanche).
 *
 * - MapLibre fill-extrusion on hundreds of tiny polygons often fails on terrain.
 * - Interleaved MapboxOverlay + terrain hides layers (depth); use overlaid mode.
 * - ColumnLayer + wrong backing-store size produced an invisible deck canvas; useDevicePixels fixes sizing.
 * - SolidPolygonLayer extrudes each hex footprint (clear hex silhouette from above vs disks).
 */
import { MapboxOverlay } from '@deck.gl/mapbox';
import { SolidPolygonLayer } from '@deck.gl/layers';

const overlays = new WeakMap();
const deckHexColumnCounts = new WeakMap();
const lastMassHexFeatures = new WeakMap();

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return [141, 110, 99];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Closed GeoJSON-style outer ring [lng,lat][] */
function closedLngLatRing(ring) {
  if (!ring?.length) return [];
  const last = ring.length - 1;
  const closed =
    ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1]
      ? ring.slice()
      : [...ring, ring[0]];
  return closed.map((pt) => [pt[0], pt[1]]);
}

function massHazardExtrudedPolygons(cellFeatures) {
  const out = [];
  for (const f of cellFeatures) {
    const ring = f.geometry?.coordinates?.[0];
    if (!ring?.length) continue;
    const props = f.properties ?? {};
    const height = typeof props.height_m === 'number' && Number.isFinite(props.height_m) ? props.height_m : 6;
    const decay = typeof props.decay === 'number' && Number.isFinite(props.decay) ? props.decay : 1;
    const opacity = 0.94 - 0.18 * Math.min(1, Math.max(0, decay));
    const rgb = hexToRgb(props.cell_fill);
    const elev = Math.max(18, height * 2.8);
    out.push({
      polygon: [closedLngLatRing(ring)],
      elevation: elev,
      fillColor: [...rgb, Math.round(255 * opacity)],
    });
  }
  return out;
}

function applyMassHexDeckLayer(map, cellPolygonFeatures) {
  const overlay = overlays.get(map);
  if (!overlay) return;

  const data = massHazardExtrudedPolygons(cellPolygonFeatures);
  deckHexColumnCounts.set(map, data.length);
  overlay.setProps({
    layers: [
      new SolidPolygonLayer({
        id: 'hazard-mass-hex-extrusions',
        data,
        extruded: true,
        filled: true,
        wireframe: false,
        pickable: false,
        getPolygon: (d) => d.polygon,
        getElevation: (d) => d.elevation,
        getFillColor: (d) => d.fillColor,
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
  map.addControl(overlay);
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

/** Row count last sent to deck (extruded hex cells). */
export function getHazardDeckHexColumnCount(map) {
  return deckHexColumnCounts.get(map) ?? 0;
}
