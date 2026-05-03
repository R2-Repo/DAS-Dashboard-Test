/**
 * DAS simulation engine — vehicles follow road centerlines (EB = up canyon, WB = down canyon);
 * nearest fiber channel couples motion to the waterfall.
 */

import { updateMapVehicles, updateMapAnomalies } from './map.js';
import {
  buildRoadMotionModel,
  roadDistanceToChannelPos,
  curvatureAtRoadDistance,
  roadForwardSignForDirection,
  lonLatAtRoadDistance,
} from './road-geometry.js';

const CHANNEL_SPACING_M = 2.0;
const TICK_MS = 100;
const MS_PER_S = 1000;
const MPH_TO_MS = 0.44704;

/** Minimum realistic speed when curvature caps velocity (mph). */
const MIN_CURVE_SPEED_MPH = 18;

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

function curveSpeedCapMph(curvaturePerM) {
  const κ = Math.max(0, curvaturePerM);
  if (κ < 1e-8) return 120;
  const rEst = 1 / κ;
  const lateralAccelMax = 2.8;
  const vmaxMs = Math.sqrt(lateralAccelMax * Math.max(8, rEst));
  const vmaxMph = (vmaxMs / MPH_TO_MS) * 0.92;
  return Math.max(MIN_CURVE_SPEED_MPH, Math.min(120, vmaxMph));
}

function pickLaneKey() {
  return Math.random() > 0.5 ? 'eb' : 'wb';
}

/** Two-lane road: eastbound lane only carries up-canyon traffic; westbound only down-canyon. */
function directionForLane(laneKey) {
  return laneKey === 'eb' ? 'up_canyon' : 'down_canyon';
}

export function createSimulation(data, targets) {
  const { channels, road } = data;
  const totalChannels = channels.length;
  const channelBias = targets.waterfall.channelBias;
  const motion = buildRoadMotionModel(road, channels);
  const laneEb = motion.lanes.eb;
  const laneWb = motion.lanes.wb;
  const roadOk = laneEb && laneWb && laneEb.totalM > 50 && laneWb.totalM > 50;

  const noiseState = new Float32Array(totalChannels);
  let noiseSeed = Math.random() * 1000;

  function laneForVehicle(v) {
    return v.laneKey === 'eb' ? laneEb : laneWb;
  }

  function tick() {
    if (!running) return;
    tickCount++;

    if (roadOk) {
      if (tickCount % randomInt(24, 48) === 0) {
        spawnVehicle(totalChannels);
      }
      if (tickCount <= 50 && tickCount % 4 === 0) {
        spawnVehicle(totalChannels);
      }
      if (tickCount % randomInt(100, 200) === 0) {
        const platoonSize = randomInt(2, 5);
        const laneKey = pickLaneKey();
        const lane = laneKey === 'eb' ? laneEb : laneWb;
        const direction = directionForLane(laneKey);
        const fwd = roadForwardSignForDirection(lane, direction);
        const leadSpeed = randomInt(25, 35);
        const leaderS =
          fwd > 0
            ? randomInt(Math.floor(lane.totalM * 0.55), Math.floor(lane.totalM * 0.98))
            : randomInt(Math.floor(lane.totalM * 0.02), Math.floor(lane.totalM * 0.45));
        for (let p = 0; p < platoonSize; p++) {
          const spacingM = p * randomInt(25, 60);
          spawnVehicle(totalChannels, {
            forceLane: laneKey,
            forceSpeed: leadSpeed + (p === 0 ? 0 : randomInt(-2, 3)),
            startRoadM: Math.max(0, Math.min(lane.totalM, leaderS - spacingM * fwd)),
          });
        }
      }
    } else {
      if (tickCount % randomInt(30, 60) === 0) spawnVehicleLegacyFiber(totalChannels);
      if (tickCount <= 50 && tickCount % 5 === 0) spawnVehicleLegacyFiber(totalChannels);
    }

    if (tickCount % randomInt(300, 600) === 0 && anomalies.length < 2) {
      spawnAnomaly(totalChannels);
    }

    const dtEff = TICK_MS / speedMultiplier;

    for (const v of vehicles) {
      if (!roadOk || v.roadDistM === undefined) {
        const jitter = 1 + (Math.random() - 0.5) * 0.04;
        const delta = v.channelsPerTick * jitter;
        v.channelPos += v.direction === 'up_canyon' ? delta : -delta;
        continue;
      }

      const lane = laneForVehicle(v);
      const fwd = roadForwardSignForDirection(lane, v.direction);
      const curv = curvatureAtRoadDistance(lane, v.roadDistM);
      const cap = curveSpeedCapMph(curv);
      let speed = Math.min(v.desiredSpeedMph, cap);
      speed *= 0.97 + Math.random() * 0.06;
      speed = Math.max(MIN_CURVE_SPEED_MPH * 0.85, speed);

      v.speedMph = speed;
      v.channelsPerTick = mphToChannelsPerTick(speed);

      const roadSpeedMps = speed * MPH_TO_MS;
      v.roadDistM += fwd * roadSpeedMps * (dtEff / MS_PER_S);

      if (v.roadDistM < -30 || v.roadDistM > lane.totalM + 30) {
        v.dead = true;
      } else {
        v.roadDistM = Math.max(0, Math.min(lane.totalM, v.roadDistM));
      }

      v.channelPos = roadDistanceToChannelPos(lane, v.roadDistM);
      const ll = lonLatAtRoadDistance(lane, v.roadDistM);
      v.lon = ll[0];
      v.lat = ll[1];
    }

    vehicles = vehicles.filter((v) => {
      if (v.dead) return false;
      const ci = Math.floor(v.channelPos);
      return ci >= -10 && ci < totalChannels + 10;
    });

    for (const a of anomalies) a.ttl--;
    anomalies = anomalies.filter((a) => a.ttl > 0);

    const row = new Float32Array(totalChannels);
    noiseSeed += 0.1;

    for (let i = 0; i < totalChannels; i++) {
      noiseState[i] += (Math.random() - 0.5) * 0.008;
      noiseState[i] *= 0.97;
      const spatial =
        0.005 * Math.sin(i * 0.01 + noiseSeed) + 0.003 * Math.sin(i * 0.037 + noiseSeed * 1.7);
      row[i] = Math.max(
        0,
        channelBias[i] + noiseState[i] + spatial + Math.random() * 0.015,
      );
    }

    for (const v of vehicles) {
      const center = v.channelPos;
      const ci = Math.floor(center);
      const frac = center - ci;
      const halfWidth = v.vehicleType === 'truck' ? 2 : 1;
      const peakStrength = v.signalStrength;

      for (let d = -halfWidth - 1; d <= halfWidth + 1; d++) {
        const idx = ci + d;
        if (idx < 0 || idx >= totalChannels) continue;
        const dist = Math.abs(d - frac);
        let amplitude;
        if (dist < 0.5) {
          amplitude = peakStrength;
        } else if (dist < 1.5) {
          amplitude = peakStrength * (1.5 - dist);
        } else if (dist < 2.5) {
          amplitude = peakStrength * 0.15 * (2.5 - dist);
        } else {
          continue;
        }
        amplitude *= 0.85 + Math.random() * 0.3;
        row[idx] = Math.min(1.0, row[idx] + amplitude);
      }
    }

    for (const a of anomalies) {
      const decay = Math.min(1, a.ttl / a.initialTtl);
      const baseIntensity = a.intensity * decay;
      for (let i = a.startChannel; i <= a.endChannel && i < totalChannels; i++) {
        if (i < 0) continue;
        const spatialVar = 0.3 + 0.7 * Math.abs(Math.sin(i * 0.15 + a.phase));
        const temporalVar = 0.5 + 0.5 * Math.random();
        row[i] = Math.min(1.0, row[i] + baseIntensity * spatialVar * temporalVar * 0.5);
      }
    }

    targets.waterfall.pushRow(row);
    targets.waterfall.render();

    const vehicleFeatures = vehicles
      .filter((v) => {
        const ci = Math.floor(v.channelPos);
        return ci >= 0 && ci < totalChannels;
      })
      .map((v) => {
        const ci = Math.min(Math.max(0, Math.floor(v.channelPos)), totalChannels - 1);
        const ch = channels[ci];
        v.currentMilepost = ch.milepost;
        const lonLat =
          roadOk && v.lon !== undefined && v.lat !== undefined
            ? [v.lon, v.lat]
            : [ch.lon, ch.lat];
        return {
          type: 'Feature',
          properties: {
            id: v.id,
            lane: v.laneKey,
            direction: v.direction,
            speed: Math.round(v.speedMph),
            type: v.vehicleType,
            milepost: ch.milepost.toFixed(1),
          },
          geometry: { type: 'Point', coordinates: lonLat },
        };
      });

    const anomalyFeatures = anomalies.map((a) => {
      const midIdx = Math.min(
        Math.max(0, Math.floor((a.startChannel + a.endChannel) / 2)),
        totalChannels - 1,
      );
      const ch = channels[midIdx];
      return {
        type: 'Feature',
        properties: { id: a.id, subtype: a.subtype, intensity: a.intensity, milepost: ch.milepost.toFixed(1) },
        geometry: { type: 'Point', coordinates: [ch.lon, ch.lat] },
      };
    });

    updateMapVehicles(targets.map, vehicleFeatures);
    updateMapAnomalies(targets.map, anomalyFeatures);

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

  function spawnVehicle(totalCh, opts = {}) {
    if (!roadOk) {
      spawnVehicleLegacyFiber(totalCh, opts);
      return;
    }

    const laneKey = opts.forceLane || pickLaneKey();
    const lane = laneKey === 'eb' ? laneEb : laneWb;
    const direction = directionForLane(laneKey);
    const fwd = roadForwardSignForDirection(lane, direction);

    let speedMph;
    const vehicleType = Math.random() > 0.82 ? 'truck' : 'car';
    if (opts.forceSpeed) {
      speedMph = opts.forceSpeed;
    } else if (vehicleType === 'truck') {
      speedMph =
        direction === 'up_canyon' ? randomInt(20, 32) : randomInt(25, 38);
    } else {
      speedMph =
        direction === 'up_canyon' ? randomInt(28, 48) : randomInt(32, 55);
    }

    let roadDistM;
    if (opts.startRoadM !== undefined) {
      roadDistM = opts.startRoadM;
    } else if (fwd > 0) {
      roadDistM = randomInt(0, Math.floor(lane.totalM * 0.95));
    } else {
      roadDistM = randomInt(Math.floor(lane.totalM * 0.05), Math.floor(lane.totalM));
    }

    roadDistM = Math.max(0, Math.min(lane.totalM, roadDistM));
    const channelPos = roadDistanceToChannelPos(lane, roadDistM);
    const [lon, lat] = lonLatAtRoadDistance(lane, roadDistM);

    let signalStrength;
    if (vehicleType === 'truck') {
      signalStrength = 0.55 + Math.random() * 0.4;
    } else {
      signalStrength = 0.2 + Math.random() * 0.35;
    }

    vehicles.push({
      id: `VEH-${String(nextVehicleId++).padStart(4, '0')}`,
      laneKey,
      direction,
      roadDistM,
      channelPos,
      lon,
      lat,
      channelsPerTick: mphToChannelsPerTick(speedMph),
      desiredSpeedMph: speedMph,
      speedMph,
      vehicleType,
      signalStrength,
      currentMilepost: 0,
    });
  }

  function spawnVehicleLegacyFiber(totalCh, opts = {}) {
    const direction = opts.forceDirection || (Math.random() > 0.5 ? 'up_canyon' : 'down_canyon');
    let speedMph;
    const vehicleType = Math.random() > 0.82 ? 'truck' : 'car';
    if (opts.forceSpeed) speedMph = opts.forceSpeed;
    else if (vehicleType === 'truck') {
      speedMph = direction === 'up_canyon' ? randomInt(20, 32) : randomInt(25, 38);
    } else {
      speedMph = direction === 'up_canyon' ? randomInt(28, 48) : randomInt(32, 55);
    }
    const channelsPerTick = mphToChannelsPerTick(speedMph);
    let startPos;
    if (opts.startAt !== undefined) startPos = opts.startAt;
    else {
      startPos = direction === 'up_canyon' ? 0 : totalCh - 1;
      if (opts.offset) startPos += direction === 'up_canyon' ? -opts.offset : opts.offset;
    }
    let signalStrength;
    if (vehicleType === 'truck') signalStrength = 0.55 + Math.random() * 0.4;
    else signalStrength = 0.2 + Math.random() * 0.35;

    vehicles.push({
      id: `VEH-${String(nextVehicleId++).padStart(4, '0')}`,
      laneKey: 'eb',
      direction,
      channelPos: startPos,
      channelsPerTick,
      desiredSpeedMph: speedMph,
      speedMph,
      vehicleType,
      signalStrength,
      currentMilepost: 0,
    });
  }

  function start() {
    if (roadOk) {
      for (const laneKey of ['eb', 'wb']) {
        const lane = laneKey === 'eb' ? laneEb : laneWb;
        const direction = directionForLane(laneKey);
        const fwd = roadForwardSignForDirection(lane, direction);
        const roadDistM =
          fwd > 0
            ? randomInt(0, Math.floor(lane.totalM * 0.25))
            : randomInt(Math.floor(lane.totalM * 0.75), Math.floor(lane.totalM));
        spawnVehicle(totalChannels, { forceLane: laneKey, startRoadM: roadDistM });
      }
      for (let i = 0; i < 10; i++) {
        spawnVehicle(totalChannels);
      }
    } else {
      for (let i = 0; i < 8; i++) {
        const dir = i % 2 === 0 ? 'up_canyon' : 'down_canyon';
        spawnVehicleLegacyFiber(totalChannels, {
          forceDirection: dir,
          startAt: Math.floor(Math.random() * totalChannels * 0.3) + (dir === 'down_canyon' ? totalChannels * 0.5 : 0),
        });
      }
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
