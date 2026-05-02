import { updateMapVehicles, updateMapAnomalies } from './map.js';

let vehicles = [];
let anomalies = [];
let nextVehicleId = 1;
let nextAnomalyId = 1;
let tickCount = 0;
let running = true;
let speedMultiplier = 1;
let intervalId = null;

export function createSimulation(data, targets) {
  const { channels, config } = data;
  const totalChannels = channels.length;
  const tickMs = config.simulation_tick_ms || 500;
  const spawnInterval = config.vehicle_spawn_interval_ticks || 6;
  const maxVehicles = config.max_vehicles || 10;

  function tick() {
    if (!running) return;
    tickCount++;

    // Spawn vehicles
    if (tickCount % spawnInterval === 0 && vehicles.length < maxVehicles) {
      spawnVehicle(totalChannels);
    }

    // Occasionally spawn anomalies
    if (tickCount % 40 === 0 && anomalies.length < 3) {
      spawnAnomaly(totalChannels);
    }

    // Update vehicles
    vehicles.forEach((v) => {
      v.channelIdx += v.direction === 'up_canyon' ? v.channelSpeed : -v.channelSpeed;
    });
    vehicles = vehicles.filter((v) => v.channelIdx >= 0 && v.channelIdx < totalChannels);

    // Update anomalies (decay)
    anomalies.forEach((a) => { a.ttl--; });
    anomalies = anomalies.filter((a) => a.ttl > 0);

    // Build waterfall row
    const row = new Float32Array(totalChannels);
    // Background noise
    for (let i = 0; i < totalChannels; i++) {
      row[i] = Math.random() * 0.05;
    }
    // Vehicle signatures (diagonal streaks)
    vehicles.forEach((v) => {
      const center = Math.floor(v.channelIdx);
      const spread = 3 + Math.floor(v.signalStrength * 4);
      for (let d = -spread; d <= spread; d++) {
        const idx = center + d;
        if (idx >= 0 && idx < totalChannels) {
          const falloff = 1 - Math.abs(d) / (spread + 1);
          row[idx] = Math.min(1, row[idx] + v.signalStrength * falloff);
        }
      }
    });
    // Anomaly signatures (broad bursts)
    anomalies.forEach((a) => {
      const intensity = a.intensity * Math.min(1, a.ttl / 10);
      for (let i = a.startChannel; i <= a.endChannel && i < totalChannels; i++) {
        const jitter = 0.5 + Math.random() * 0.5;
        row[i] = Math.min(1, row[i] + intensity * jitter);
      }
    });

    targets.waterfall.pushRow(row);
    targets.waterfall.render();

    // Build map features
    const vehicleFeatures = vehicles.map((v) => {
      const ch = channels[Math.min(Math.floor(v.channelIdx), totalChannels - 1)];
      v.currentMilepost = ch.milepost;
      return {
        type: 'Feature',
        properties: {
          id: v.id,
          direction: v.direction,
          speed: v.speedMph,
          type: v.vehicleType,
          milepost: ch.milepost.toFixed(1),
        },
        geometry: { type: 'Point', coordinates: [ch.lon, ch.lat] },
      };
    });

    const anomalyFeatures = anomalies.map((a) => {
      const midIdx = Math.floor((a.startChannel + a.endChannel) / 2);
      const ch = channels[Math.min(midIdx, totalChannels - 1)];
      return {
        type: 'Feature',
        properties: {
          id: a.id,
          subtype: a.subtype,
          intensity: a.intensity,
          milepost: ch.milepost.toFixed(1),
        },
        geometry: { type: 'Point', coordinates: [ch.lon, ch.lat] },
      };
    });

    updateMapVehicles(targets.map, vehicleFeatures);
    updateMapAnomalies(targets.map, anomalyFeatures);

    // Update UI
    targets.ui.updateStats(vehicles, anomalies);
    if (tickCount % 2 === 0 && vehicles.length > 0) {
      const v = vehicles[Math.floor(Math.random() * vehicles.length)];
      targets.ui.addEvent('vehicle', v);
    }
    if (anomalies.length > 0 && tickCount % 10 === 0) {
      const a = anomalies[0];
      const midCh = channels[Math.floor((a.startChannel + a.endChannel) / 2)];
      targets.ui.addEvent('anomaly', { ...a, milepost: midCh.milepost });
    }
  }

  function start() {
    intervalId = setInterval(tick, tickMs / speedMultiplier);
    targets.ui.updateChannelCount(totalChannels);
  }

  function play() {
    running = true;
    document.getElementById('btn-play').classList.add('active');
    document.getElementById('btn-pause').classList.remove('active');
  }

  function pause() {
    running = false;
    document.getElementById('btn-play').classList.remove('active');
    document.getElementById('btn-pause').classList.add('active');
  }

  function setSpeed(mult) {
    speedMultiplier = mult;
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(tick, tickMs / speedMultiplier);
  }

  return { start, play, pause, setSpeed };
}

function spawnVehicle(totalChannels) {
  const direction = Math.random() > 0.5 ? 'up_canyon' : 'down_canyon';
  const speedMph = 25 + Math.floor(Math.random() * 40);
  const channelSpeed = 2 + Math.floor(speedMph / 15);

  vehicles.push({
    id: `VEH-${String(nextVehicleId++).padStart(4, '0')}`,
    direction,
    channelIdx: direction === 'up_canyon' ? 0 : totalChannels - 1,
    channelSpeed,
    speedMph,
    vehicleType: Math.random() > 0.75 ? 'truck' : 'car',
    signalStrength: 0.3 + Math.random() * 0.5,
    currentMilepost: 0,
  });
}

function spawnAnomaly(totalChannels) {
  const start = Math.floor(Math.random() * (totalChannels - 100));
  const subtypes = ['rockfall_possible', 'vibration_burst', 'impact_sequence', 'broad_disturbance'];

  anomalies.push({
    id: `HAZ-${String(nextAnomalyId++).padStart(4, '0')}`,
    subtype: subtypes[Math.floor(Math.random() * subtypes.length)],
    startChannel: start,
    endChannel: start + 20 + Math.floor(Math.random() * 60),
    intensity: 0.5 + Math.random() * 0.5,
    ttl: 15 + Math.floor(Math.random() * 20),
  });
}
