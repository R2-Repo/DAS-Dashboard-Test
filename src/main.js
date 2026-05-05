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
import { createHazardController } from './hazard-controller.js';
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
    const hazardPanel = document.getElementById('hazard-panel');
    let hazardsRef = { disarm: () => {} };
    const palette = createVehiclePalette({
      map,
      sim,
      paletteRoot,
      onVehicleArm: () => hazardsRef.disarm?.(),
      onVehicleDragStart: () => hazardsRef.disarm?.(),
      onAfterVehiclePlaced: () => hazardsRef.disarm?.(),
    });
    const hazards = createHazardController({ map, sim, panelRoot: hazardPanel, vehiclePalette: palette });
    hazardsRef = hazards;
    setupTrafficSimulatorMapInteractions(map, sim, {
      tryConsumeMapClick: (e) => palette.tryConsumeMapClick(e) || hazards.tryConsumeMapClick(e),
      isMassHazardDrawing: () => hazards.isMassExtending(),
    });
  });

  sim.start();
  sim.syncFleetPanel();

  const mapHint = document.getElementById('traffic-map-hint');
  if (mapHint) {
    mapHint.textContent = sim.isRoadOk()
      ? 'Hazards: tap crash / rock / snow, adjust size, then tap the map (crash) or drag along the route (rock & snow on desktop). Clear removes hazards too. Vehicles: drag or tap an icon then tap the map.'
      : 'Drag an icon onto the map (snaps to fiber). On a phone: tap an icon, then tap the map.';
  }

  const demoBtn = document.getElementById('btn-demo-fleet');
  const demoPanel = document.getElementById('demo-fleet-panel');
  const demoRunBtn = document.getElementById('btn-demo-fleet-run');
  const demoSlider = document.getElementById('demo-fleet-intensity');
  const demoCountLabel = document.getElementById('demo-fleet-count-label');

  function setDemoPanelOpen(open) {
    if (!demoPanel || !demoBtn) return;
    demoPanel.hidden = !open;
    demoBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  demoBtn?.addEventListener('click', () => {
    const next = demoPanel?.hidden !== false;
    setDemoPanelOpen(next);
  });

  demoSlider?.addEventListener('input', () => {
    const n = Number(demoSlider.value);
    if (!Number.isFinite(n)) return;
    if (demoCountLabel) demoCountLabel.textContent = String(Math.round(n));
    demoSlider.setAttribute('aria-valuetext', `${Math.round(n)} vehicles`);
  });

  demoRunBtn?.addEventListener('click', () => {
    const n = Number(demoSlider?.value ?? 12);
    sim.applyQuickFleet(Number.isFinite(n) ? n : 12);
    sim.syncFleetPanel();
    setDemoPanelOpen(false);
  });

  document.getElementById('btn-clear-fleet')?.addEventListener('click', () => {
    sim.clearFleet();
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
    const laneBtn = e.target.closest?.('[data-set-lane]');
    if (laneBtn) {
      const row = laneBtn.closest?.('[data-vehicle-id]');
      const id = row?.getAttribute('data-vehicle-id');
      const lk = laneBtn.getAttribute('data-set-lane');
      if (id && (lk === 'eb' || lk === 'wb')) {
        sim.setVehicleLaneKey(id, lk);
        sim.syncFleetPanel();
      }
      return;
    }
    const selBtn = e.target.closest?.('[data-select-vehicle-id]');
    if (selBtn) {
      const id = selBtn.getAttribute('data-select-vehicle-id');
      if (id) {
        sim.setSelectedVehicleId(id);
        sim.syncFleetPanel();
      }
    }
  });

  document.getElementById('fleet-list')?.addEventListener('input', (e) => {
    const inp = e.target;
    if (!(inp instanceof HTMLElement) || inp.tagName !== 'INPUT' || !inp.classList.contains('fleet-row-speed')) return;
    const row = inp.closest?.('[data-vehicle-id]');
    const id = row?.getAttribute('data-vehicle-id');
    if (!id) return;
    const mph = Number(inp.value);
    if (!Number.isFinite(mph)) return;
    inp.setAttribute('aria-valuetext', `${Math.round(mph)} miles per hour`);
    sim.setVehicleDesiredSpeed(id, mph);
  });
}

const MOBILE_TAB_CLASSES = ['mobile-tab-map', 'mobile-tab-stats'];

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
 * Narrow screens: stack map + waterfall; bottom tab bar switches Map | Stats.
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
    const allowed = new Set(['map', 'stats']);
    let t = allowed.has(tab) ? tab : 'map';
    if (t === 'data' || t === 'fleet' || t === 'feed') t = 'map';

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
      if (current === 'data' || current === 'fleet' || current === 'feed') current = 'map';
      if (!['map', 'stats'].includes(current)) current = 'map';
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
