/**
 * Application entry point.
 * Loads processed GIS data, initializes the map/waterfall/UI, and starts the traffic-first simulator.
 */
import { registerSW } from 'virtual:pwa-register';
import { initMap, setupTrafficSimulatorMapInteractions } from './map.js';
import { initWaterfall } from './waterfall.js';
import { createSimulation } from './simulation.js';
import { initUI } from './ui.js';
import { loadData } from './data-loader.js';
import { createVehiclePalette } from './vehicle-palette.js';

registerSW({ immediate: true });

async function boot() {
  const data = await loadData();
  const map = initMap('map', data);
  const waterfall = initWaterfall('waterfall-canvas', data);
  const ui = initUI();
  const sim = createSimulation(data, { map, waterfall, ui });

  initResponsiveLayout(map, waterfall);

  sim.start();
  sim.syncFleetPanel();

  map.on('load', () => {
    const paletteRoot = document.getElementById('vehicle-palette');
    const palette = createVehiclePalette({ map, sim, paletteRoot });
    setupTrafficSimulatorMapInteractions(map, sim, {
      tryConsumeMapClick: (e) => palette.tryConsumeMapClick(e),
    });
  });

  const mapHint = document.getElementById('traffic-map-hint');
  if (mapHint) {
    mapHint.textContent = sim.isRoadOk()
      ? 'Drag a vehicle type from the palette onto the map — it snaps to the nearest SR-190 lane. On touch: tap a type, then tap the map. Click a 3D block to select; drag to move. Pan: right-drag or two fingers.'
      : 'Drag a type onto the map (snaps to fiber). On touch: tap a type, then tap the map. Click a block to select; drag to move.';
  }

  document.getElementById('btn-demo-fleet')?.addEventListener('click', () => {
    sim.applyQuickFleet();
    sim.syncFleetPanel();
  });
  document.getElementById('btn-clear-fleet')?.addEventListener('click', () => {
    sim.clearFleet();
    sim.syncFleetPanel();
  });
  document.getElementById('btn-rockslide')?.addEventListener('click', () => {
    sim.triggerRockslide();
  });

  document.getElementById('fleet-apply-btn')?.addEventListener('click', () => {
    const id = sim.getSelectedVehicleId();
    if (!id) return;
    const mph = parseFloat(document.getElementById('fleet-speed-input')?.value ?? '38');
    const type = document.getElementById('fleet-type-select')?.value ?? 'car';
    if (Number.isFinite(mph)) sim.setVehicleDesiredSpeed(id, mph);
    sim.setVehicleType(id, type);
    sim.syncFleetPanel();
  });

  document.getElementById('fleet-table-body')?.addEventListener('click', (e) => {
    const rm = e.target.closest?.('[data-remove-id]');
    if (rm) {
      const rid = rm.getAttribute('data-remove-id');
      if (rid) {
        sim.removeVehicle(rid);
        sim.syncFleetPanel();
      }
      return;
    }
    const tr = e.target.closest?.('tr[data-vehicle-id]');
    if (tr) {
      sim.setSelectedVehicleId(tr.getAttribute('data-vehicle-id'));
      sim.syncFleetPanel();
    }
  });

  document.getElementById('btn-play').addEventListener('click', () => sim.play());
  document.getElementById('btn-pause').addEventListener('click', () => sim.pause());
  document.getElementById('speed-select').addEventListener('change', (e) => {
    sim.setSpeed(parseFloat(e.target.value));
  });
}

const MOBILE_TAB_CLASSES = ['mobile-tab-map', 'mobile-tab-stats', 'mobile-tab-fleet', 'mobile-tab-feed'];

/**
 * Narrow screens: stack map + waterfall; bottom tab bar switches Map | Stats | Fleet | Feed
 * so controls stay thumb-friendly without cramming one scroll.
 */
function initResponsiveLayout(map, waterfall) {
  const app = document.getElementById('app');
  const tabbar = document.getElementById('mobile-tabbar');
  const sidebar = document.getElementById('sidebar');
  if (!app || !tabbar || !sidebar) return;

  const mobileMq = window.matchMedia(
    '(max-width: 768px), (max-width: 900px) and (max-height: 560px), (max-width: 1024px) and (max-height: 480px)',
  );

  function setMobileTab(tab) {
    const allowed = new Set(['map', 'stats', 'fleet', 'feed']);
    let t = allowed.has(tab) ? tab : 'map';
    if (t === 'data') t = 'fleet';

    sidebar.dataset.mobileTab = t;
    sidebar.classList.remove(...MOBILE_TAB_CLASSES);
    sidebar.classList.add(`mobile-tab-${t}`);
    tabbar.querySelectorAll('.mobile-tab').forEach((btn) => {
      btn.setAttribute('aria-selected', btn.dataset.mobileTab === t ? 'true' : 'false');
    });
    if (t === 'map') {
      window.requestAnimationFrame(() => {
        map.resize();
        waterfall.resize?.();
      });
    }
  }

  function sync() {
    const mobile = mobileMq.matches;
    app.classList.toggle('app-mobile-layout', mobile);
    tabbar.hidden = !mobile;
    tabbar.classList.toggle('is-visible', mobile);

    if (mobile) {
      let current = sidebar.dataset.mobileTab;
      if (current === 'data') current = 'fleet';
      if (!['map', 'stats', 'fleet', 'feed'].includes(current)) current = 'map';
      setMobileTab(current);
    } else {
      sidebar.classList.remove(...MOBILE_TAB_CLASSES);
      delete sidebar.dataset.mobileTab;
      tabbar.querySelectorAll('.mobile-tab').forEach((btn) => btn.setAttribute('aria-selected', 'false'));
      window.requestAnimationFrame(() => {
        map.resize();
        waterfall.resize?.();
      });
    }
  }

  tabbar.querySelectorAll('.mobile-tab').forEach((btn) => {
    btn.addEventListener('click', () => setMobileTab(btn.dataset.mobileTab || 'map'));
  });

  mobileMq.addEventListener('change', sync);
  window.addEventListener('orientationchange', () => {
    setTimeout(sync, 200);
  });
  sync();
}

boot();
