/**
 * User-placed vehicle callouts: MapLibre markers with viewport pitch/rotation (upright on screen),
 * screen-space offsets to reduce overlap, pole length scales with zoom and terrain clearance hints.
 */
import maplibregl from 'maplibre-gl';
import { LANE_ROUTE_COLOR_HEX } from './lane-route-colors.js';

const MARKERS = new Map();

/** Base pole length in CSS px before zoom scaling. */
const BASE_POLE_PX = 56;
/** Extra pole length per zoom level below reference (px). */
const POLE_ZOOM_EXTRA_PX = 8;
const POLE_ZOOM_REF = 12.5;
const RIDGE_EXTRA_POLE_PX = 32;
/** When terrain between vehicle and flag rises this much above chord (m), add pole pixels. */
const RIDGE_LIFT_THRESHOLD_M = 22;
/** Max iterations to spread overlapping callouts on screen. */
const COLLISION_ITERS = 8;
const COLLISION_PAD = 8;

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

function poleLengthPx(map, ridgeExtraPx) {
  const z = map.getZoom();
  const zoomStretch = Math.max(0, POLE_ZOOM_REF - z) * POLE_ZOOM_EXTRA_PX;
  return BASE_POLE_PX + zoomStretch + ridgeExtraPx;
}

function terrainRidgeExtraPx(map, vehicleLng, vehicleLat, flagLng, flagLat) {
  const q = map.queryTerrainElevation?.bind(map);
  if (typeof q !== 'function') return Math.round(RIDGE_EXTRA_POLE_PX * 0.35);

  const g0 = q({ lng: vehicleLng, lat: vehicleLat });
  const g1 = q({ lng: flagLng, lat: flagLat });
  if (g0 == null || g1 == null) return Math.round(RIDGE_EXTRA_POLE_PX * 0.35);

  const midLng = (vehicleLng + flagLng) * 0.5;
  const midLat = (vehicleLat + flagLat) * 0.5;
  const gm = q({ lng: midLng, lat: midLat });
  const chord = (g0 + g1) * 0.5;
  let ridge = 0;
  if (gm != null && Number.isFinite(gm)) ridge = Math.max(0, gm - chord);
  if (ridge <= RIDGE_LIFT_THRESHOLD_M) return 0;
  return Math.min(RIDGE_EXTRA_POLE_PX, Math.round((ridge - RIDGE_LIFT_THRESHOLD_M) * 0.55));
}

function flagAnchorLngLat(vehicleLng, vehicleLat, bearingDeg, offsetM) {
  const br = ((bearingDeg % 360) + 360) % 360;
  const rad = (br * Math.PI) / 180;
  const cosφ = Math.cos((vehicleLat * Math.PI) / 180);
  const dLon = (offsetM * Math.sin(rad)) / (111320 * Math.max(0.25, Math.abs(cosφ)));
  const dLat = (offsetM * Math.cos(rad)) / 111320;
  return {
    lng: vehicleLng + dLon,
    lat: vehicleLat + dLat,
  };
}

function measureFlagBox(el) {
  const flag = el.querySelector('.vehicle-callout-flag');
  if (!flag) return { w: 88, h: 36 };
  const r = flag.getBoundingClientRect();
  return { w: r.width || 88, h: r.height || 36 };
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {Array<{ id: string; el: HTMLElement }>} items
 */
function resolveScreenOffsets(map, items) {
  const n = items.length;
  if (!n) return;

  const zoom = map.getZoom();
  const baseAlong = 24 + Math.max(0, 12.2 - zoom) * 10;
  const colW = 34 + Math.max(0, 11.5 - zoom) * 5;
  const rowH = 40 + Math.max(0, 11.5 - zoom) * 4;

  const offsets = items.map((_, i) => {
    const col = i % 5;
    const row = Math.floor(i / 5);
    return {
      x: baseAlong + col * colW,
      y: row * rowH * (row % 2 === 0 ? 1 : -1),
    };
  });

  const sizes = items.map((it) => measureFlagBox(it.el));

  for (let iter = 0; iter < COLLISION_ITERS; iter++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = offsets[j].x - offsets[i].x;
        const dy = offsets[j].y - offsets[i].y;
        const pad = COLLISION_PAD;
        const minDx = (sizes[i].w + sizes[j].w) * 0.5 + pad;
        const minDy = (sizes[i].h + sizes[j].h) * 0.5 + pad;
        if (Math.abs(dx) < minDx && Math.abs(dy) < minDy) {
          const push = 10 + iter * 3;
          const dir = dx + dy >= 0 ? 1 : -1;
          offsets[i].x -= push * dir * 0.5;
          offsets[i].y -= push * dir * 0.5;
          offsets[j].x += push * dir * 0.5;
          offsets[j].y += push * dir * 0.5;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  for (let i = 0; i < n; i++) {
    items[i].el.style.setProperty('--callout-screen-x', `${offsets[i].x}px`);
    items[i].el.style.setProperty('--callout-screen-y', `${offsets[i].y}px`);
  }
}

let moveHandler = null;
let moveHandlerMap = null;

function ensureMapMoveListener(map) {
  if (moveHandler && moveHandlerMap === map) return;
  if (moveHandler && moveHandlerMap && moveHandlerMap !== map) {
    moveHandlerMap.off('move', moveHandler);
    moveHandlerMap.off('rotate', moveHandler);
    moveHandlerMap.off('pitch', moveHandler);
  }
  moveHandlerMap = map;
  moveHandler = () => {
    const last = map.__vehicleCalloutVehicles;
    if (last?.length) syncVehicleCallouts(map, last);
  };
  map.on('move', moveHandler);
  map.on('rotate', moveHandler);
  map.on('pitch', moveHandler);
}

export function syncVehicleCallouts(map, vehicles) {
  const wantedList = vehicles.filter(
    (v) => v.userPlaced && !v.dead && v.lon !== undefined && v.lat !== undefined,
  );
  map.__vehicleCalloutVehicles = vehicles;
  ensureMapMoveListener(map);

  const wanted = new Set();
  const layoutItems = [];

  for (const v of wantedList) {
    wanted.add(v.id);

    let m = MARKERS.get(v.id);
    if (!m) {
      const el = buildEl(v.id, v.laneKey, v.speedMph);
      m = new maplibregl.Marker({
        element: el,
        anchor: 'bottom',
        pitchAlignment: 'viewport',
        rotationAlignment: 'viewport',
        opacity: 1,
        opacityWhenCovered: 0.78,
      })
        .setLngLat([v.lon, v.lat])
        .addTo(map);
      MARKERS.set(v.id, m);
    } else {
      const el = m.getElement();
      const idEl = el.querySelector('.vehicle-callout-id');
      const metaEl = el.querySelector('.vehicle-callout-meta');
      const flag = el.querySelector('.vehicle-callout-flag');
      if (idEl) idEl.textContent = v.id;
      if (metaEl) {
        const dir = v.laneKey === 'wb' ? 'WB' : 'EB';
        metaEl.textContent = `${dir} · ${Math.round(v.speedMph)} mph`;
      }
      if (flag) flag.style.setProperty('--callout-glow-rgb', laneGlowRgb(v.laneKey));
    }

    const el = m.getElement();
    const bearing = typeof v.mapBearingDeg === 'number' && Number.isFinite(v.mapBearingDeg)
      ? v.mapBearingDeg
      : 0;
    const zoom = map.getZoom();
    const alongM = 48 + Math.max(0, 12 - zoom) * 12;
    const anchor = flagAnchorLngLat(v.lon, v.lat, bearing, alongM);
    const ridgePx = terrainRidgeExtraPx(map, v.lon, v.lat, anchor.lng, anchor.lat);
    m.setLngLat([anchor.lng, anchor.lat]);

    const polePx = poleLengthPx(map, ridgePx);
    layoutItems.push({ id: v.id, el, polePx });
  }

  layoutItems.sort((a, b) => a.id.localeCompare(b.id));
  resolveScreenOffsets(map, layoutItems);
  for (const it of layoutItems) {
    const pole = it.el.querySelector('.vehicle-callout-pole');
    if (pole) pole.style.height = `${it.polePx}px`;
  }

  for (const [id, marker] of MARKERS) {
    if (!wanted.has(id)) {
      marker.remove();
      MARKERS.delete(id);
    }
  }
}

export function clearVehicleCallouts(map) {
  for (const m of MARKERS.values()) m.remove();
  MARKERS.clear();
  const mref = map ?? moveHandlerMap;
  if (mref) delete mref.__vehicleCalloutVehicles;
  if (moveHandler && moveHandlerMap) {
    moveHandlerMap.off('move', moveHandler);
    moveHandlerMap.off('rotate', moveHandler);
    moveHandlerMap.off('pitch', moveHandler);
    moveHandler = null;
    moveHandlerMap = null;
  }
}
