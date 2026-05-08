/**
 * Traffic-first DAS simulator: user-controlled vehicles on SR-190 lanes drive
 * car-following dynamics; strain-rate proxy is synthesized each tick for the waterfall.
 * Hazards (crash, rock slide, avalanche) are spatial bands on the fiber + tinted footprints on the map.
 */

import { updateMapVehicles, updateMapHazards } from './map-core.js';
import {
  buildRoadMotionModel,
  roadDistanceToChannelPos,
  maxCurvatureAhead,
  roadForwardSignForDirection,
  lonLatAtRoadDistance,
  nearestPointOnLane,
  nearestPointOnLanes,
  nearestPointOnLanesPrefer,
  travelBearingDegAtRoadDistance,
  bearingDegClockwiseFromNorthLonLat,
  clampChannelPosToFiber,
} from './road-geometry.js';
import { stepVehicleIdm, DEFAULT_IDM } from './traffic-follow.js';
import {
  buildVehicleFootprintPolygon,
  mapVehicleExtentBoostFromZoom,
  mapVehicleFootprintDims,
  normalizeVehicleType,
  VEHICLE_TYPES,
  vehicleDasFootprint,
  vehicleDasClassHeat,
  vehicleSpec,
} from './vehicle-model.js';
import { LANE_ROUTE_COLOR_HEX } from './lane-route-colors.js';
import { syncVehicleCallouts, clearVehicleCallouts } from './vehicle-callouts.js';
import {
  buildCorridorPolygonLonLat,
  hazardEventDurationTicks,
  hazardFallbackChannelHalfWidth,
  hazardPeakIntensity,
  hazardWaterfallStampGain,
  hazardWaterfallEnvelope,
  lateralWidthsForHazard,
  normalizeHazardKind,
  normalizeHazardSize,
  hazardPalette,
} from './hazard-model.js';

const CHANNEL_SPACING_M = 2.0;
const TICK_MS = 100;
const MS_PER_S = 1000;
const MPH_TO_MS = 0.44704;

/**
 * Absolute ceiling for `waterfallStitchSpanBudget` (unit tests / legacy tooling).
 */
const MAX_WATERFALL_STITCH_SPAN_CH = 380;

/**
 * Max |Δchannel| covered by per-tick motion stacking. Only the true prev→current motion is filled
 * (no synthetic diagonal skew), so this stays small and avoids painting unrelated mileposts in one row.
 */
const MAX_WATERFALL_MOTION_STITCH_SPAN_CH = 10;

/**
 * If fiber index jumps far more than along-road motion implies, the road→channel map likely
 * skipped or folded — do not bridge in channel space (prevents bogus horizontal bands).
 */
export function isFiberMappingGlitch(deltaRoadM, rawMotionCh, halfWidth) {
  if (!(rawMotionCh > 32)) return false;
  const roadEquivCh = deltaRoadM / CHANNEL_SPACING_M;
  const slack = halfWidth * 2 + 20;
  return rawMotionCh > roadEquivCh * 10 + slack;
}

/** After this many ticks stopped near a route end, remove the vehicle (avoids phantom DAS / map clutter). */
const TERMINAL_DESPAWN_TICKS = 55;

/**
 * Historical helper: allowed stitch length from observed along-fiber motion plus footprint skew slack.
 * Exported for unit tests.
 *
 * @param {number} rawChannelDelta — |channelPos − previous channelPos| for this vehicle (same tick basis)
 */
export function waterfallStitchSpanBudget(rawChannelDelta, halfWidth, skewAlongChannels) {
  const d = Math.abs(rawChannelDelta);
  const slack = halfWidth * 2.45 + Math.abs(skewAlongChannels) + 10;
  return Math.min(MAX_WATERFALL_STITCH_SPAN_CH, Math.max(24, d * 1.42 + slack));
}

/**
 * Build 1–7 micro-stamps along true fiber motion for one sim tick. Restores peak row values for the
 * fixed jet colormap (single centroid after #112 sat in the cyan band). Does not add skew along
 * distance, so row width stays tight vs. the old long diagonal bridge.
 *
 * @param {number} prevStamp
 * @param {number} rawCh
 * @param {number} deltaRoadForStamp
 * @param {number} rawMotionCh
 * @param {number} halfWidth
 * @param {number} peakStrength
 * @returns {{ kind: 'one', pos: number, strength: number } | { kind: 'blend', stamps: { pos: number, strength: number }[] }}
 */
export function planVehicleWaterfallStamps(
  prevStamp,
  rawCh,
  deltaRoadForStamp,
  rawMotionCh,
  halfWidth,
  peakStrength,
) {
  if (isFiberMappingGlitch(deltaRoadForStamp, rawMotionCh, halfWidth)) {
    return { kind: 'one', pos: rawCh, strength: peakStrength };
  }
  const spanCh = rawCh - prevStamp;
  const spanAbs = Math.abs(spanCh);
  if (!Number.isFinite(spanAbs) || spanAbs > MAX_WATERFALL_MOTION_STITCH_SPAN_CH) {
    return { kind: 'one', pos: rawCh, strength: peakStrength };
  }
  const nSteps = Math.min(7, Math.max(2, Math.ceil(spanAbs * 3.5 + 2.5)));
  const stackScale = 1 / nSteps ** 0.12;
  const stamps = [];
  for (let s = 0; s < nSteps; s++) {
    const u = s / (nSteps - 1);
    const pos = prevStamp + spanCh * u;
    const along = 0.68 + 0.32 * (1 - Math.abs(u - 0.5) * 2);
    stamps.push({ pos, strength: peakStrength * along * stackScale });
  }
  return { kind: 'blend', stamps };
}

/** Lookahead distance (m) for curve speed — slow before the bend. */
const CURVE_LOOKAHEAD_M = 45;

function mphToChannelsPerTick(mph) {
  const metersPerSec = mph * MPH_TO_MS;
  const metersPerTick = metersPerSec * (TICK_MS / MS_PER_S);
  return metersPerTick / CHANNEL_SPACING_M;
}

/**
 * Speed cap (mph) from path curvature (1/m). Tight bends are capped; gentle and moderate
 * curves follow a lateral-acceleration comfort model (relaxed vs. early strict piecewise caps).
 */
function curveSpeedCapMph(curvaturePerM) {
  const κ = Math.max(0, curvaturePerM);
  if (κ < 3e-6) return 120;
  const r = 1 / κ;
  const ay = 2.85;
  const vComfortMph = (Math.sqrt(ay * Math.max(8, r)) / MPH_TO_MS) * 0.95;

  if (κ >= 0.03) {
    return Math.min(vComfortMph, 22);
  }
  if (κ >= 0.018) {
    const t = (κ - 0.018) / (0.03 - 0.018);
    return Math.min(vComfortMph, 26 + (1 - t) * 4);
  }
  if (κ >= 0.01) {
    const t = (κ - 0.01) / (0.018 - 0.01);
    return Math.min(vComfortMph, 36 + (1 - t) * 8);
  }
  if (κ >= 0.0055) {
    const t = (κ - 0.0055) / (0.01 - 0.0055);
    return Math.min(vComfortMph, 48 + (1 - t) * 10);
  }
  if (κ >= 0.0025) {
    const t = (κ - 0.0025) / (0.0055 - 0.0025);
    return Math.min(vComfortMph, 62 + (1 - t) * 14);
  }
  return Math.min(120, Math.max(42, vComfortMph));
}

const LAB_SNAP_MAX_M = 650;

let vehicles = [];
let hazards = [];
let nextFleetId = 1;
let nextHazardSeq = 1;
let tickCount = 0;
let intervalId = null;

let selectedVehicleId = null;
let dragVehicleId = null;

function directionForLane(laneKey) {
  return laneKey === 'eb' ? 'up_canyon' : 'down_canyon';
}

function formatFleetId(n) {
  return `VEH-${String(n).padStart(4, '0')}`;
}

function formatHazardId(n) {
  return `HZD-${String(n).padStart(4, '0')}`;
}

/** MapLibre fill-extrusion opacity is layer-wide; encode per-vehicle alpha in the color string. */
function rgbaFromHex(hex, a) {
  const h = String(hex).trim().replace('#', '');
  if (h.length !== 6) return `rgba(144,202,249,${a})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function mixRgbWithHex(baseHex, tintHex, t) {
  const parse = (hex) => {
    const h = String(hex).trim().replace('#', '');
    if (h.length !== 6) return null;
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  };
  const a = parse(baseHex);
  const b = parse(tintHex);
  if (!a || !b) return baseHex;
  const u = Math.max(0, Math.min(1, t));
  const r = Math.round(a[0] * (1 - u) + b[0] * u);
  const g = Math.round(a[1] * (1 - u) + b[1] * u);
  const bl = Math.round(a[2] * (1 - u) + b[2] * u);
  return `#${[r, g, bl].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
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
  /** 0–1 coupling factor from channel geometry (near road = stronger). */
  const channelRoadCoupling = new Float32Array(totalChannels);
  for (let i = 0; i < totalChannels; i++) {
    const rd = channels[i]?.nearest_road_distance_m;
    const d = typeof rd === 'number' && Number.isFinite(rd) ? Math.max(0, rd) : 6;
    const t = Math.min(1, d / 22);
    channelRoadCoupling[i] = Math.max(0.12, 1 - t * t);
  }
  let noiseSeed = Math.random() * 1000;
  let defaultVehicleType = 'car';

  function vehicleById(id) {
    return vehicles.find((v) => v.id === id) ?? null;
  }

  const fleetPanelSimView = {
    getVehicles: () => vehicles,
    getSelectedVehicleId: () => selectedVehicleId,
  };

  let syncFleetPanelFn = () => {};
  let plotFocusChannel = null;

  function setSelectedVehicleId(id) {
    selectedVehicleId = id;
    if (id) plotFocusChannel = null;
    const v = id ? vehicleById(id) : null;
    if (v && v.roadDistM !== undefined) {
      const ch = Math.min(Math.max(0, Math.floor(v.channelPos)), totalChannels - 1);
      targets.waterfall.zoomChannelIntoView?.(ch);
      targets.waterfall.setHighlightChannel(ch);
      targets.waterfall.setTrackChannel?.(ch);
      const map = targets.map;
      if (
        map
        && typeof v.lon === 'number'
        && Number.isFinite(v.lon)
        && typeof v.lat === 'number'
        && Number.isFinite(v.lat)
      ) {
        const z = Math.max(map.getZoom(), 15.2);
        map.easeTo({
          center: [v.lon, v.lat],
          zoom: z,
          duration: 650,
          essential: true,
        });
      }
    } else if (plotFocusChannel !== null) {
      targets.waterfall.setHighlightChannel(plotFocusChannel);
      targets.waterfall.setTrackChannel?.(null);
    } else {
      targets.waterfall.setHighlightChannel(null);
      targets.waterfall.setTrackChannel?.(null);
    }
    syncFleetPanelFn();
  }

  function focusMapOnChannel(channelIndex) {
    const ci = Math.max(0, Math.min(totalChannels - 1, Math.floor(channelIndex)));
    const ch = channels[ci];
    if (!ch) return;
    plotFocusChannel = ci;
    targets.waterfall.zoomChannelIntoView?.(ci);
    targets.waterfall.setHighlightChannel(ci);
    targets.waterfall.setTrackChannel?.(null);
    const map = targets.map;
    const z = Math.max(map.getZoom(), 15.4);
    map.easeTo({
      center: [ch.lon, ch.lat],
      zoom: z,
      duration: 850,
      essential: true,
    });
  }

  function tick() {
    tickCount++;

    hazards = hazards.filter(
      (h) => tickCount - h.startTick < hazardEventDurationTicks(h.kind, h.size),
    );

    const dtS = TICK_MS / MS_PER_S;

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

          if (v.id !== dragVehicleId) {
            const k = maxCurvatureAhead(lane, v.roadDistM, CURVE_LOOKAHEAD_M, fwd);
            const cap = curveSpeedCapMph(k);
            stepVehicleIdm(v, leader, v.desiredSpeedMph, cap, fwd, dtS, DEFAULT_IDM);
          }

          const rawRoadDistM = v.roadDistM;
          if (rawRoadDistM < -30 || rawRoadDistM > lane.totalM + 30) {
            v.dead = true;
          } else {
            const clampedRoad = Math.max(0, Math.min(lane.totalM, rawRoadDistM));
            // Hard lane ends: IDM still pulls toward desired speed while position is clamped,
            // which left speed frozen near free-flow (e.g. 38 mph) at the canyon mouth.
            if (clampedRoad !== rawRoadDistM) {
              v.speedMph = 0;
            }
            v.roadDistM = clampedRoad;
          }

          v.channelPos = clampChannelPosToFiber(
            roadDistanceToChannelPos(lane, v.roadDistM),
            totalChannels,
          );
          const ll = lonLatAtRoadDistance(lane, v.roadDistM);
          v.lon = ll[0];
          v.lat = ll[1];
          v.channelsPerTick = mphToChannelsPerTick(v.speedMph);

          if (v.id !== dragVehicleId && !v.userLock) {
            const marginM = 2.8;
            const atTerminal =
              v.roadDistM <= marginM || v.roadDistM >= lane.totalM - marginM;
            if (atTerminal && v.speedMph < 0.7) {
              v.terminalStillTicks = (v.terminalStillTicks ?? 0) + 1;
              if (v.terminalStillTicks >= TERMINAL_DESPAWN_TICKS) v.dead = true;
            } else {
              v.terminalStillTicks = 0;
            }
          }
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

          if (v.id !== dragVehicleId) {
            const cap = 120;
            stepVehicleIdm(v, leader, v.desiredSpeedMph, cap, fwd, dtS, DEFAULT_IDM);
          }

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
      setSelectedVehicleId(null);
    }

    for (const v of vehicles) {
      const ci = Math.min(Math.max(0, Math.floor(v.channelPos)), totalChannels - 1);
      v.currentMilepost = channels[ci].milepost;
    }

    const row = new Float32Array(totalChannels);
    noiseSeed += 0.1;

    // Quiet ambient noise — stays in the dark-blue band of the jet colormap.
    // Vehicle stamps below provide the contrast that makes diagonal traces visible.
    for (let i = 0; i < totalChannels; i++) {
      noiseState[i] += (Math.random() - 0.5) * 0.0008;
      noiseState[i] *= 0.99;
      const spatial =
        0.0008 * Math.sin(i * 0.01 + noiseSeed) + 0.0005 * Math.sin(i * 0.037 + noiseSeed * 1.7);
      const ambient = channelBias[i] + spatial + Math.random() * 0.004;
      row[i] = Math.max(0, ambient + noiseState[i]);
    }

    function stampVehicleEnergyAt(pos, peakStrength, halfWidth) {
      const ci = Math.floor(pos);
      const frac = pos - ci;
      const hw = Math.ceil(halfWidth) + 2;
      for (let d = -hw; d <= hw; d++) {
        const idx = ci + d;
        if (idx < 0 || idx >= totalChannels) continue;
        const dist = Math.abs(d - frac);
        if (dist > halfWidth + 1) continue;
        const t = dist / Math.max(0.5, halfWidth);
        const amplitude = peakStrength * Math.max(0, 1 - t * t);
        if (amplitude < 0.001) continue;
        row[idx] = Math.min(1.0, row[idx] + amplitude);
      }
    }

    for (const v of vehicles) {
      const rawCh = v.channelPos;
      const prevStamp =
        typeof v.prevStampChannelPos === 'number' ? v.prevStampChannelPos : rawCh;
      const prevRoadForStamp =
        typeof v.prevStampRoadDistM === 'number' ? v.prevStampRoadDistM : v.roadDistM;
      const deltaRoadForStamp = Math.abs(v.roadDistM - prevRoadForStamp);
      const rawMotionCh = Math.abs(rawCh - prevStamp);

      const { halfWidth, strength } = vehicleDasFootprint(v.vehicleType);
      const mph = Math.max(0, v.speedMph);
      // Speed→amplitude: gentle ramp so highway cruise stays mid-jet; top of the scale
      // needs ~free-flow speed, not 20 mph (parameter-only tuning vs. prior mapping).
      const speedNorm = Math.min(1, mph / 54);
      const speedCoupling = 0.08 + 0.92 * speedNorm ** 0.58;
      const classHeat = vehicleDasClassHeat(v.vehicleType);
      const microRipple =
        0.94 + 0.06 * Math.sin(rawCh * 0.11 + tickCount * 0.17 + v.id.length * 0.31);
      let peakStrength =
        strength * classHeat * microRipple * (0.97 + Math.random() * 0.03) * speedCoupling;

      const plan = planVehicleWaterfallStamps(
        prevStamp,
        rawCh,
        deltaRoadForStamp,
        rawMotionCh,
        halfWidth,
        peakStrength,
      );
      if (plan.kind === 'one') {
        stampVehicleEnergyAt(plan.pos, plan.strength, halfWidth);
      } else {
        for (const st of plan.stamps) {
          stampVehicleEnergyAt(st.pos, st.strength, halfWidth);
        }
      }

      v.prevStampChannelPos = rawCh;
      v.prevStampRoadDistM = v.roadDistM;
    }

    for (const h of hazards) {
      const age = tickCount - h.startTick;
      const envelope = hazardWaterfallEnvelope(h.kind, h.size, age);
      if (envelope < 0.002) continue;

      const centerCh = (h.startChannel + h.endChannel) / 2;
      const halfSpanCh = Math.max(0.75, (h.endChannel - h.startChannel) / 2);
      const baseIntensity = h.peakIntensity * envelope;

      const kind = normalizeHazardKind(h.kind);
      const gain = hazardWaterfallStampGain(h.kind, h.size);

      if (kind === 'crash') {
        const ci0 = Math.max(0, Math.floor(h.startChannel) - 2);
        const ci1 = Math.min(totalChannels - 1, Math.ceil(h.endChannel) + 2);
        for (let i = ci0; i <= ci1; i++) {
          const dist = Math.abs(i - centerCh);
          if (dist > halfSpanCh + 1.5) continue;
          const t = dist / Math.max(0.5, halfSpanCh);
          const lateral = Math.max(0, 1 - t * t);
          if (lateral < 0.02) continue;
          const spatialVar = 0.42 + 0.58 * Math.abs(Math.sin(i * 0.12 + h.phase));
          const temporalVar = 0.62 + 0.38 * Math.random();
          const amp = baseIntensity * spatialVar * temporalVar * 0.52 * lateral * gain;
          if (amp < 0.001) continue;
          row[i] = Math.min(1.0, row[i] + amp);
        }
        continue;
      }

      // Avalanche / rock slide: soft lateral gradients + halo + peripheral splashes (reference DAS look).
      const sigmaCore = Math.max(1.05, halfSpanCh * 0.74);
      const sigmaHalo = Math.max(2.0, halfSpanCh * 1.52);
      const splashOff = halfSpanCh * 1.02;
      const splashA = centerCh - splashOff * (0.62 + 0.22 * Math.sin(h.phase));
      const splashB = centerCh + splashOff * (0.68 + 0.18 * Math.cos(h.phase * 1.37));

      const tickGrain = 0.88 + 0.12 * Math.sin(tickCount * 0.12 + h.phase * 2.03);
      const farRadius = Math.ceil(halfSpanCh * 2.35 + sigmaHalo * 2.65 + 10);
      const ci0 = Math.max(0, Math.floor(centerCh - farRadius));
      const ci1 = Math.min(totalChannels - 1, Math.ceil(centerCh + farRadius));

      for (let i = ci0; i <= ci1; i++) {
        const d0 = i - centerCh;
        const core = Math.exp(-(d0 * d0) / (2 * sigmaCore * sigmaCore));
        const halo = 0.34 * Math.exp(-(d0 * d0) / (2 * sigmaHalo * sigmaHalo));

        const dA = i - splashA;
        const spA = 0.27 * Math.exp(-(dA * dA) / (2 * (sigmaCore * 0.6) ** 2));
        const dB = i - splashB;
        const spB = 0.24 * Math.exp(-(dB * dB) / (2 * (sigmaCore * 0.56) ** 2));

        const lateral = Math.min(1, core + halo + spA + spB);
        if (lateral < 0.006) continue;

        const spatialMod = 0.74 + 0.26 * Math.abs(Math.sin(i * 0.054 + h.phase * 1.33));
        const amp = baseIntensity * tickGrain * spatialMod * lateral * gain * 0.45;
        if (amp < 0.001) continue;
        row[i] = Math.min(1.0, row[i] + amp);
      }
    }

    targets.waterfall.pushRow(row);
    targets.waterfall.render();

    const sel = selectedVehicleId ? vehicleById(selectedVehicleId) : null;
    if (sel) {
      const hci = Math.min(Math.max(0, Math.floor(sel.channelPos)), totalChannels - 1);
      targets.waterfall.setHighlightChannel(hci);
      targets.waterfall.setTrackChannel?.(hci);
    } else if (plotFocusChannel !== null) {
      targets.waterfall.setHighlightChannel(plotFocusChannel);
      targets.waterfall.setTrackChannel?.(null);
    } else {
      targets.waterfall.setHighlightChannel(null);
      targets.waterfall.setTrackChannel?.(null);
    }

    const vehicleFeatures = vehicles
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

        v.mapBearingDeg = bearingDeg;

        const spec = vehicleSpec(v.vehicleType);
        const mapDims = mapVehicleFootprintDims(spec, {
          userPlaced: v.userPlaced,
          mapExtentBoost: mapVehicleExtentBoostFromZoom(targets.map.getZoom()),
        });
        const geom = buildVehicleFootprintPolygon(
          lon,
          lat,
          mapDims.lengthM,
          mapDims.widthM,
          bearingDeg,
        );
        const isSelected = v.id === selectedVehicleId;
        const laneTint =
          v.laneKey === 'eb' ? LANE_ROUTE_COLOR_HEX.eb : LANE_ROUTE_COLOR_HEX.wb;
        let baseFillHex;
        if (v.userPlaced) {
          baseFillHex = laneTint;
        } else if (roadOk) {
          baseFillHex = mixRgbWithHex(spec.color, laneTint, 0.38);
        } else {
          baseFillHex = spec.color;
        }
        const fillColor = rgbaFromHex(baseFillHex, isSelected ? 0.96 : v.userPlaced ? 0.9 : 0.82);
        let outlineColor;
        if (v.userPlaced) {
          outlineColor = isSelected
            ? rgbaFromHex(mixRgbWithHex(baseFillHex, '#ffffff', 0.4), 0.95)
            : rgbaFromHex(baseFillHex, 0.88);
        } else {
          outlineColor = isSelected ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.42)';
        }
        const glowColor = v.userPlaced ? fillColor : 'rgba(0,0,0,0)';

        return {
          type: 'Feature',
          properties: {
            id: v.id,
            lane: v.laneKey,
            direction: v.direction,
            speed: Math.round(v.speedMph),
            type: v.vehicleType,
            milepost: ch.milepost.toFixed(1),
            height_m: mapDims.heightM,
            fill_color: fillColor,
            outline_color: outlineColor,
            user_placed: v.userPlaced ? 1 : 0,
            selected: isSelected ? 1 : 0,
            glow_color: glowColor,
          },
          geometry: geom,
        };
      });

    const hazardFeatures = hazards.map((h) => {
      const midIdx = Math.min(
        Math.max(0, Math.floor((h.startChannel + h.endChannel) / 2)),
        totalChannels - 1,
      );
      const ch = channels[midIdx];
      const pal = hazardPalette(h.kind);
      return {
        type: 'Feature',
        properties: {
          id: h.id,
          kind: h.kind,
          size: h.size,
          milepost: ch.milepost.toFixed(1),
          fill_color: pal.fill,
          outline_color: pal.outline,
        },
        geometry: h.geometry,
      };
    });

    updateMapVehicles(targets.map, vehicleFeatures);
    syncVehicleCallouts(targets.map, vehicles, selectedVehicleId);
    updateMapHazards(targets.map, hazardFeatures);

    targets.ui.updateStats(vehicles, hazards);

    targets.ui.updateFleetMileposts?.(fleetPanelSimView);
  }

  function spawnUserVehicleAtRoad(laneKey, roadDistM, opts = {}) {
    const lane = laneKey === 'eb' ? laneEb : laneWb;
    if (!lane) return null;
    const direction = directionForLane(laneKey);
    const speedMph = opts.forceSpeed ?? 38;
    const vehicleType = normalizeVehicleType(opts.vehicleType || 'car');
    const roadM = Math.max(0, Math.min(lane.totalM, roadDistM));
    const channelPos = clampChannelPosToFiber(
      roadDistanceToChannelPos(lane, roadM),
      totalChannels,
    );
    const [lon, lat] = lonLatAtRoadDistance(lane, roadM);
    const id = formatFleetId(nextFleetId++);

    const v = {
      id,
      laneKey,
      direction,
      roadDistM: roadM,
      channelPos,
      prevStampChannelPos: channelPos,
      prevStampRoadDistM: roadM,
      terminalStillTicks: 0,
      lon,
      lat,
      channelsPerTick: mphToChannelsPerTick(speedMph),
      desiredSpeedMph: speedMph,
      speedMph,
      vehicleType,
      currentMilepost: 0,
      dead: false,
      userLock: false,
      userPlaced: Boolean(opts.userPlaced),
    };
    vehicles.push(v);
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
      prevStampChannelPos: cp,
      prevStampRoadDistM: cp * CHANNEL_SPACING_M,
      terminalStillTicks: 0,
      lon: ch.lon,
      lat: ch.lat,
      channelsPerTick: mphToChannelsPerTick(speedMph),
      desiredSpeedMph: speedMph,
      speedMph,
      vehicleType,
      currentMilepost: 0,
      dead: false,
      userLock: false,
      userPlaced: Boolean(opts.userPlaced),
    };
    vehicles.push(v);
    return v;
  }

  function placeVehicleAtLngLat(lng, lat, opts = {}) {
    if (!roadOk) return false;
    const prefer = opts.placementLane;
    const snap = prefer && prefer !== 'auto'
      ? nearestPointOnLanesPrefer(laneEb, laneWb, lng, lat, prefer)
      : nearestPointOnLanes(laneEb, laneWb, lng, lat);
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
      const newCp = clampChannelPosToFiber(
        roadDistanceToChannelPos(lane, roadM),
        totalChannels,
      );
      existing.channelPos = newCp;
      existing.prevStampChannelPos = newCp;
      existing.prevStampRoadDistM = roadM;
      existing.terminalStillTicks = 0;
      const ll = lonLatAtRoadDistance(lane, roadM);
      existing.lon = ll[0];
      existing.lat = ll[1];
      existing.desiredSpeedMph = speed;
      existing.vehicleType = vtype;
      return true;
    }

    const v = spawnUserVehicleAtRoad(snap.laneKey, roadM, {
      forceSpeed: speed,
      vehicleType: vtype,
      userPlaced: true,
    });
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
    existing.prevStampChannelPos = best;
    existing.prevStampRoadDistM = best * CHANNEL_SPACING_M;
    existing.terminalStillTicks = 0;
    existing.roadDistM = best * CHANNEL_SPACING_M;
    existing.lon = channels[best].lon;
    existing.lat = channels[best].lat;
    return true;
  }

  function addVehicleNearLngLat(lng, lat, opts = {}) {
    const merged = {
      ...opts,
      vehicleType: normalizeVehicleType(opts.vehicleType ?? defaultVehicleType),
    };
    if (roadOk) {
      const prefer = merged.placementLane;
      const snap = prefer && prefer !== 'auto'
        ? nearestPointOnLanesPrefer(laneEb, laneWb, lng, lat, prefer)
        : nearestPointOnLanes(laneEb, laneWb, lng, lat);
      if (!snap || snap.distanceM > LAB_SNAP_MAX_M) return null;
      const v = spawnUserVehicleAtRoad(snap.laneKey, snap.roadDistM, { ...merged, userPlaced: true });
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
    const v = spawnUserVehicleLegacy(best, dir, { ...merged, userPlaced: true });
    return v;
  }

  function removeVehicle(id) {
    const before = vehicles.length;
    vehicles = vehicles.filter((v) => v.id !== id);
    if (selectedVehicleId === id) setSelectedVehicleId(null);
    if (dragVehicleId === id) dragVehicleId = null;
    syncVehicleCallouts(targets.map, vehicles, selectedVehicleId);
    return vehicles.length < before;
  }

  function channelSpanForHazardOnRoad(lane, roadDistM, lengthM) {
    const half = lengthM / 2;
    const maxS = lane.totalM;
    const r0 = Math.max(0, Math.min(maxS, roadDistM - half));
    const r1 = Math.max(0, Math.min(maxS, roadDistM + half));
    const c0 = roadDistanceToChannelPos(lane, r0);
    const c1 = roadDistanceToChannelPos(lane, r1);
    const lo = Math.floor(Math.min(c0, c1));
    const hi = Math.ceil(Math.max(c0, c1));
    return {
      startChannel: Math.max(0, Math.min(totalChannels - 1, lo)),
      endChannel: Math.max(0, Math.min(totalChannels - 1, hi)),
    };
  }

  function addHazardNearLngLat(lng, lat, opts = {}) {
    const kind = normalizeHazardKind(opts.kind);
    const size = normalizeHazardSize(opts.size);
    const peakIntensity = hazardPeakIntensity(kind, size);
    const phase = Math.random() * Math.PI * 2;
    const { lengthM, leftWidthM, rightWidthM } = lateralWidthsForHazard(kind, size);

    if (roadOk) {
      const prefer = opts.placementLane;
      const snap =
        prefer && prefer !== 'auto'
          ? nearestPointOnLanesPrefer(laneEb, laneWb, lng, lat, prefer)
          : nearestPointOnLanes(laneEb, laneWb, lng, lat);
      if (!snap || snap.distanceM > LAB_SNAP_MAX_M) return null;
      const laneKey = snap.laneKey;
      const lane = laneKey === 'eb' ? laneEb : laneWb;
      if (!lane) return null;
      const roadM = Math.max(0, Math.min(lane.totalM, snap.roadDistM));
      const dir = directionForLane(laneKey);
      const bearingDeg = travelBearingDegAtRoadDistance(lane, roadM, dir);
      const [centerLon, centerLat] = lonLatAtRoadDistance(lane, roadM);
      const geom = buildCorridorPolygonLonLat(
        centerLon,
        centerLat,
        bearingDeg,
        lengthM,
        leftWidthM,
        rightWidthM,
      );
      const { startChannel, endChannel } = channelSpanForHazardOnRoad(lane, roadM, lengthM);
      const h = {
        id: formatHazardId(nextHazardSeq++),
        kind,
        size,
        laneKey,
        roadDistM: roadM,
        peakIntensity,
        phase,
        startTick: tickCount + 1,
        startChannel,
        endChannel,
        geometry: geom,
      };
      hazards.push(h);
      return h;
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
    const halfCh = hazardFallbackChannelHalfWidth(size);
    const startChannel = Math.max(0, best - halfCh);
    const endChannel = Math.min(totalChannels - 1, best + halfCh);
    const ch0 = channels[best];
    const ch1 = channels[Math.min(best + 1, totalChannels - 1)];
    const bearingDeg = bearingDegClockwiseFromNorthLonLat(ch0.lon, ch0.lat, ch1.lon, ch1.lat);
    const geom = buildCorridorPolygonLonLat(
      ch0.lon,
      ch0.lat,
      bearingDeg,
      lengthM,
      leftWidthM,
      rightWidthM,
    );
    const h = {
      id: formatHazardId(nextHazardSeq++),
      kind,
      size,
      laneKey: null,
      roadDistM: undefined,
      peakIntensity,
      phase,
      startTick: tickCount + 1,
      startChannel,
      endChannel,
      geometry: geom,
    };
    hazards.push(h);
    return h;
  }

  function clearFleet() {
    vehicles = [];
    hazards = [];
    setSelectedVehicleId(null);
    dragVehicleId = null;
    clearVehicleCallouts(targets.map);
    updateMapVehicles(targets.map, []);
    updateMapHazards(targets.map, []);
    targets.ui.updateStats(vehicles, hazards);
  }

  const DEMO_FLEET_MAX = 300;
  const DEMO_ROAD_FRAC_MARGIN = 0.02;

  function randomDemoSpeedMph() {
    return 22 + Math.random() * 38;
  }

  function applyQuickFleet(totalVehicles = 12) {
    clearFleet();
    const n = Math.max(1, Math.min(DEMO_FLEET_MAX, Math.floor(totalVehicles)));

    if (roadOk) {
      const lo = DEMO_ROAD_FRAC_MARGIN;
      const hi = 1 - DEMO_ROAD_FRAC_MARGIN;
      for (let i = 0; i < n; i++) {
        const laneKey = Math.random() < 0.5 ? 'eb' : 'wb';
        const lane = laneKey === 'eb' ? laneEb : laneWb;
        const roadFrac = lo + Math.random() * (hi - lo);
        spawnUserVehicleAtRoad(laneKey, lane.totalM * roadFrac, {
          forceSpeed: randomDemoSpeedMph(),
          vehicleType: VEHICLE_TYPES[Math.floor(Math.random() * VEHICLE_TYPES.length)],
          userPlaced: true,
        });
      }
    } else {
      for (let i = 0; i < n; i++) {
        const dir = Math.random() < 0.5 ? 'up_canyon' : 'down_canyon';
        const t = 0.06 + Math.random() * 0.88;
        spawnUserVehicleLegacy(totalChannels * t, dir, {
          forceSpeed: randomDemoSpeedMph(),
          vehicleType: VEHICLE_TYPES[Math.floor(Math.random() * VEHICLE_TYPES.length)],
          userPlaced: true,
        });
      }
    }

    if (vehicles.length > 0) {
      const ch = Math.floor(vehicles[0].channelPos);
      const pad = 600;
      targets.waterfall.setViewRange?.(ch - pad, ch + pad);
    }
  }

  function setVehicleDesiredSpeed(id, mph) {
    const v = vehicleById(id);
    if (!v) return false;
    const clamped = Math.max(0, Math.min(85, mph));
    v.desiredSpeedMph = clamped;
    v.speedMph = clamped;
    v.channelsPerTick = mphToChannelsPerTick(clamped);
    return true;
  }

  function setVehicleType(id, vehicleType) {
    const v = vehicleById(id);
    if (!v) return false;
    v.vehicleType = normalizeVehicleType(vehicleType);
    return true;
  }

  function setVehicleLaneKey(id, laneKey) {
    const v = vehicleById(id);
    if (!v || !roadOk) return false;
    if (laneKey !== 'eb' && laneKey !== 'wb') return false;
    if (v.laneKey === laneKey) return true;
    const newLane = laneKey === 'eb' ? laneEb : laneWb;
    if (!newLane) return false;
    const snap = nearestPointOnLane(newLane, v.lon, v.lat);
    if (!snap) return false;
    const roadM = Math.max(0, Math.min(newLane.totalM, snap.roadDistM));
    v.laneKey = laneKey;
    v.direction = directionForLane(laneKey);
    v.roadDistM = roadM;
    v.channelPos = clampChannelPosToFiber(
      roadDistanceToChannelPos(newLane, roadM),
      totalChannels,
    );
    v.prevStampChannelPos = v.channelPos;
    v.prevStampRoadDistM = roadM;
    v.terminalStillTicks = 0;
    const ll = lonLatAtRoadDistance(newLane, roadM);
    v.lon = ll[0];
    v.lat = ll[1];
    v.channelsPerTick = mphToChannelsPerTick(v.speedMph);
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
    hazards = [];
    selectedVehicleId = null;
    dragVehicleId = null;
    plotFocusChannel = null;
    intervalId = setInterval(tick, TICK_MS);
    targets.ui.updateStats(vehicles, hazards);
  }

  const api = {
    start,
    isRoadOk: () => roadOk,
    getVehicles: () => vehicles,
    getSelectedVehicleId: () => selectedVehicleId,
    setSelectedVehicleId,
    focusMapOnChannel,
    addVehicleNearLngLat,
    addHazardNearLngLat,
    placeVehicleAtLngLat,
    removeVehicle,
    clearFleet,
    applyQuickFleet,
    setVehicleDesiredSpeed,
    setVehicleType,
    setVehicleLaneKey,
    getDefaultVehicleType: () => defaultVehicleType,
    setDefaultVehicleType: (t) => {
      defaultVehicleType = normalizeVehicleType(t);
    },
    getDragVehicleId: () => dragVehicleId,
    setDragVehicleId: (id) => {
      for (const v of vehicles) {
        v.userLock = false;
      }
      dragVehicleId = id;
      if (id) {
        const v = vehicleById(id);
        if (v) v.userLock = true;
      }
    },
    moveVehicleToLngLat,
    releaseDragLocks,
    syncFleetPanel: () => {},
  };

  syncFleetPanelFn = () => targets.ui.refreshFleetPanel(api);
  api.syncFleetPanel = syncFleetPanelFn;

  return api;
}
