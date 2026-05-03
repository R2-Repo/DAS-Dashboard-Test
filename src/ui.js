/**
 * Sidebar UI — live stats, fleet controls, event feed.
 */
import { normalizeVehicleType, vehicleSpec } from './vehicle-model.js';

const MAX_EVENTS = 60;

const VEHICLE_ICON = {
  bicycle: '🚴',
  motorcycle: '🏍',
  car: '🚗',
  truck: '🛻',
  semi_truck: '🚛',
};

function vehicleIcon(type) {
  const key = normalizeVehicleType(type);
  return VEHICLE_ICON[key] ?? VEHICLE_ICON.car;
}

export function initUI() {
  const el = (id) => document.getElementById(id);

  function updateStats(vehicles, anomalies, meta = {}) {
    const ebCount = vehicles.filter((v) => v.laneKey === 'eb').length;
    const wbCount = vehicles.filter((v) => v.laneKey === 'wb').length;
    const avgSpeed = vehicles.length > 0
      ? Math.round(vehicles.reduce((s, v) => s + v.speedMph, 0) / vehicles.length)
      : 0;

    el('stat-vehicles').textContent = vehicles.length;
    el('stat-speed').textContent = vehicles.length > 0 ? avgSpeed : '\u2014';
    el('stat-up').textContent = ebCount;
    el('stat-down').textContent = wbCount;
    el('stat-anomalies').textContent = anomalies.length;

    const hz = meta.sampleRateHz ?? 10;
    el('stat-sample-rate').textContent = `${hz} Hz`;
    el('stat-sim-time').textContent = formatSimTime(meta.simTimeS ?? 0);
  }

  function formatSimTime(sec) {
    const s = Math.floor(sec);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  function updateChannelCount(count) {
    el('stat-channels').textContent = count.toLocaleString();
  }

  function addEvent(type, data) {
    const list = el('event-list');
    const li = document.createElement('li');
    const time = new Date().toLocaleTimeString();

    if (type === 'vehicle') {
      const lane = data.laneKey === 'wb' ? 'WB' : 'EB';
      const dirClass = data.laneKey === 'eb' ? 'up-canyon' : 'down-canyon';
      const icon = vehicleIcon(data.vehicleType);
      li.className = dirClass;
      li.innerHTML = `
        <span class="event-time">${time}</span>
        <span class="event-type vehicle" title="${vehicleSpec(data.vehicleType).label}">${icon}</span>
        ${data.id} · ${lane} · ${Math.round(data.speedMph)} mph · MP ${data.currentMilepost.toFixed(1)}
      `;
    } else if (type === 'anomaly') {
      li.className = 'anomaly';
      const label = data.subtype.replace(/_/g, ' ');
      li.innerHTML = `
        <span class="event-time">${time}</span>
        <span class="event-type anomaly">\u26A0 ${label}</span> ${data.id}<br/>
        SR-190 MP ${data.milepost.toFixed(1)} &bull; Intensity ${(data.intensity * 100).toFixed(0)}%
      `;
    }

    list.prepend(li);
    while (list.children.length > MAX_EVENTS) {
      list.lastChild.remove();
    }
  }

  function refreshFleetPanel(sim) {
    const listEl = el('fleet-list');
    const selectedPanel = el('fleet-selected-panel');
    if (!listEl || !sim) return;
    listEl.replaceChildren();
    const list = sim.getVehicles();
    const sel = sim.getSelectedVehicleId();

    for (const v of list) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'fleet-row';
      if (v.id === sel) row.classList.add('fleet-row-selected');
      row.dataset.vehicleId = v.id;
      const lane = v.laneKey === 'wb' ? 'WB' : 'EB';
      const icon = vehicleIcon(v.vehicleType);
      row.innerHTML = `
        <span class="fleet-row-icon" aria-hidden="true">${icon}</span>
        <span class="fleet-row-meta">
          <span class="fleet-row-line1">${lane} · ${Math.round(v.speedMph)} mph</span>
          <span class="fleet-row-line2">MP ${v.currentMilepost != null ? v.currentMilepost.toFixed(1) : '\u2014'}</span>
        </span>
        <span class="fleet-row-remove" role="presentation" data-remove-id="${v.id}" title="Remove">×</span>
      `;
      listEl.appendChild(row);
    }

    const speedInput = el('fleet-speed-input');
    const speedSlider = el('fleet-speed-slider');
    const speedValueEl = el('fleet-speed-value');
    const applyBtn = el('fleet-apply-btn');
    const selected = sel ? list.find((v) => v.id === sel) : null;

    if (selectedPanel) {
      selectedPanel.hidden = !selected;
    }
    if (speedInput) {
      if (selected) speedInput.value = String(Math.round(selected.desiredSpeedMph));
      speedInput.disabled = !selected;
    }
    if (speedSlider) {
      if (selected) {
        const v = Math.round(selected.desiredSpeedMph);
        speedSlider.value = String(v);
        speedSlider.setAttribute('aria-valuetext', `${v} miles per hour`);
      }
      speedSlider.disabled = !selected;
    }
    if (speedValueEl && selected) {
      speedValueEl.textContent = String(Math.round(selected.desiredSpeedMph));
    }
    if (speedValueEl && !selected) {
      speedValueEl.textContent = '\u2014';
    }
    if (applyBtn) {
      applyBtn.disabled = !selected;
    }

    if (selectedPanel) {
      selectedPanel.querySelectorAll('.fleet-type-btn').forEach((b) => {
        const t = b.getAttribute('data-set-vehicle-type');
        b.classList.toggle('fleet-type-btn-active', selected && t === selected.vehicleType);
      });
    }
  }

  return { updateStats, updateChannelCount, addEvent, refreshFleetPanel };
}
