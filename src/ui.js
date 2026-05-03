/**
 * Sidebar UI — stats cards and scrolling event feed.
 *
 * Exports initUI() which returns { updateStats, updateChannelCount, addEvent }.
 * Called by the simulation engine on each tick to update live dashboard state.
 */
const MAX_EVENTS = 60;

export function initUI() {
  const el = (id) => document.getElementById(id);

  function updateStats(vehicles, anomalies) {
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
      const typeLabel = data.vehicleType === 'truck' ? 'Truck' : 'Vehicle';
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

  return { updateStats, updateChannelCount, addEvent };
}
