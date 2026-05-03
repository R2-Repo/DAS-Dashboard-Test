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

  initResponsiveLayout(map, waterfall);

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
