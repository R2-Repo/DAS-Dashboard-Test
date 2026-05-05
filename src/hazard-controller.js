/**
 * User-placed hazards: arm a kind → adjust Size (and crash vehicle count) → tap the map once.
 * Rock slide / avalanche extent follows the road centerline for the chosen span (no map drag).
 */
/* global requestAnimationFrame, cancelAnimationFrame */

import { VEHICLE_HIT_LAYERS } from './map-constants.js';
import { updateHazardPreview } from './map.js';

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
    };
  }

  let armedKind = null;
  let magnitude = 0.55;
  let crashVehicles = 1;

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
    map.off('moveend', onMapMoveEnd);
    panelRoot.querySelectorAll('.hazard-kind-btn').forEach((b) => b.classList.remove('palette-chip-pending'));
    setHint('', false);
    setCancelVisible(false);
    syncPanelVisibility();
    updateHazardPreview(map, []);
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
      setHint('Tap the map to place the crash (snaps to the nearest lane).', true);
    } else {
      setHint('Tap the map once; extent follows the road and the Size slider.', true);
    }
    scheduleMassPreview();
    map.on('moveend', onMapMoveEnd);
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
    if (armedKind === 'rock_slide' || armedKind === 'avalanche') scheduleMassPreview();
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

  function onMapMoveEnd() {
    scheduleMassPreview();
  }

  let previewRaf = null;
  function scheduleMassPreview() {
    if (armedKind !== 'rock_slide' && armedKind !== 'avalanche') return;
    if (previewRaf) cancelAnimationFrame(previewRaf);
    previewRaf = requestAnimationFrame(() => {
      previewRaf = null;
      const coords = sim.getMassHazardPreviewLine?.(armedKind, magnitude) ?? [];
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

  /**
   * @returns {boolean} true if click was consumed
   */
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

    const a = sim.addHazardAtLngLat(armedKind, e.lngLat.lng, e.lngLat.lat, { magnitude });
    if (a) disarm();
    return Boolean(a);
  }

  return {
    tryConsumeMapClick,
    disarm,
  };
}
