/**
 * Application entry point.
 * Loads processed GIS data, initializes the map/waterfall/UI, and starts the simulation.
 */
import { initMap } from './map.js';
import { initWaterfall } from './waterfall.js';
import { createSimulation } from './simulation.js';
import { initUI } from './ui.js';
import { loadData } from './data-loader.js';

async function boot() {
  const data = await loadData();
  const map = initMap('map', data);
  const waterfall = initWaterfall('waterfall-canvas', data);
  const ui = initUI();
  const sim = createSimulation(data, { map, waterfall, ui });

  sim.start();

  document.getElementById('btn-play').addEventListener('click', () => sim.play());
  document.getElementById('btn-pause').addEventListener('click', () => sim.pause());
  document.getElementById('speed-select').addEventListener('change', (e) => {
    sim.setSpeed(parseFloat(e.target.value));
  });
}

boot();
