const MAX_EVENTS = 60;

export function initUI() {
  const el = (id) => document.getElementById(id);

  function updateStats(vehicles, anomalies) {
    const upCount = vehicles.filter((v) => v.direction === 'up_canyon').length;
    const downCount = vehicles.filter((v) => v.direction === 'down_canyon').length;
    const avgSpeed = vehicles.length > 0
      ? Math.round(vehicles.reduce((s, v) => s + v.speedMph, 0) / vehicles.length)
      : 0;

    el('stat-vehicles').textContent = vehicles.length;
    el('stat-speed').textContent = vehicles.length > 0 ? avgSpeed : '\u2014';
    el('stat-up').textContent = upCount;
    el('stat-down').textContent = downCount;
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
      const dirClass = data.direction === 'up_canyon' ? 'up-canyon' : 'down-canyon';
      const dirLabel = data.direction === 'up_canyon' ? 'Up Canyon \u25B2' : 'Down Canyon \u25BC';
      const typeLabel = data.vehicleType === 'truck' ? 'Truck' : 'Vehicle';
      li.className = dirClass;
      li.innerHTML = `
        <span class="event-time">${time}</span>
        <span class="event-type vehicle">${typeLabel}</span> ${data.id}<br/>
        SR-190 MP ${data.currentMilepost.toFixed(1)} &bull; ${dirLabel} &bull; ${data.speedMph} mph
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
