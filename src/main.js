/**
 * Application entry point.
 * Loads processed GIS data, initializes the map/waterfall/UI, and starts the simulation.
 */
import { registerSW } from 'virtual:pwa-register';
import { initMap, setupTrafficLabMapDrag } from './map.js';
import { initWaterfall } from './waterfall.js';
import { createSimulation } from './simulation.js';
import { initUI } from './ui.js';
import { loadData } from './data-loader.js';

registerSW({ immediate: true });

async function boot() {
  const data = await loadData();
  const map = initMap('map', data);
  const waterfall = initWaterfall('waterfall-canvas', data);
  const ui = initUI();
  const sim = createSimulation(data, { map, waterfall, ui });

  sim.start();

  setupTrafficLabMapDrag(map, {
    isDemoMode: () => sim.isDemoMode(),
    isRoadOk: () => sim.isRoadOk(),
    placeDemoVehicleAtLngLat: (lng, lat) => sim.placeDemoVehicleAtLngLat(lng, lat),
  });

  const labEnable = document.getElementById('traffic-lab-enable');
  const labControls = document.getElementById('traffic-lab-controls');
  const labDragHint = document.getElementById('traffic-lab-drag-hint');
  const labLegacyHint = document.getElementById('traffic-lab-legacy-hint');

  function syncLabHints() {
    const roadOk = sim.isRoadOk();
    if (labDragHint) labDragHint.hidden = !roadOk;
    if (labLegacyHint) labLegacyHint.hidden = roadOk;
  }

  labEnable?.addEventListener('change', () => {
    const on = labEnable.checked;
    sim.setDemoMode(on);
    if (labControls) labControls.hidden = !on;
    if (!on) {
      map.dragPan.enable();
    }
    if (on) {
      syncLabHints();
      sim.applyLabPreset('eb_up');
    }
  });

  document.getElementById('lab-preset-eb')?.addEventListener('click', () => {
    sim.applyLabPreset('eb_up');
  });
  document.getElementById('lab-preset-wb')?.addEventListener('click', () => {
    sim.applyLabPreset('wb_down');
  });

  syncLabHints();

  document.getElementById('btn-play').addEventListener('click', () => sim.play());
  document.getElementById('btn-pause').addEventListener('click', () => sim.pause());
  document.getElementById('speed-select').addEventListener('change', (e) => {
    sim.setSpeed(parseFloat(e.target.value));
  });
}

boot();
