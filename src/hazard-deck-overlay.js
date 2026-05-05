/**
 * deck.gl extruded hex columns for mass hazards (rock slide / avalanche).
 * MapLibre fill-extrusion on many tiny terrain-spanning polygons often fails to show; deck.gl renders reliably.
 */
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ColumnLayer } from '@deck.gl/layers';

const overlays = new WeakMap();
/** Last ColumnLayer instance count per map (for automated verification). */
const deckHexColumnCounts = new WeakMap();

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

/** Approximate max vertex distance from center in meters (planar ENU). */
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

function massHazardColumnData(map, cellFeatures) {
  const out = [];
  for (const f of cellFeatures) {
    const ring = f.geometry?.coordinates?.[0];
    if (!ring?.length) continue;
    const [lon, lat] = polygonCentroidLonLat(ring);
    let ground;
    try {
      ground = map.queryTerrainElevation?.([lon, lat]) ?? 0;
    } catch {
      ground = 0;
    }
    if (typeof ground !== 'number' || !Number.isFinite(ground)) ground = 0;
    const radius = hexCircumRadiusMeters(lat, lon, ring);
    const props = f.properties ?? {};
    const height = typeof props.height_m === 'number' && Number.isFinite(props.height_m) ? props.height_m : 6;
    const decay = typeof props.decay === 'number' && Number.isFinite(props.decay) ? props.decay : 1;
    const opacity = 0.94 - 0.18 * Math.min(1, Math.max(0, decay));
    const rgb = hexToRgb(props.cell_fill);
    out.push({
      position: [lon, lat, ground],
      radius: Math.max(1.5, radius * 0.98),
      elevation: Math.max(2.5, height),
      fillColor: [...rgb, Math.round(255 * opacity)],
    });
  }
  return out;
}

export function attachHazardDeckOverlay(map) {
  if (!map || overlays.has(map)) return;
  deckHexColumnCounts.set(map, 0);
  const overlay = new MapboxOverlay({
    interleaved: true,
    layers: [],
  });
  map.addControl(overlay);
  overlays.set(map, overlay);
}

export function updateHazardDeckHexLayer(map, cellPolygonFeatures) {
  const overlay = overlays.get(map);
  if (!overlay) return;

  const data = massHazardColumnData(map, cellPolygonFeatures);
  deckHexColumnCounts.set(map, data.length);
  overlay.setProps({
    layers: [
      new ColumnLayer({
        id: 'hazard-mass-hex-columns',
        data,
        diskResolution: 6,
        radius: (d) => d.radius,
        getPosition: (d) => d.position,
        getElevation: (d) => d.elevation,
        getFillColor: (d) => d.fillColor,
        radiusUnits: 'meters',
        extruded: true,
        pickable: false,
        parameters: { depthTest: true },
      }),
    ],
  });
}

/** How many extruded hex columns the deck layer last built for `map` (0 if none / overlay missing). */
export function getHazardDeckHexColumnCount(map) {
  return deckHexColumnCounts.get(map) ?? 0;
}
