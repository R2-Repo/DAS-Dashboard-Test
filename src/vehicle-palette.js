/**
 * Draggable vehicle palette: drop on map to add (snaps via simulation).
 * Touch: tap a type, then tap the map once to place.
 */

import { VEHICLE_HIT_LAYERS } from './map-constants.js';

const DRAG_MIME = 'application/x-sr190-vehicle-type';

export function createVehiclePalette({ map, sim, paletteRoot }) {
  if (!paletteRoot) {
    return {
      getPendingPlaceType: () => null,
      tryConsumeMapClick: () => false,
      clearPending: () => {},
    };
  }

  const touchHint = document.getElementById('vehicle-palette-touch-hint');
  const coarse =
    typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)')?.matches;

  let pendingPlaceType = null;

  function clearPending() {
    pendingPlaceType = null;
    paletteRoot.querySelectorAll('.palette-chip').forEach((btn) => {
      btn.classList.remove('palette-chip-pending');
    });
    if (touchHint) {
      touchHint.hidden = true;
      touchHint.textContent = '';
    }
  }

  function setPending(type) {
    pendingPlaceType = type;
    paletteRoot.querySelectorAll('.palette-chip').forEach((btn) => {
      btn.classList.toggle('palette-chip-pending', btn.dataset.vehicleType === type);
    });
    if (touchHint && coarse) {
      touchHint.hidden = false;
      touchHint.textContent = 'Tap the map where you want this vehicle (snaps to route).';
    }
  }

  paletteRoot.querySelectorAll('[data-vehicle-type]').forEach((btn) => {
    btn.addEventListener('dragstart', (e) => {
      const t = btn.dataset.vehicleType;
      if (!t) return;
      e.dataTransfer?.setData(DRAG_MIME, t);
      e.dataTransfer?.setData('text/plain', t);
      e.dataTransfer.effectAllowed = 'copy';
    });

    btn.addEventListener('click', () => {
      if (!coarse) return;
      const t = btn.dataset.vehicleType;
      if (!t) return;
      if (pendingPlaceType === t) clearPending();
      else setPending(t);
    });
  });

  const canvas = map.getCanvas?.();

  function onMapDragOver(e) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }

  function onMapDrop(e) {
    e.preventDefault();
    const raw = e.dataTransfer?.getData(DRAG_MIME) || e.dataTransfer?.getData('text/plain');
    if (!raw) return;
    const lngLat = e.lngLat ?? e;
    const v = sim.addVehicleNearLngLat(lngLat.lng, lngLat.lat, { vehicleType: raw });
    if (v) {
      sim.setDefaultVehicleType(raw);
      sim.syncFleetPanel?.();
    }
  }

  if (canvas) {
    canvas.addEventListener('dragover', onMapDragOver);
    canvas.addEventListener('drop', (e) => {
      if (!map.unproject) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const lngLat = map.unproject([x, y]);
      onMapDrop({ ...e, lngLat, preventDefault: () => e.preventDefault() });
    });
  }

  /**
   * Run from map click handler before vehicle select / deselect.
   * @returns true if this click was consumed (placement or cancel-on-vehicle).
   */
  function tryConsumeMapClick(e) {
    if (!pendingPlaceType) return false;
    const hits = map.queryRenderedFeatures(e.point, { layers: VEHICLE_HIT_LAYERS });
    if (hits.length) {
      clearPending();
      return false;
    }
    const v = sim.addVehicleNearLngLat(e.lngLat.lng, e.lngLat.lat, { vehicleType: pendingPlaceType });
    clearPending();
    if (v) {
      sim.setDefaultVehicleType(v.vehicleType);
      sim.syncFleetPanel?.();
      return true;
    }
    return false;
  }

  return {
    getPendingPlaceType: () => pendingPlaceType,
    tryConsumeMapClick,
    clearPending,
  };
}
