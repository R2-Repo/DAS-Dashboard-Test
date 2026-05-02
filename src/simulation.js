/**
 * DAS simulation engine — physically realistic traffic + anomaly generation.
 *
 * Physics model:
 *   Channel spacing:  2 m
 *   Tick interval:    100 ms (10 Hz)
 *   1 channel/tick  = 20 m/s ≈ 45 mph
 *
 *   SR-190 Big Cottonwood Canyon:
 *     - 2-lane mountain road, speed limit 35–45 mph
 *     - Uphill (up canyon) traffic: 25–45 mph, slower on curves
 *     - Downhill (down canyon) traffic: 30–50 mph
 *     - Trucks: 20–35 mph
 *     - Platoons form behind slow vehicles
 *     - Traffic varies by time of day
 *
 *   Vehicle DAS signature:
 *     - Occupies 1–3 channels at any instant (tire contact + chassis vibration)
 *     - Trucks are wider (2–4 channels) and stronger signal
 *     - Signal strength varies with vehicle weight, speed, road surface
 *     - The diagonal slope in waterfall = speed (channels/tick)
 */

import { updateMapVehicles, updateMapAnomalies } from './map.js';

const CHANNEL_SPACING_M = 2.0;
const TICK_MS = 100;
const MS_PER_S = 1000;
const MPH_TO_MS = 0.44704;

let vehicles = [];
let anomalies = [];
let nextVehicleId = 1;
let nextAnomalyId = 1;
let tickCount = 0;
let running = true;
let speedMultiplier = 1;
let intervalId = null;

function mphToChannelsPerTick(mph) {
  const metersPerSec = mph * MPH_TO_MS;
  const metersPerTick = metersPerSec * (TICK_MS / MS_PER_S);
  return metersPerTick / CHANNEL_SPACING_M;
}

export function createSimulation(data, targets) {
  const { channels } = data;
  const totalChannels = channels.length;
  const channelBias = targets.waterfall.channelBias;

  // Temporal noise state: slowly drifting per-channel noise (Brownian)
  const noiseState = new Float32Array(totalChannels);
  // Spatially correlated noise seed (updated each tick)
  let noiseSeed = Math.random() * 1000;

  function tick() {
    if (!running) return;
    tickCount++;

    // === Traffic spawning ===
    // SR-190 carries ~5000-8000 AADT on a busy day.
    // Peak hour: ~400-600 veh/hr each direction → ~1 vehicle every 6-10 seconds
    // At 10 Hz that's roughly every 60-100 ticks per direction.
    // We spawn for both directions combined.
    if (tickCount % randomInt(30, 60) === 0) {
      spawnVehicle(totalChannels);
    }
    // Early burst: seed several vehicles immediately so diagonals are visible fast
    if (tickCount <= 50 && tickCount % 5 === 0) {
      spawnVehicle(totalChannels);
    }
    // Platoon spawning: on a 2-lane canyon road, platoons form behind slow trucks
    if (tickCount % randomInt(120, 250) === 0) {
      const platoonSize = randomInt(2, 5);
      const dir = Math.random() > 0.5 ? 'up_canyon' : 'down_canyon';
      const leadSpeed = randomInt(25, 35); // slow leader
      for (let p = 0; p < platoonSize; p++) {
        spawnVehicle(totalChannels, {
          forceDirection: dir,
          forceSpeed: leadSpeed + (p === 0 ? 0 : randomInt(-2, 3)),
          offset: p * randomInt(20, 50),
        });
      }
    }

    // Anomaly spawning (rare)
    if (tickCount % randomInt(300, 600) === 0 && anomalies.length < 2) {
      spawnAnomaly(totalChannels);
    }

    // === Update vehicle positions ===
    for (const v of vehicles) {
      // Slight speed variation per tick (road surface, curves)
      const jitter = 1 + (Math.random() - 0.5) * 0.04;
      const delta = v.channelsPerTick * jitter;
      v.channelPos += v.direction === 'up_canyon' ? delta : -delta;
    }
    vehicles = vehicles.filter((v) => v.channelPos >= -10 && v.channelPos < totalChannels + 10);

    // Decay anomalies
    for (const a of anomalies) a.ttl--;
    anomalies = anomalies.filter((a) => a.ttl > 0);

    // === Build waterfall row ===
    const row = new Float32Array(totalChannels);
    noiseSeed += 0.1;

    // 1. Background noise: per-channel bias + temporal drift + uncorrelated random
    for (let i = 0; i < totalChannels; i++) {
      // Brownian drift (temporal correlation between rows)
      noiseState[i] += (Math.random() - 0.5) * 0.008;
      noiseState[i] *= 0.97; // mean-revert
      // Spatial correlation: nearby channels have correlated noise
      const spatial = 0.005 * Math.sin(i * 0.01 + noiseSeed) + 0.003 * Math.sin(i * 0.037 + noiseSeed * 1.7);
      // Combine: bias + drift + spatial + white noise
      row[i] = Math.max(0, channelBias[i] + noiseState[i] + spatial + Math.random() * 0.015);
    }

    // 2. Vehicle signatures: thin sharp lines
    for (const v of vehicles) {
      const center = v.channelPos;
      const ci = Math.floor(center);
      const frac = center - ci; // sub-channel position

      // Core signature width depends on vehicle type
      const halfWidth = v.vehicleType === 'truck' ? 2 : 1;
      const peakStrength = v.signalStrength;

      for (let d = -halfWidth - 1; d <= halfWidth + 1; d++) {
        const idx = ci + d;
        if (idx < 0 || idx >= totalChannels) continue;

        // Triangular/gaussian-like profile centered on sub-channel position
        const dist = Math.abs(d - frac);
        let amplitude;
        if (dist < 0.5) {
          amplitude = peakStrength; // core
        } else if (dist < 1.5) {
          amplitude = peakStrength * (1.5 - dist); // shoulder
        } else if (dist < 2.5) {
          amplitude = peakStrength * 0.15 * (2.5 - dist); // faint wing
        } else {
          continue;
        }

        // Add slight per-tick amplitude jitter (road texture)
        amplitude *= 0.85 + Math.random() * 0.3;
        row[idx] = Math.min(1.0, row[idx] + amplitude);
      }
    }

    // 3. Anomaly signatures: spatially broad, temporally decaying, irregular
    for (const a of anomalies) {
      const decay = Math.min(1, a.ttl / a.initialTtl);
      const baseIntensity = a.intensity * decay;
      for (let i = a.startChannel; i <= a.endChannel && i < totalChannels; i++) {
        if (i < 0) continue;
        // Irregular spatial pattern
        const spatialVar = 0.3 + 0.7 * Math.abs(Math.sin(i * 0.15 + a.phase));
        const temporalVar = 0.5 + 0.5 * Math.random();
        row[i] = Math.min(1.0, row[i] + baseIntensity * spatialVar * temporalVar * 0.5);
      }
    }

    targets.waterfall.pushRow(row);
    targets.waterfall.render();

    // === Update map ===
    const vehicleFeatures = vehicles.filter((v) => {
      const ci = Math.floor(v.channelPos);
      return ci >= 0 && ci < totalChannels;
    }).map((v) => {
      const ci = Math.min(Math.max(0, Math.floor(v.channelPos)), totalChannels - 1);
      const ch = channels[ci];
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
      const midIdx = Math.min(Math.max(0, Math.floor((a.startChannel + a.endChannel) / 2)), totalChannels - 1);
      const ch = channels[midIdx];
      return {
        type: 'Feature',
        properties: { id: a.id, subtype: a.subtype, intensity: a.intensity, milepost: ch.milepost.toFixed(1) },
        geometry: { type: 'Point', coordinates: [ch.lon, ch.lat] },
      };
    });

    updateMapVehicles(targets.map, vehicleFeatures);
    updateMapAnomalies(targets.map, anomalyFeatures);

    // === Update UI ===
    targets.ui.updateStats(vehicles, anomalies);
    if (tickCount % 20 === 0 && vehicles.length > 0) {
      const v = vehicles[Math.floor(Math.random() * vehicles.length)];
      targets.ui.addEvent('vehicle', v);
    }
    if (anomalies.length > 0 && tickCount % 50 === 0) {
      const a = anomalies[0];
      const midCh = channels[Math.min(Math.floor((a.startChannel + a.endChannel) / 2), totalChannels - 1)];
      targets.ui.addEvent('anomaly', { ...a, milepost: midCh.milepost });
    }
  }

  function start() {
    // Pre-seed vehicles already in transit so diagonals appear immediately
    for (let i = 0; i < 8; i++) {
      const dir = i % 2 === 0 ? 'up_canyon' : 'down_canyon';
      spawnVehicle(totalChannels, {
        forceDirection: dir,
        startAt: Math.floor(Math.random() * totalChannels * 0.3) + (dir === 'down_canyon' ? totalChannels * 0.5 : 0),
      });
    }
    intervalId = setInterval(tick, TICK_MS / speedMultiplier);
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
    intervalId = setInterval(tick, TICK_MS / speedMultiplier);
  }

  return { start, play, pause, setSpeed };
}

// === Vehicle spawning ===

function spawnVehicle(totalChannels, opts = {}) {
  const direction = opts.forceDirection || (Math.random() > 0.5 ? 'up_canyon' : 'down_canyon');

  // Realistic speed distributions for SR-190
  let speedMph;
  const vehicleType = Math.random() > 0.82 ? 'truck' : 'car';

  if (opts.forceSpeed) {
    speedMph = opts.forceSpeed;
  } else if (vehicleType === 'truck') {
    speedMph = direction === 'up_canyon'
      ? randomInt(20, 32)  // trucks struggle uphill
      : randomInt(25, 38); // downhill with engine brake
  } else {
    speedMph = direction === 'up_canyon'
      ? randomInt(28, 48)
      : randomInt(32, 55);
  }

  const channelsPerTick = mphToChannelsPerTick(speedMph);

  // Start position: edge of fiber, with optional offset for platoon members
  let startPos;
  if (opts.startAt !== undefined) {
    startPos = opts.startAt;
  } else {
    startPos = direction === 'up_canyon' ? 0 : totalChannels - 1;
    if (opts.offset) {
      startPos += direction === 'up_canyon' ? -opts.offset : opts.offset;
    }
  }

  // Signal strength: heavier vehicles produce stronger acoustic signature
  let signalStrength;
  if (vehicleType === 'truck') {
    signalStrength = 0.55 + Math.random() * 0.40; // strong: yellow-orange-red in jet
  } else {
    signalStrength = 0.20 + Math.random() * 0.35; // moderate: cyan-green-yellow in jet
  }

  vehicles.push({
    id: `VEH-${String(nextVehicleId++).padStart(4, '0')}`,
    direction,
    channelPos: startPos,
    channelsPerTick,
    speedMph,
    vehicleType,
    signalStrength,
    currentMilepost: 0,
  });
}

// === Anomaly spawning ===

function spawnAnomaly(totalChannels) {
  const start = randomInt(200, totalChannels - 200);
  const span = randomInt(15, 80);
  const subtypes = ['rockfall_possible', 'vibration_burst', 'impact_sequence', 'broad_disturbance'];
  const ttl = randomInt(40, 120);

  anomalies.push({
    id: `HAZ-${String(nextAnomalyId++).padStart(4, '0')}`,
    subtype: subtypes[Math.floor(Math.random() * subtypes.length)],
    startChannel: start,
    endChannel: Math.min(start + span, totalChannels - 1),
    intensity: 0.4 + Math.random() * 0.5,
    ttl,
    initialTtl: ttl,
    phase: Math.random() * Math.PI * 2,
  });
}

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}
