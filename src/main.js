import { initMap } from './map.js';
import { startSimulation } from './simulation.js';

document.addEventListener('DOMContentLoaded', () => {
  const map = initMap('map');
  startSimulation(map);
});
