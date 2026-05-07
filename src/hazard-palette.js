/**
 * Hazard palette: pick type + size, tap map to place (snaps to route like vehicles).
 */

import { VEHICLE_HIT_LAYERS } from './map-constants.js';

const MOBILE_LAYOUT_MQ = '(max-width: 768px), (max-width: 900px) and (max-height: 560px), (max-width: 1024px) and (max-height: 480px)';

function useTapPlacePalette() {
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)')?.matches;
  const narrow =
    typeof window !== 'undefined' && window.matchMedia?.(MOBILE_LAYOUT_MQ)?.matches;
  return Boolean(coarse || narrow);
}

export function createHazardPalette({ map, sim, paletteRoot, clearOthers }) {
  if (!paletteRoot) {
    return {
      getPendingKind: () => null,
      tryConsumeMapClick: () => false,
      clearPending: () => {},
    };
  }

  const touchHint = document.getElementById('hazard-palette-touch-hint');

  let pendingKind = null;
  let hazardSize = 'medium';

  const sizeButtons = () => paletteRoot.querySelectorAll('[data-hazard-size]');

  function syncSizeVisual() {
    sizeButtons().forEach((btn) => {
      const z = btn.dataset.hazardSize;
      btn.classList.toggle('hazard-size-selected', z === hazardSize);
    });
  }

  function clearPending() {
    pendingKind = null;
    paletteRoot.querySelectorAll('[data-hazard-kind]').forEach((btn) => {
      btn.classList.remove('palette-chip-pending');
    });
    if (touchHint) {
      touchHint.hidden = true;
      touchHint.textContent = '';
    }
  }

  function armKind(kind) {
    clearOthers?.();
    pendingKind = kind;
    paletteRoot.querySelectorAll('[data-hazard-kind]').forEach((btn) => {
      btn.classList.toggle('palette-chip-pending', btn.dataset.hazardKind === kind);
    });
    if (touchHint && useTapPlacePalette()) {
      touchHint.hidden = false;
      touchHint.textContent = 'Tap the map to place this hazard (snaps to the route).';
    }
  }

  paletteRoot.querySelectorAll('[data-hazard-kind]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.hazardKind;
      if (!k) return;
      if (pendingKind === k) clearPending();
      else armKind(k);
    });
  });

  sizeButtons().forEach((btn) => {
    btn.addEventListener('click', () => {
      const z = btn.dataset.hazardSize;
      if (!z) return;
      hazardSize = z;
      syncSizeVisual();
    });
  });

  syncSizeVisual();

  /**
   * @returns true if this click was consumed (placement).
   */
  function tryConsumeMapClick(e) {
    if (!pendingKind) return false;
    const hits = map.queryRenderedFeatures(e.point, { layers: VEHICLE_HIT_LAYERS });
    if (hits.length) {
      clearPending();
      return false;
    }
    const h = sim.addHazardNearLngLat(e.lngLat.lng, e.lngLat.lat, {
      kind: pendingKind,
      size: hazardSize,
    });
    clearPending();
    return !!h;
  }

  return {
    getPendingKind: () => pendingKind,
    tryConsumeMapClick,
    clearPending,
  };
}
