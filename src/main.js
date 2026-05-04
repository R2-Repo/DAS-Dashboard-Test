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
import { runSplashGate } from './splash.js';

registerSW({ immediate: true });

async function boot() {
  const data = await runSplashGate(loadData);
  const map = initMap('map', data);
  const waterfall = initWaterfall('waterfall-canvas', data);
  const ui = initUI();
  const sim = createSimulation(data, { map, waterfall, ui });
  waterfall.setPlotChannelPickCallback?.((channelIndex) => {
    sim.focusMapOnChannel(channelIndex);
  });

  initResponsiveLayout(map, waterfall);

  map.on('load', () => {
    const paletteRoot = document.getElementById('vehicle-palette');
    const palette = createVehiclePalette({ map, sim, paletteRoot });
    setupTrafficSimulatorMapInteractions(map, sim, {
      tryConsumeMapClick: (e) => palette.tryConsumeMapClick(e),
    });
  });

  sim.start();
  sim.syncFleetPanel();

  const defaultLane = sim.getDefaultPlacementLane?.() ?? 'auto';
  document.querySelectorAll('[data-placement-lane]').forEach((b) => {
    b.classList.toggle('placement-lane-btn-active', b.getAttribute('data-placement-lane') === defaultLane);
  });

  const mapHint = document.getElementById('traffic-map-hint');
  if (mapHint) {
    mapHint.textContent = sim.isRoadOk()
      ? 'Drag a vehicle icon onto the map, or tap an icon then tap the map. Auto / EB / WB sets the lane for new drops. Select a vehicle to change speed; drag on the map to move.'
      : 'Drag an icon onto the map (snaps to fiber). On a phone: tap an icon, then tap the map.';
  }

  document.querySelector('.placement-lane-group')?.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-placement-lane]');
    if (!btn) return;
    const lane = btn.getAttribute('data-placement-lane');
    if (lane !== 'auto' && lane !== 'eb' && lane !== 'wb') return;
    sim.setDefaultPlacementLane(lane);
    document.querySelectorAll('[data-placement-lane]').forEach((b) => {
      b.classList.toggle('placement-lane-btn-active', b.getAttribute('data-placement-lane') === lane);
    });
  });

  document.getElementById('btn-demo-fleet')?.addEventListener('click', () => {
    sim.applyQuickFleet();
    sim.syncFleetPanel();
  });
  document.getElementById('btn-clear-fleet')?.addEventListener('click', () => {
    sim.clearFleet();
    sim.syncFleetPanel();
  });

  function applySelectedVehicleSpeed() {
    const id = sim.getSelectedVehicleId();
    if (!id) return;
    const mph = parseFloat(document.getElementById('fleet-speed-input')?.value ?? '38');
    if (Number.isFinite(mph)) sim.setVehicleDesiredSpeed(id, mph);
    sim.syncFleetPanel();
  }

  document.getElementById('fleet-apply-btn')?.addEventListener('click', () => {
    applySelectedVehicleSpeed();
  });

  const speedSlider = document.getElementById('fleet-speed-slider');
  const speedValueEl = document.getElementById('fleet-speed-value');
  const speedInput = document.getElementById('fleet-speed-input');

  speedSlider?.addEventListener('input', () => {
    const id = sim.getSelectedVehicleId();
    if (!id) return;
    const mph = Number(speedSlider.value);
    if (!Number.isFinite(mph)) return;
    if (speedInput) speedInput.value = String(Math.round(mph));
    if (speedValueEl) speedValueEl.textContent = String(Math.round(mph));
    speedSlider.setAttribute('aria-valuetext', `${Math.round(mph)} miles per hour`);
    sim.setVehicleDesiredSpeed(id, mph);
    sim.syncFleetPanel();
  });

  speedInput?.addEventListener('change', () => {
    applySelectedVehicleSpeed();
  });

  speedInput?.addEventListener('input', () => {
    const id = sim.getSelectedVehicleId();
    if (!id) return;
    const mph = parseFloat(speedInput.value);
    if (!Number.isFinite(mph)) return;
    if (speedSlider) {
      speedSlider.value = String(Math.max(0, Math.min(85, Math.round(mph))));
      speedSlider.setAttribute('aria-valuetext', `${Math.round(mph)} miles per hour`);
    }
    if (speedValueEl) speedValueEl.textContent = String(Math.round(Math.max(0, Math.min(85, mph))));
  });

  document.getElementById('fleet-type-inline')?.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-set-vehicle-type]');
    if (!btn) return;
    const id = sim.getSelectedVehicleId();
    if (!id) return;
    sim.setVehicleType(id, btn.getAttribute('data-set-vehicle-type') ?? 'car');
    sim.syncFleetPanel();
  });

  document.getElementById('fleet-list')?.addEventListener('click', (e) => {
    const rm = e.target.closest?.('[data-remove-id]');
    if (rm) {
      const rid = rm.getAttribute('data-remove-id');
      if (rid) {
        sim.removeVehicle(rid);
        sim.syncFleetPanel();
      }
      return;
    }
    const row = e.target.closest?.('[data-vehicle-id]');
    if (row) {
      sim.setSelectedVehicleId(row.getAttribute('data-vehicle-id'));
      sim.syncFleetPanel();
    }
  });

}

const MOBILE_TAB_CLASSES = ['mobile-tab-map', 'mobile-tab-stats', 'mobile-tab-feed'];

/**
 * Move `#traffic-control-panel` under the waterfall on mobile Map tab so it stacks in document
 * order (avoids overlap with the map canvas). Restore to the sidebar for desktop and other tabs.
 */
function syncTrafficPanelHost(mobile, tab) {
  const panel = document.getElementById('traffic-control-panel');
  const hostDesktop = document.getElementById('traffic-panel-host-desktop');
  const hostMobile = document.getElementById('traffic-panel-host-mobile');
  if (!panel || !hostDesktop || !hostMobile) return;

  const dockUnderWaterfall = mobile && tab === 'map';
  const target = dockUnderWaterfall ? hostMobile : hostDesktop;
  if (panel.parentElement !== target) {
    target.appendChild(panel);
  }
  hostMobile.toggleAttribute('aria-hidden', hostMobile.childElementCount === 0);
}

/**
 * Narrow screens: stack map + waterfall; bottom tab bar switches Map | Stats | Feed.
 * Traffic controls sit on the Map tab under the waterfall (thumb reach).
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
    const allowed = new Set(['map', 'stats', 'feed']);
    let t = allowed.has(tab) ? tab : 'map';
    if (t === 'data' || t === 'fleet') t = 'map';

    sidebar.dataset.mobileTab = t;
    sidebar.classList.remove(...MOBILE_TAB_CLASSES);
    sidebar.classList.add(`mobile-tab-${t}`);
    tabbar.querySelectorAll('.mobile-tab').forEach((btn) => {
      btn.setAttribute('aria-selected', btn.dataset.mobileTab === t ? 'true' : 'false');
    });
    syncTrafficPanelHost(mobileMq.matches, t);
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
      if (current === 'data' || current === 'fleet') current = 'map';
      if (!['map', 'stats', 'feed'].includes(current)) current = 'map';
      setMobileTab(current);
    } else {
      syncTrafficPanelHost(false, 'map');
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
