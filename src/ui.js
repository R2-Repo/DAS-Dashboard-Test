/**
 * Sidebar UI — live stats, fleet controls, event feed.
 */
import { vehicleSpec } from './vehicle-model.js';

const MAX_EVENTS = 60;

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
      const lane = data.laneKey === 'wb' ? 'WB (down canyon)' : 'EB (up canyon)';
      const dirClass = data.laneKey === 'eb' ? 'up-canyon' : 'down-canyon';
      const typeLabel = vehicleSpec(data.vehicleType).label;
      li.className = dirClass;
      li.innerHTML = `
        <span class="event-time">${time}</span>
        <span class="event-type vehicle">${typeLabel}</span> ${data.id}<br/>
        SR-190 MP ${data.currentMilepost.toFixed(1)} &bull; ${lane} &bull; ${Math.round(data.speedMph)} mph
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
    const tbody = el('fleet-table-body');
    if (!tbody || !sim) return;
    tbody.replaceChildren();
    const list = sim.getVehicles();
    const sel = sim.getSelectedVehicleId();

    for (const v of list) {
      const tr = document.createElement('tr');
      if (v.id === sel) tr.classList.add('fleet-row-selected');
      tr.dataset.vehicleId = v.id;
      const lane = v.laneKey === 'wb' ? 'WB' : 'EB';
      tr.innerHTML = `
        <td><code class="fleet-id">${v.id}</code></td>
        <td>${lane}</td>
        <td>${vehicleSpec(v.vehicleType).label}</td>
        <td class="fleet-speed">${Math.round(v.speedMph)}</td>
        <td class="fleet-mp">${v.currentMilepost != null ? v.currentMilepost.toFixed(1) : '\u2014'}</td>
        <td><button type="button" class="fleet-remove-btn" data-remove-id="${v.id}" title="Remove">×</button></td>
      `;
      tbody.appendChild(tr);
    }

    const speedInput = el('fleet-speed-input');
    const typeSelect = el('fleet-type-select');
    const applyBtn = el('fleet-apply-btn');
    const selected = sel ? list.find((v) => v.id === sel) : null;
    if (speedInput) {
      speedInput.disabled = !selected;
      if (selected) speedInput.value = String(Math.round(selected.desiredSpeedMph));
    }
    if (typeSelect) {
      typeSelect.disabled = !selected;
      if (selected) typeSelect.value = selected.vehicleType;
    }
    if (applyBtn) applyBtn.disabled = !selected;
  }

  return { updateStats, updateChannelCount, addEvent, refreshFleetPanel };
}
