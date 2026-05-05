/**
 * User-placed hazards: arm tool → place on map.
 * Crash: tap/click. Rock slide / avalanche: drag along route (desktop) or tap for preset span (mobile).
 */
/* global requestAnimationFrame, cancelAnimationFrame */

import { VEHICLE_HIT_LAYERS } from './map-constants.js';
import { updateHazardPreview } from './map.js';

const MOBILE_LAYOUT_MQ = '(max-width: 768px), (max-width: 900px) and (max-height: 560px), (max-width: 1024px) and (max-height: 480px)';

function useTapPlaceMassHazard() {
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)')?.matches;
  const narrow = typeof window !== 'undefined' && window.matchMedia?.(MOBILE_LAYOUT_MQ)?.matches;
  return Boolean(coarse || narrow);
}

function fiberPreviewLineFromSim(sim, startCh, endCh) {
  const chList = sim.getChannels?.();
  if (!chList?.length) return [];
  const lo = Math.max(0, Math.min(Math.floor(startCh), Math.floor(endCh)));
  const hi = Math.max(0, Math.min(chList.length - 1, Math.ceil(Math.max(startCh, endCh))));
  if (hi <= lo) {
    const c = chList[lo];
    return c ? [[c.lon, c.lat]] : [];
  }
  const step = Math.max(1, Math.floor((hi - lo) / 80));
  const coords = [];
  for (let i = lo; i <= hi; i += step) {
    const c = chList[i];
    coords.push([c.lon, c.lat]);
  }
  const last = chList[hi];
  if (coords.length && (coords[coords.length - 1][0] !== last.lon || coords[coords.length - 1][1] !== last.lat)) {
    coords.push([last.lon, last.lat]);
  }
  return coords;
}

/**
 * @param {object} opts
 * @param {import('maplibre-gl').Map} opts.map
 * @param {object} opts.sim
 * @param {HTMLElement | null} opts.panelRoot
 * @param {{ clearPending?: () => void }} opts.vehiclePalette
 */
export function createHazardController({ map, sim, panelRoot, vehiclePalette }) {
  if (!panelRoot) {
    return {
      tryConsumeMapClick: () => false,
      disarm: () => {},
      isMassExtending: () => false,
    };
  }

  let armedKind = null;
  let magnitude = 0.55;
  let crashVehicles = 1;
  let massExtendId = null;
  let previewRaf = null;

  const hintEl = document.getElementById('hazard-arm-hint');
  const cancelBtn = document.getElementById('hazard-cancel');
  const magInput = document.getElementById('hazard-magnitude');
  const crashSeg = document.getElementById('hazard-crash-controls');
  const massSeg = document.getElementById('hazard-mass-controls');

  function setHint(text, show) {
    if (!hintEl) return;
    hintEl.hidden = !show;
    hintEl.textContent = text || '';
  }

  function setCancelVisible(v) {
    if (cancelBtn) cancelBtn.hidden = !v;
  }

  function syncPanelVisibility() {
    if (crashSeg) crashSeg.hidden = armedKind !== 'crash';
    if (massSeg) massSeg.hidden = armedKind !== 'rock_slide' && armedKind !== 'avalanche';
  }

  function disarm() {
    armedKind = null;
    massExtendId = null;
    panelRoot.querySelectorAll('.hazard-kind-btn').forEach((b) => b.classList.remove('palette-chip-pending'));
    setHint('', false);
    setCancelVisible(false);
    syncPanelVisibility();
    updateHazardPreview(map, []);
    if (map.dragPan?.isEnabled?.() === false && !sim.getDragVehicleId?.()) {
      map.dragPan.enable();
    }
  }

  function arm(kind) {
    vehiclePalette?.clearPending?.();
    if (armedKind === kind) {
      disarm();
      return;
    }
    armedKind = kind;
    panelRoot.querySelectorAll('.hazard-kind-btn').forEach((b) => {
      b.classList.toggle('palette-chip-pending', b.dataset.hazardKind === kind);
    });
    syncPanelVisibility();
    setCancelVisible(true);
    if (kind === 'crash') {
      setHint(
        useTapPlaceMassHazard()
          ? 'Tap the map to place the crash (snaps to the road).'
          : 'Click the map to place the crash (snaps to the road).',
        true,
      );
    } else if (useTapPlaceMassHazard()) {
      setHint('Tap the map to place the hazard (extent follows size slider).', true);
    } else {
      setHint('Click and drag along the route to set extent, then release.', true);
    }
  }

  panelRoot.querySelectorAll('[data-hazard-kind]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.hazardKind;
      if (k === 'crash' || k === 'rock_slide' || k === 'avalanche') arm(k);
    });
  });

  magInput?.addEventListener('input', () => {
    const v = Number(magInput.value);
    magnitude = Number.isFinite(v) ? Math.max(0, Math.min(1, v / 100)) : 0.55;
    magInput.setAttribute('aria-valuetext', `${Math.round(magnitude * 100)} percent`);
  });

  panelRoot.querySelectorAll('[data-crash-vehicles]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const n = Number(btn.dataset.crashVehicles);
      if (!Number.isFinite(n) || n < 1 || n > 3) return;
      crashVehicles = n;
      panelRoot.querySelectorAll('[data-crash-vehicles]').forEach((b) => {
        b.classList.toggle('hazard-segment-active', Number(b.dataset.crashVehicles) === crashVehicles);
      });
    });
  });

  cancelBtn?.addEventListener('click', () => disarm());

  function schedulePreview(startCh, endCh) {
    if (previewRaf) cancelAnimationFrame(previewRaf);
    previewRaf = requestAnimationFrame(() => {
      previewRaf = null;
      const coords = fiberPreviewLineFromSim(sim, startCh, endCh);
      if (coords.length < 2) {
        updateHazardPreview(map, []);
        return;
      }
      updateHazardPreview(map, [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: coords },
        },
      ]);
    });
  }

  function finishMassExtend() {
    massExtendId = null;
    disarm();
    if (map.dragPan?.isEnabled?.() === false && !sim.getDragVehicleId?.()) {
      map.dragPan.enable();
    }
  }

  function onMassPointerDown(e) {
    if (!armedKind || armedKind === 'crash' || massExtendId) return false;
    const hits = map.queryRenderedFeatures(e.point, { layers: VEHICLE_HIT_LAYERS });
    if (hits.length) return false;
    const a = sim.addHazardAtLngLat(armedKind, e.lngLat.lng, e.lngLat.lat, {
      magnitude,
    });
    if (!a) return false;
    massExtendId = a.id;
    map.dragPan.disable();
    schedulePreview(a.anchorChannel ?? a.channelCenter, a.channelCenter);
    return true;
  }

  function onMassPointerMove(e) {
    if (!massExtendId) return;
    sim.extendHazardRange(massExtendId, e.lngLat.lng, e.lngLat.lat);
    const a = sim.getHazardById(massExtendId);
    if (a) schedulePreview(a.startChannel, a.endChannel);
  }

  function onMassPointerUp() {
    if (!massExtendId) return;
    finishMassExtend();
  }

  const canvas = map.getCanvas?.();

  if (canvas) {
    canvas.addEventListener('mousedown', (ev) => {
      if (!armedKind || armedKind === 'crash' || massExtendId) return;
      if (useTapPlaceMassHazard()) return;
      if (ev.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const point = { x, y };
      const lngLat = map.unproject([x, y]);
      onMassPointerDown({ point, lngLat });
    });
    window.addEventListener('mousemove', (ev) => {
      if (!massExtendId || !map.unproject || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      const lngLat = map.unproject([ev.clientX - rect.left, ev.clientY - rect.top]);
      onMassPointerMove({ lngLat });
    });
    window.addEventListener('mouseup', () => onMassPointerUp());
  }

  map.on('touchstart', (e) => {
    if (!armedKind || armedKind === 'crash' || massExtendId) return;
    if (e.points.length !== 1) return;
    const hits = map.queryRenderedFeatures(e.point, { layers: VEHICLE_HIT_LAYERS });
    if (hits.length) return;
    if (useTapPlaceMassHazard()) return;
    if (onMassPointerDown(e)) e.preventDefault();
  });

  map.on('touchmove', (e) => {
    if (!massExtendId || e.points.length !== 1) return;
    e.originalEvent?.preventDefault?.();
    onMassPointerMove(e);
  });

  map.on('touchend', () => onMassPointerUp());
  map.on('touchcancel', () => onMassPointerUp());

  function tryConsumeMapClick(e) {
    if (!armedKind) return false;
    const hits = map.queryRenderedFeatures(e.point, { layers: VEHICLE_HIT_LAYERS });
    if (hits.length) return false;

    if (armedKind === 'crash') {
      const a = sim.addHazardAtLngLat('crash', e.lngLat.lng, e.lngLat.lat, {
        magnitude,
        vehicleCount: crashVehicles,
      });
      if (a) disarm();
      return Boolean(a);
    }

    if (useTapPlaceMassHazard()) {
      const snap = sim.nearestLaneSnap(e.lngLat.lng, e.lngLat.lat);
      if (!snap) return false;
      const spanM = 45 + magnitude * 380;
      const t0 = Math.max(0, snap.roadDistM - spanM * 0.5);
      const t1 = Math.min(snap.laneTotalM, snap.roadDistM + spanM * 0.5);
      const a = sim.addHazardAtLngLat(armedKind, snap.lon, snap.lat, { magnitude });
      if (!a) return false;
      const c0 = sim.channelPosAtRoadDistance(snap.laneKey, t0);
      const c1 = sim.channelPosAtRoadDistance(snap.laneKey, t1);
      if (typeof c0 === 'number' && typeof c1 === 'number') {
        sim.setHazardChannelRange(a.id, c0, c1);
      }
      disarm();
      return true;
    }

    return false;
  }

  return {
    tryConsumeMapClick,
    disarm,
    isMassExtending: () => Boolean(massExtendId),
  };
}
