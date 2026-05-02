const FIBER_COORDS = [
  [-111.78, 40.565],
  [-111.775, 40.57],
  [-111.77, 40.575],
  [-111.765, 40.578],
  [-111.76, 40.58],
  [-111.755, 40.583],
  [-111.75, 40.588],
  [-111.745, 40.592],
  [-111.74, 40.595],
];

let vehicles = [];
let nextVehicleId = 1;
let tickCount = 0;

export function startSimulation(map) {
  map.on('load', () => {
    map.addSource('vehicles', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    map.addLayer({
      id: 'vehicle-markers',
      type: 'circle',
      source: 'vehicles',
      paint: {
        'circle-radius': 6,
        'circle-color': '#ffeb3b',
        'circle-stroke-width': 1,
        'circle-stroke-color': '#000',
      },
    });

    setInterval(() => tick(map), 1000);
  });
}

function tick(map) {
  tickCount++;

  if (tickCount % 3 === 0 && vehicles.length < 6) {
    spawnVehicle();
  }

  vehicles.forEach((v) => {
    v.progress += v.speed;
    if (v.progress >= 1) v.progress = 1;
  });

  vehicles = vehicles.filter((v) => v.progress < 1);

  updateMapVehicles(map);
  updateStats();
  updateEventFeed();
}

function spawnVehicle() {
  const direction = Math.random() > 0.5 ? 'up_canyon' : 'down_canyon';
  vehicles.push({
    id: `veh_${String(nextVehicleId++).padStart(4, '0')}`,
    direction,
    progress: 0,
    speed: 0.02 + Math.random() * 0.03,
    speedMph: 30 + Math.floor(Math.random() * 35),
    type: Math.random() > 0.7 ? 'truck' : 'car',
  });
}

function interpolatePosition(progress, direction) {
  const coords = direction === 'up_canyon' ? FIBER_COORDS : [...FIBER_COORDS].reverse();
  const totalSegments = coords.length - 1;
  const segment = Math.min(Math.floor(progress * totalSegments), totalSegments - 1);
  const t = (progress * totalSegments) - segment;

  const [x0, y0] = coords[segment];
  const [x1, y1] = coords[segment + 1];
  return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
}

function updateMapVehicles(map) {
  const features = vehicles.map((v) => ({
    type: 'Feature',
    properties: {
      id: v.id,
      direction: v.direction,
      speed: v.speedMph,
      type: v.type,
    },
    geometry: {
      type: 'Point',
      coordinates: interpolatePosition(v.progress, v.direction),
    },
  }));

  const source = map.getSource('vehicles');
  if (source) {
    source.setData({ type: 'FeatureCollection', features });
  }
}

function updateStats() {
  const el = (id) => document.getElementById(id);
  const upCount = vehicles.filter((v) => v.direction === 'up_canyon').length;
  const downCount = vehicles.filter((v) => v.direction === 'down_canyon').length;
  const avgSpeed = vehicles.length > 0
    ? Math.round(vehicles.reduce((s, v) => s + v.speedMph, 0) / vehicles.length)
    : 0;

  el('stat-vehicles').textContent = vehicles.length;
  el('stat-speed').textContent = vehicles.length > 0 ? avgSpeed : '—';
  el('stat-up').textContent = upCount;
  el('stat-down').textContent = downCount;
}

function updateEventFeed() {
  const list = document.getElementById('event-list');
  if (vehicles.length === 0) return;

  const v = vehicles[Math.floor(Math.random() * vehicles.length)];
  const milepost = (14 + v.progress * 2).toFixed(2);
  const time = new Date().toLocaleTimeString();

  const li = document.createElement('li');
  li.innerHTML = `
    <span class="event-time">${time}</span><br/>
    ${v.type === 'truck' ? 'Truck' : 'Vehicle'} — MP ${milepost}, ${v.direction.replace('_', ' ')}, ${v.speedMph} mph
  `;

  list.prepend(li);
  if (list.children.length > 50) list.lastChild.remove();
}
