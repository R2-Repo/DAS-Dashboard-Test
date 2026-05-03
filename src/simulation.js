/**
 * Traffic-first DAS simulator: user-controlled vehicles on SR-190 lanes drive
 * car-following dynamics; strain-rate proxy is synthesized each tick for the waterfall.
 * Hazards (e.g. rock slide) are event bands on the fiber — extend for avalanche later.
 */

import { updateMapVehicles, updateMapAnomalies } from './map.js';
import {
  buildRoadMotionModel,
  roadDistanceToChannelPos,
  curvatureAtRoadDistance,
  roadForwardSignForDirection,
  lonLatAtRoadDistance,
  nearestPointOnLanes,
  travelBearingDegAtRoadDistance,
  bearingDegClockwiseFromNorthLonLat,
} from './road-geometry.js';
import { stepVehicleIdm, DEFAULT_IDM } from './traffic-follow.js';
import {
  buildVehicleFootprintPolygon,
  normalizeVehicleType,
  vehicleDasFootprint,
  vehicleSpec,
} from './vehicle-model.js';

const CHANNEL_SPACING_M = 2.0;
const TICK_MS = 100;
const MS_PER_S = 1000;
const MPH_TO_MS = 0.44704;

const MIN_CURVE_SPEED_MPH = 18;
const LAB_SNAP_MAX_M = 150;

let vehicles = [];
let anomalies = [];
let nextFleetId = 1;
let tickCount = 0;
let running = true;
let speedMultiplier = 1;
let intervalId = null;

let selectedVehicleId = null;
let dragVehicleId = null;

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

function directionForLane(laneKey) {
  return laneKey === 'eb' ? 'up_canyon' : 'down_canyon';
}

function formatFleetId(n) {
  return `VEH-${String(n).padStart(4, '0')}`;
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
  let defaultVehicleType = 'car';

  function vehicleById(id) {
    return vehicles.find((v) => v.id === id) ?? null;
  }

  let syncFleetPanelFn = () => {};

  function setSelectedVehicleId(id) {
    selectedVehicleId = id;
    const v = id ? vehicleById(id) : null;
    if (v && v.roadDistM !== undefined) {
      targets.waterfall.scrollChannelIntoView(v.channelPos);
    }
    targets.waterfall.setHighlightChannel(
      v ? Math.min(Math.max(0, Math.floor(v.channelPos)), totalChannels - 1) : null,
    );
    syncFleetPanelFn();
  }

  function tick() {
    if (!running) return;
    tickCount++;

    const dtEff = TICK_MS / speedMultiplier;
    const dtS = dtEff / MS_PER_S;

    if (roadOk) {
      const ebIdx = [];
      const wbIdx = [];
      for (let i = 0; i < vehicles.length; i++) {
        const v = vehicles[i];
        if (v.laneKey === 'eb') ebIdx.push(i);
        else wbIdx.push(i);
      }

      function stepLane(indices, lane, direction) {
        const fwd = roadForwardSignForDirection(lane, direction);
        const sorted = [...indices].sort((a, b) => vehicles[a].roadDistM - vehicles[b].roadDistM);
        for (let k = 0; k < sorted.length; k++) {
          const i = sorted[k];
          const v = vehicles[i];
          let leader = null;
          if (fwd > 0 && k < sorted.length - 1) leader = vehicles[sorted[k + 1]];
          if (fwd < 0 && k > 0) leader = vehicles[sorted[k - 1]];

          const curv = curvatureAtRoadDistance(lane, v.roadDistM);
          const cap = curveSpeedCapMph(curv);
          stepVehicleIdm(v, leader, v.desiredSpeedMph, cap, fwd, dtS, DEFAULT_IDM);

          if (v.roadDistM < -30 || v.roadDistM > lane.totalM + 30) {
            v.dead = true;
          } else {
            v.roadDistM = Math.max(0, Math.min(lane.totalM, v.roadDistM));
          }

          v.channelPos = roadDistanceToChannelPos(lane, v.roadDistM);
          const ll = lonLatAtRoadDistance(lane, v.roadDistM);
          v.lon = ll[0];
          v.lat = ll[1];
          v.channelsPerTick = mphToChannelsPerTick(v.speedMph);
        }
      }

      stepLane(ebIdx, laneEb, directionForLane('eb'));
      stepLane(wbIdx, laneWb, directionForLane('wb'));
    } else {
      const upIdx = [];
      const downIdx = [];
      for (let i = 0; i < vehicles.length; i++) {
        if (vehicles[i].direction === 'up_canyon') upIdx.push(i);
        else downIdx.push(i);
      }

      function stepLegacy(indices, fwd) {
        const sorted = [...indices].sort((a, b) => vehicles[a].channelPos - vehicles[b].channelPos);
        for (let k = 0; k < sorted.length; k++) {
          const i = sorted[k];
          const v = vehicles[i];
          v.roadDistM = v.channelPos * CHANNEL_SPACING_M;
          let leader = null;
          if (fwd > 0 && k < sorted.length - 1) {
            const L = vehicles[sorted[k + 1]];
            leader = {
              roadDistM: L.channelPos * CHANNEL_SPACING_M,
              vehicleType: L.vehicleType,
              speedMph: L.speedMph,
            };
          }
          if (fwd < 0 && k > 0) {
            const L = vehicles[sorted[k - 1]];
            leader = {
              roadDistM: L.channelPos * CHANNEL_SPACING_M,
              vehicleType: L.vehicleType,
              speedMph: L.speedMph,
            };
          }

          const cap = 120;
          stepVehicleIdm(v, leader, v.desiredSpeedMph, cap, fwd, dtS, DEFAULT_IDM);

          v.channelPos = v.roadDistM / CHANNEL_SPACING_M;
          const ci = Math.floor(v.channelPos);
          const ch = channels[Math.min(Math.max(0, ci), totalChannels - 1)];
          v.lon = ch.lon;
          v.lat = ch.lat;

          if (ci < -30 || ci > totalChannels + 30) v.dead = true;
          else v.channelPos = Math.max(0, Math.min(totalChannels - 1, v.channelPos));

          v.channelsPerTick = mphToChannelsPerTick(v.speedMph);
        }
      }

      stepLegacy(upIdx, 1);
      stepLegacy(downIdx, -1);
    }

    vehicles = vehicles.filter((v) => !v.dead);
    if (selectedVehicleId && !vehicleById(selectedVehicleId)) {
      setSelectedVehicleId(vehicles[0]?.id ?? null);
    }

    for (const v of vehicles) {
      const ci = Math.min(Math.max(0, Math.floor(v.channelPos)), totalChannels - 1);
      v.currentMilepost = channels[ci].milepost;
    }

    for (const a of anomalies) a.ttl -= dtEff / TICK_MS;
    anomalies = anomalies.filter((a) => a.ttl > 0);

    const row = new Float32Array(totalChannels);
    noiseSeed += 0.1;

    for (let i = 0; i < totalChannels; i++) {
      noiseState[i] += (Math.random() - 0.5) * 0.006;
      noiseState[i] *= 0.97;
      const spatial =
        0.004 * Math.sin(i * 0.01 + noiseSeed) + 0.0025 * Math.sin(i * 0.037 + noiseSeed * 1.7);
      row[i] = Math.max(
        0,
        channelBias[i] + noiseState[i] + spatial + Math.random() * 0.012,
      );
    }

    for (const v of vehicles) {
      const center = v.channelPos;
      const ci = Math.floor(center);
      const frac = center - ci;
      const { halfWidth, strength } = vehicleDasFootprint(v.vehicleType);
      const hw = Math.ceil(halfWidth) + 1;
      const peakStrength = strength * (0.92 + Math.random() * 0.08);

      for (let d = -hw; d <= hw; d++) {
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
        row[idx] = Math.min(1.0, row[idx] + amplitude);
      }
    }

    for (const a of anomalies) {
      const decay = Math.min(1, a.ttl / a.initialTtl);
      const baseIntensity = a.intensity * decay;
      for (let i = a.startChannel; i <= a.endChannel && i < totalChannels; i++) {
        if (i < 0) continue;
        const spatialVar = 0.35 + 0.65 * Math.abs(Math.sin(i * 0.12 + a.phase));
        const temporalVar = 0.55 + 0.45 * Math.random();
        row[i] = Math.min(1.0, row[i] + baseIntensity * spatialVar * temporalVar * 0.55);
      }
    }

    targets.waterfall.pushRow(row);
    targets.waterfall.render();

    const sel = selectedVehicleId ? vehicleById(selectedVehicleId) : null;
    targets.waterfall.setHighlightChannel(
      sel ? Math.min(Math.max(0, Math.floor(sel.channelPos)), totalChannels - 1) : null,
    );

    const vehicleFeatures = vehicles
      .filter((v) => {
        const ci = Math.floor(v.channelPos);
        return ci >= 0 && ci < totalChannels;
      })
      .map((v) => {
        const ci = Math.min(Math.max(0, Math.floor(v.channelPos)), totalChannels - 1);
        const ch = channels[ci];
        const lon =
          roadOk && v.lon !== undefined && v.lat !== undefined ? v.lon : ch.lon;
        const lat =
          roadOk && v.lon !== undefined && v.lat !== undefined ? v.lat : ch.lat;

        let bearingDeg;
        if (roadOk) {
          const lane = v.laneKey === 'eb' ? laneEb : laneWb;
          bearingDeg = travelBearingDegAtRoadDistance(lane, v.roadDistM, v.direction);
        } else {
          const i0 = Math.min(ci, totalChannels - 2);
          const c0 = channels[Math.max(0, i0)];
          const c1 = channels[Math.min(i0 + 1, totalChannels - 1)];
          bearingDeg = bearingDegClockwiseFromNorthLonLat(c0.lon, c0.lat, c1.lon, c1.lat);
          if (v.direction === 'down_canyon') bearingDeg = (bearingDeg + 180) % 360;
        }

        const spec = vehicleSpec(v.vehicleType);
        const geom = buildVehicleFootprintPolygon(lon, lat, spec.lengthM, spec.widthM, bearingDeg);
        const outline = v.id === selectedVehicleId ? '#ffffff' : 'rgba(0,0,0,0.35)';

        return {
          type: 'Feature',
          properties: {
            id: v.id,
            lane: v.laneKey,
            direction: v.direction,
            speed: Math.round(v.speedMph),
            type: v.vehicleType,
            milepost: ch.milepost.toFixed(1),
            selected: v.id === selectedVehicleId ? 1 : 0,
            height_m: spec.heightM,
            fill_color: spec.color,
            outline_color: outline,
          },
          geometry: geom,
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

    targets.ui.updateStats(vehicles, anomalies, {
      sampleRateHz: MS_PER_S / TICK_MS,
      simTimeS: tickCount * (TICK_MS / MS_PER_S),
    });

    if (tickCount % 25 === 0 && vehicles.length > 0) {
      const v = vehicles[Math.floor(Math.random() * vehicles.length)];
      targets.ui.addEvent('vehicle', v);
    }
    if (anomalies.length > 0 && tickCount % 40 === 0) {
      const a = anomalies[0];
      const midCh = channels[Math.min(Math.floor((a.startChannel + a.endChannel) / 2), totalChannels - 1)];
      targets.ui.addEvent('anomaly', { ...a, milepost: midCh.milepost });
    }

    if (tickCount % 8 === 0) {
      syncFleetPanelFn();
    }
  }

  function spawnUserVehicleAtRoad(laneKey, roadDistM, opts = {}) {
    const lane = laneKey === 'eb' ? laneEb : laneWb;
    if (!lane) return null;
    const direction = directionForLane(laneKey);
    const speedMph = opts.forceSpeed ?? 38;
    const vehicleType = normalizeVehicleType(opts.vehicleType || 'car');
    const roadM = Math.max(0, Math.min(lane.totalM, roadDistM));
    const channelPos = roadDistanceToChannelPos(lane, roadM);
    const [lon, lat] = lonLatAtRoadDistance(lane, roadM);
    const id = formatFleetId(nextFleetId++);

    const v = {
      id,
      laneKey,
      direction,
      roadDistM: roadM,
      channelPos,
      lon,
      lat,
      channelsPerTick: mphToChannelsPerTick(speedMph),
      desiredSpeedMph: speedMph,
      speedMph,
      vehicleType,
      currentMilepost: 0,
      dead: false,
      userLock: false,
    };
    vehicles.push(v);
    targets.waterfall.scrollChannelIntoView(channelPos);
    return v;
  }

  function spawnUserVehicleLegacy(channelPos, direction, opts = {}) {
    const speedMph = opts.forceSpeed ?? 36;
    const vehicleType = normalizeVehicleType(opts.vehicleType || 'car');
    const cp = Math.max(0, Math.min(totalChannels - 1, channelPos));
    const ch = channels[Math.floor(cp)];
    const id = formatFleetId(nextFleetId++);
    const v = {
      id,
      laneKey: 'eb',
      direction,
      roadDistM: cp * CHANNEL_SPACING_M,
      channelPos: cp,
      lon: ch.lon,
      lat: ch.lat,
      channelsPerTick: mphToChannelsPerTick(speedMph),
      desiredSpeedMph: speedMph,
      speedMph,
      vehicleType,
      currentMilepost: 0,
      dead: false,
      userLock: false,
    };
    vehicles.push(v);
    targets.waterfall.scrollChannelIntoView(cp);
    return v;
  }

  function placeVehicleAtLngLat(lng, lat, opts = {}) {
    if (!roadOk) return false;
    const snap = nearestPointOnLanes(laneEb, laneWb, lng, lat);
    if (!snap || snap.distanceM > LAB_SNAP_MAX_M) return false;
    const id = opts.vehicleId;
    const existing = id ? vehicleById(id) : null;
    const lane = snap.laneKey === 'eb' ? laneEb : laneWb;
    const roadM = Math.max(0, Math.min(lane.totalM, snap.roadDistM));
    const speed = opts.forceSpeed ?? (existing ? existing.desiredSpeedMph : 38);
    const vtype = normalizeVehicleType(opts.vehicleType ?? (existing ? existing.vehicleType : 'car'));

    if (existing) {
      existing.laneKey = snap.laneKey;
      existing.direction = directionForLane(snap.laneKey);
      existing.roadDistM = roadM;
      existing.channelPos = roadDistanceToChannelPos(lane, roadM);
      const ll = lonLatAtRoadDistance(lane, roadM);
      existing.lon = ll[0];
      existing.lat = ll[1];
      existing.desiredSpeedMph = speed;
      existing.vehicleType = vtype;
      existing.userLock = true;
      existing.speedMph = 0;
      targets.waterfall.scrollChannelIntoView(existing.channelPos);
      return true;
    }

    const v = spawnUserVehicleAtRoad(snap.laneKey, roadM, {
      forceSpeed: speed,
      vehicleType: vtype,
    });
    if (v) {
      v.userLock = true;
      v.speedMph = 0;
    }
    return !!v;
  }

  function moveVehicleToLngLat(id, lng, lat) {
    const existing = vehicleById(id);
    if (!existing) return false;
    if (roadOk) {
      return placeVehicleAtLngLat(lng, lat, { vehicleId: id });
    }
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < totalChannels; i++) {
      const ch = channels[i];
      const d =
        (ch.lon - lng) * (ch.lon - lng) * Math.cos((ch.lat * Math.PI) / 180) +
        (ch.lat - lat) * (ch.lat - lat);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return false;
    existing.channelPos = best;
    existing.roadDistM = best * CHANNEL_SPACING_M;
    existing.lon = channels[best].lon;
    existing.lat = channels[best].lat;
    existing.userLock = true;
    existing.speedMph = 0;
    targets.waterfall.scrollChannelIntoView(best);
    return true;
  }

  function addVehicleNearLngLat(lng, lat, opts = {}) {
    const merged = {
      ...opts,
      vehicleType: normalizeVehicleType(opts.vehicleType ?? defaultVehicleType),
    };
    if (roadOk) {
      const snap = nearestPointOnLanes(laneEb, laneWb, lng, lat);
      if (!snap || snap.distanceM > LAB_SNAP_MAX_M) return null;
      const v = spawnUserVehicleAtRoad(snap.laneKey, snap.roadDistM, merged);
      if (v) setSelectedVehicleId(v.id);
      return v;
    }
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < totalChannels; i++) {
      const ch = channels[i];
      const d =
        (ch.lon - lng) * (ch.lon - lng) * Math.cos((ch.lat * Math.PI) / 180) +
        (ch.lat - lat) * (ch.lat - lat);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return null;
    const dir = merged.direction || (Math.random() > 0.5 ? 'up_canyon' : 'down_canyon');
    const v = spawnUserVehicleLegacy(best, dir, merged);
    if (v) setSelectedVehicleId(v.id);
    return v;
  }

  function removeVehicle(id) {
    const before = vehicles.length;
    vehicles = vehicles.filter((v) => v.id !== id);
    if (selectedVehicleId === id) setSelectedVehicleId(vehicles[0]?.id ?? null);
    if (dragVehicleId === id) dragVehicleId = null;
    return vehicles.length < before;
  }

  function clearFleet() {
    vehicles = [];
    anomalies = [];
    setSelectedVehicleId(null);
    dragVehicleId = null;
    updateMapVehicles(targets.map, []);
    updateMapAnomalies(targets.map, []);
    targets.ui.updateStats(vehicles, anomalies, { sampleRateHz: MS_PER_S / TICK_MS, simTimeS: 0 });
  }

  function applyQuickFleet() {
    clearFleet();
    if (roadOk) {
      spawnUserVehicleAtRoad('eb', laneEb.totalM * 0.08, { forceSpeed: 28, vehicleType: 'bicycle' });
      spawnUserVehicleAtRoad('eb', laneEb.totalM * 0.065, { forceSpeed: 38, vehicleType: 'motorcycle' });
      spawnUserVehicleAtRoad('eb', laneEb.totalM * 0.05, { forceSpeed: 34, vehicleType: 'car' });
      spawnUserVehicleAtRoad('wb', laneWb.totalM * 0.92, { forceSpeed: 35, vehicleType: 'truck' });
      spawnUserVehicleAtRoad('wb', laneWb.totalM * 0.88, { forceSpeed: 40, vehicleType: 'semi_truck' });
    } else {
      spawnUserVehicleLegacy(totalChannels * 0.1, 'up_canyon', { forceSpeed: 32 });
      spawnUserVehicleLegacy(totalChannels * 0.08, 'up_canyon', { forceSpeed: 40 });
    }
    setSelectedVehicleId(vehicles[0]?.id ?? null);
  }

  /**
   * Broadband disturbance along fiber (placeholder for avalanche / rock slide UI).
   */
  function triggerRockslide(opts = {}) {
    const span = Math.min(
      totalChannels - 4,
      Math.max(24, Math.floor(opts.spanChannels ?? 120)),
    );
    let start = Math.floor(opts.startChannel ?? totalChannels * 0.45 + (Math.random() - 0.5) * 400);
    start = Math.max(2, Math.min(totalChannels - span - 2, start));
    const ttl = opts.durationTicks ?? 180;
    anomalies.push({
      id: `RS-${String(tickCount).padStart(5, '0')}`,
      subtype: 'rock_slide_disturbance',
      startChannel: start,
      endChannel: Math.min(start + span, totalChannels - 1),
      intensity: opts.intensity ?? 0.55,
      ttl,
      initialTtl: ttl,
      phase: Math.random() * Math.PI * 2,
    });
    const midCh = channels[Math.min(Math.floor(start + span / 2), totalChannels - 1)];
    targets.ui.addEvent('anomaly', {
      id: anomalies[anomalies.length - 1].id,
      subtype: 'rock_slide_disturbance',
      milepost: midCh.milepost,
      intensity: anomalies[anomalies.length - 1].intensity,
    });
  }

  function setVehicleDesiredSpeed(id, mph) {
    const v = vehicleById(id);
    if (!v) return false;
    v.desiredSpeedMph = Math.max(0, Math.min(85, mph));
    return true;
  }

  function setVehicleType(id, vehicleType) {
    const v = vehicleById(id);
    if (!v) return false;
    v.vehicleType = normalizeVehicleType(vehicleType);
    return true;
  }

  function releaseUserLocks() {
    for (const v of vehicles) {
      v.userLock = false;
    }
  }

  function releaseDragLocks() {
    releaseUserLocks();
  }

  function start() {
    if (intervalId) clearInterval(intervalId);
    tickCount = 0;
    vehicles = [];
    anomalies = [];
    selectedVehicleId = null;
    dragVehicleId = null;
    intervalId = setInterval(tick, TICK_MS / speedMultiplier);
    targets.ui.updateChannelCount(totalChannels);
    targets.ui.updateStats(vehicles, anomalies, { sampleRateHz: MS_PER_S / TICK_MS, simTimeS: 0 });
  }

  function play() {
    running = true;
    releaseUserLocks();
    document.getElementById('btn-play')?.classList.add('active');
    document.getElementById('btn-pause')?.classList.remove('active');
  }

  function pause() {
    running = false;
    document.getElementById('btn-play')?.classList.remove('active');
    document.getElementById('btn-pause')?.classList.add('active');
  }

  function setSpeed(mult) {
    speedMultiplier = mult;
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(tick, TICK_MS / speedMultiplier);
  }

  const api = {
    start,
    play,
    pause,
    setSpeed,
    isRoadOk: () => roadOk,
    getVehicles: () => vehicles,
    getSelectedVehicleId: () => selectedVehicleId,
    setSelectedVehicleId,
    addVehicleNearLngLat,
    placeVehicleAtLngLat,
    removeVehicle,
    clearFleet,
    applyQuickFleet,
    triggerRockslide,
    setVehicleDesiredSpeed,
    setVehicleType,
    getDefaultVehicleType: () => defaultVehicleType,
    setDefaultVehicleType: (t) => {
      defaultVehicleType = normalizeVehicleType(t);
    },
    getDragVehicleId: () => dragVehicleId,
    setDragVehicleId: (id) => {
      dragVehicleId = id;
    },
    moveVehicleToLngLat,
    releaseDragLocks,
    syncFleetPanel: () => {},
  };

  syncFleetPanelFn = () => targets.ui.refreshFleetPanel(api);
  api.syncFleetPanel = syncFleetPanelFn;

  return api;
}
