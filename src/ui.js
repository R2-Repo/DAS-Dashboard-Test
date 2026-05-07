/**
 * Sidebar UI — live stats, fleet controls.
 */
import { fleetDisplayNumberFromId } from './fleet-display-id.js';
import { normalizeVehicleType, vehicleSpec } from './vehicle-model.js';

const VEHICLE_ICON = {
  bicycle: '🚴',
  motorcycle: '🏍',
  car: '🚗',
  truck: '🛻',
  semi_truck: '🚌',
};

function vehicleIcon(type) {
  const key = normalizeVehicleType(type);
  return VEHICLE_ICON[key] ?? VEHICLE_ICON.car;
}

export function initUI() {
  const el = (id) => document.getElementById(id);

  function updateStats(vehicles, hazards) {
    const ebCount = vehicles.filter((v) => v.laneKey === 'eb').length;
    const wbCount = vehicles.filter((v) => v.laneKey === 'wb').length;

    el('stat-vehicles').textContent = vehicles.length;
    el('stat-up').textContent = ebCount;
    el('stat-down').textContent = wbCount;
    el('stat-anomalies').textContent = hazards.length;
  }

  function updateFleetMileposts(sim) {
    const listEl = el('fleet-list');
    if (!listEl || !sim) return;
    const byId = new Map(sim.getVehicles().map((v) => [v.id, v]));
    for (const row of listEl.querySelectorAll('[data-vehicle-id]')) {
      const id = row.getAttribute('data-vehicle-id');
      const v = byId.get(id);
      if (!v) continue;
      const mpEl = row.querySelector('.fleet-row-mp');
      if (mpEl) {
        mpEl.textContent =
          v.currentMilepost != null ? `MP ${v.currentMilepost.toFixed(1)}` : 'MP \u2014';
      }
      const mphEl = row.querySelector('.fleet-row-mph');
      if (mphEl) mphEl.textContent = `${Math.round(v.speedMph)} mph`;
      const speedInp = row.querySelector('.fleet-row-speed');
      if (speedInp && document.activeElement !== speedInp) {
        const want = String(Math.round(v.desiredSpeedMph));
        if (speedInp.value !== want) speedInp.value = want;
      }
      row.querySelectorAll('[data-set-lane]').forEach((btn) => {
        const lk = btn.getAttribute('data-set-lane');
        btn.classList.toggle('fleet-dir-btn-active', lk === v.laneKey);
      });
      const sel = sim.getSelectedVehicleId();
      row.classList.toggle('fleet-row-selected', id === sel);
    }
  }

  function refreshFleetPanel(sim) {
    const listEl = el('fleet-list');
    if (!listEl || !sim) return;
    listEl.replaceChildren();
    const list = sim.getVehicles();
    const sel = sim.getSelectedVehicleId();

    for (const v of list) {
      const row = document.createElement('div');
      row.className = 'fleet-row';
      row.dataset.vehicleId = v.id;
      if (v.id === sel) row.classList.add('fleet-row-selected');

      const selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.className = 'fleet-row-select';
      selectBtn.dataset.selectVehicleId = v.id;
      const icon = vehicleIcon(v.vehicleType);
      const num = fleetDisplayNumberFromId(v.id);
      const numLaneClass = v.laneKey === 'wb' ? 'fleet-row-num-wb' : 'fleet-row-num-eb';
      selectBtn.innerHTML = `
        <span class="fleet-row-num ${numLaneClass}" aria-hidden="true">${num}</span>
        <span class="fleet-row-icon" aria-hidden="true">${icon}</span>
        <span class="fleet-row-meta">
          <span class="fleet-row-line1">${vehicleSpec(v.vehicleType).label}</span>
          <span class="fleet-row-line2"><span class="fleet-row-mp">MP ${v.currentMilepost != null ? v.currentMilepost.toFixed(1) : '\u2014'}</span> · <span class="fleet-row-mph">${Math.round(v.speedMph)} mph</span></span>
        </span>
      `;

      const controls = document.createElement('div');
      controls.className = 'fleet-row-controls';

      const dirGroup = document.createElement('div');
      dirGroup.className = 'fleet-dir-group';
      dirGroup.setAttribute('role', 'group');
      dirGroup.setAttribute('aria-label', 'Direction');

      for (const lk of ['eb', 'wb']) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'fleet-dir-btn';
        if (lk === 'eb') b.classList.add('fleet-dir-btn-eb');
        else b.classList.add('fleet-dir-btn-wb');
        b.dataset.setLane = lk;
        b.textContent = lk.toUpperCase();
        b.title = lk === 'eb' ? 'Eastbound (up canyon)' : 'Westbound (down canyon)';
        if (v.laneKey === lk) b.classList.add('fleet-dir-btn-active');
        dirGroup.appendChild(b);
      }

      const speedWrap = document.createElement('label');
      speedWrap.className = 'fleet-row-speed-wrap';
      const speedInp = document.createElement('input');
      speedInp.type = 'range';
      speedInp.className = 'fleet-row-speed';
      speedInp.min = '0';
      speedInp.max = '85';
      speedInp.step = '1';
      speedInp.value = String(Math.round(v.desiredSpeedMph));
      speedInp.setAttribute(
        'aria-valuetext',
        `${Math.round(v.desiredSpeedMph)} miles per hour`,
      );
      speedInp.setAttribute('aria-label', `Target speed for ${v.id}`);
      speedWrap.appendChild(speedInp);

      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'fleet-row-remove';
      rm.dataset.removeId = v.id;
      rm.title = 'Remove';
      rm.setAttribute('aria-label', `Remove ${v.id}`);
      rm.textContent = '\u00D7';

      controls.appendChild(dirGroup);
      controls.appendChild(speedWrap);
      controls.appendChild(rm);

      row.appendChild(selectBtn);
      row.appendChild(controls);
      listEl.appendChild(row);
    }
  }

  return { updateStats, refreshFleetPanel, updateFleetMileposts };
}
