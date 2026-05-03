/**
 * Minimal HTML markers (pole + flag) for user-placed vehicles; follows map pan/zoom.
 */
import maplibregl from 'maplibre-gl';
import { LANE_ROUTE_COLOR_HEX } from './lane-route-colors.js';

const MARKERS = new Map();

function laneGlowRgb(laneKey) {
  const hex = laneKey === 'wb' ? LANE_ROUTE_COLOR_HEX.wb : LANE_ROUTE_COLOR_HEX.eb;
  const h = hex.replace('#', '');
  return `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`;
}

function buildEl(id, laneKey, speedMph) {
  const root = document.createElement('div');
  root.className = 'vehicle-callout';
  root.dataset.vehicleId = id;

  const pole = document.createElement('div');
  pole.className = 'vehicle-callout-pole';

  const flag = document.createElement('div');
  flag.className = 'vehicle-callout-flag';
  const rgb = laneGlowRgb(laneKey);
  flag.style.setProperty('--callout-glow-rgb', rgb);

  const line1 = document.createElement('span');
  line1.className = 'vehicle-callout-id';
  line1.textContent = id;

  const line2 = document.createElement('span');
  line2.className = 'vehicle-callout-meta';
  const dir = laneKey === 'wb' ? 'WB' : 'EB';
  line2.textContent = `${dir} · ${Math.round(speedMph)} mph`;

  flag.append(line1, line2);
  root.append(pole, flag);
  return root;
}

export function syncVehicleCallouts(map, vehicles) {
  const wanted = new Set();
  for (const v of vehicles) {
    if (!v.userPlaced || v.dead) continue;
    if (v.lon === undefined || v.lat === undefined) continue;
    wanted.add(v.id);

    let m = MARKERS.get(v.id);
    if (!m) {
      const el = buildEl(v.id, v.laneKey, v.speedMph);
      m = new maplibregl.Marker({ element: el, anchor: 'bottom', pitchAlignment: 'map', rotationAlignment: 'map' })
        .setLngLat([v.lon, v.lat])
        .addTo(map);
      MARKERS.set(v.id, m);
    } else {
      m.setLngLat([v.lon, v.lat]);
      const el = m.getElement();
      const idEl = el.querySelector('.vehicle-callout-id');
      const metaEl = el.querySelector('.vehicle-callout-meta');
      const rgb = laneGlowRgb(v.laneKey);
      const flag = el.querySelector('.vehicle-callout-flag');
      if (idEl) idEl.textContent = v.id;
      if (metaEl) {
        const dir = v.laneKey === 'wb' ? 'WB' : 'EB';
        metaEl.textContent = `${dir} · ${Math.round(v.speedMph)} mph`;
      }
      if (flag) flag.style.setProperty('--callout-glow-rgb', rgb);
    }
  }

  for (const [id, marker] of MARKERS) {
    if (!wanted.has(id)) {
      marker.remove();
      MARKERS.delete(id);
    }
  }
}

export function clearVehicleCallouts() {
  for (const m of MARKERS.values()) m.remove();
  MARKERS.clear();
}
