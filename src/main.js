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
    setupTrafficSimulatorMapInteractions(map, sim);
  });

  const mapHint = document.getElementById('traffic-map-hint');
  if (mapHint) {
    mapHint.textContent = sim.isRoadOk()
      ? 'Double-click the map to add a vehicle (snapped to SR-190). Click a marker to select; drag the marker to reposition. Pan: right-drag or two fingers.'
      : 'Road centerlines are unavailable: vehicles follow fiber index. Double-click map to add; drag markers to move along the fiber.';
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

/**
 * Narrow screens: stack map + waterfall, move sidebar below with tab bar
 * (Map | Data | Feed) so controls remain reachable without cramming one column.
 */
function initResponsiveLayout(map, waterfall) {
  const app = document.getElementById('app');
  const tabbar = document.getElementById('mobile-tabbar');
  const sidebar = document.getElementById('sidebar');
  if (!app || !tabbar || !sidebar) return;

  const mobileMq = window.matchMedia('(max-width: 768px), (max-width: 900px) and (max-height: 520px)');

  function setMobileTab(tab) {
    const allowed = new Set(['map', 'data', 'feed']);
    const t = allowed.has(tab) ? tab : 'map';
    sidebar.dataset.mobileTab = t;
    sidebar.classList.remove('mobile-tab-map', 'mobile-tab-data', 'mobile-tab-feed');
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
      const current = sidebar.dataset.mobileTab;
      setMobileTab(current === 'map' || current === 'data' || current === 'feed' ? current : 'map');
    } else {
      sidebar.classList.remove('mobile-tab-map', 'mobile-tab-data', 'mobile-tab-feed');
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
