/**
 * Traffic-first DAS simulator: user-controlled vehicles on SR-190 lanes drive
 * car-following dynamics; strain-rate proxy is synthesized each tick for the waterfall.
 * Hazards (e.g. rock slide) are event bands on the fiber — extend for avalanche later.
 */

import { updateMapVehicles, updateMapAnomalies } from './map.js';
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
import { stampHazardOntoRow, hazardInitialTtl, hazardSpanChannels } from './hazard-stamp.js';

const CHANNEL_SPACING_M = 2.0;
const TICK_MS = 100;
const MS_PER_S = 1000;
const MPH_TO_MS = 0.44704;

/** Extra Δchannels/tick in waterfall stamping so tracks read diagonal when road ≈ fiber. */
const WATERFALL_DIAGONAL_SKEW = 0.78;

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
let anomalies = [];
let nextFleetId = 1;
let nextHazardId = 1;
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

/** Offset in meters along road forward and to the driver's right (ENU, WGS84). */
function offsetLonLatMeters(centerLon, centerLat, bearingDeg, alongM, rightM) {
  const br = (bearingDeg * Math.PI) / 180;
  const dE = alongM * Math.sin(br) + rightM * Math.cos(br);
  const dN = alongM * Math.cos(br) - rightM * Math.sin(br);
  const cosφ = Math.cos((centerLat * Math.PI) / 180);
  return [centerLon + dE / (111320 * Math.max(0.25, Math.abs(cosφ))), centerLat + dN / 111320];
}

function hash01(i, j, salt) {
  let h = (i * 374761393 + j * 668265263 + salt * 1442695041) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Tight hex-like pile of small extrusions (deck.gl HexagonLayer-style look without extra deps).
 */
function buildHazardHexClusterFeatures(
  centerLon,
  centerLat,
  bearingDeg,
  kind,
  magnitude,
  spanCh,
  decay,
  tickAge,
  hazardId,
  zBoost,
) {
  const isAvalanche = kind === 'avalanche';
  const mag = Math.max(0, Math.min(1, magnitude));
  const span = Math.max(1, spanCh);
  const debrisBoost = zBoost * 1.12;

  const halfLen = Math.min(
    isAvalanche ? 118 : 96,
    (10 + span * 0.42 + mag * 36) * debrisBoost * 0.5,
  );
  const halfW = Math.min(
    isAvalanche ? 52 : 34,
    (5 + span * 0.09 + mag * 16) * debrisBoost * 0.5,
  );

  const pitch = Math.max(2.1, Math.min(4.6, 2.35 + mag * 1.9 + span * 0.0018));
  const dx = pitch * 0.866;
  const dy = pitch * 0.75;
  const rows = Math.ceil(halfW / dy) + 1;
  const cols = Math.ceil(halfLen / dx) + 1;

  const baseH = isAvalanche
    ? Math.max(9, 6 + mag * 24 + span * 0.06)
    : Math.max(7, 4.5 + mag * 19 + span * 0.05);

  const features = [];
  const salt = (String(hazardId).split('').reduce((s, c) => s + c.charCodeAt(0), 0) | 0) % 997;

  for (let r = -rows; r <= rows; r++) {
    const y = r * dy;
    const x0 = (r % 2) * (dx * 0.5);
    for (let c = -cols; c <= cols; c++) {
      const x = c * dx + x0;
      if ((x * x) / (halfLen * halfLen + 1e-6) + (y * y) / (halfW * halfW + 1e-6) > 1) continue;

      const u = hash01(c, r, salt);
      const v = hash01(c + 17, r - 3, salt + 1);
      const wobble = (u - 0.5) * pitch * 0.22;
      const [lon, lat] = offsetLonLatMeters(centerLon, centerLat, bearingDeg, x + wobble, y + (v - 0.5) * pitch * 0.18);

      const cellW = pitch * (0.82 + u * 0.14);
      const cellL = pitch * (0.78 + v * 0.16);
      const hVar = baseH * (0.55 + u * 0.5) + (isAvalanche ? v * 5.5 : v * 4.2);
      const cellH = Math.max(2.5, hVar);

      let fillHex;
      if (isAvalanche) {
        const t = 0.35 + u * 0.45 + mag * 0.12;
        fillHex = mixRgbWithHex('#eceff1', '#ffffff', t + (v - 0.5) * 0.08);
        fillHex = mixRgbWithHex(fillHex, '#b0bec5', (1 - mag) * 0.12);
      } else {
        const t = 0.28 + u * 0.55 + mag * 0.1;
        fillHex = mixRgbWithHex('#d7ccc8', '#8d6e63', t);
        fillHex = mixRgbWithHex(fillHex, '#efebe9', v * 0.25);
      }

      const geom = buildVehicleFootprintPolygon(lon, lat, cellL, cellW, bearingDeg + (u - 0.5) * 14);
      features.push({
        type: 'Feature',
        properties: {
          hazard_kind: kind,
          id: hazardId,
          decay,
          tick_age: tickAge,
          hazard_cell: 1,
          height_m: cellH,
          cell_fill: fillHex,
        },
        geometry: geom,
      });
    }
  }
  return features;
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

  function snapIntentToFiber(lng, lat) {
    if (roadOk && laneEb && laneWb) {
      const snap = nearestPointOnLanes(laneEb, laneWb, lng, lat);
      if (!snap || snap.distanceM > LAB_SNAP_MAX_M) return null;
      const lane = snap.laneKey === 'eb' ? laneEb : laneWb;
      const roadM = Math.max(0, Math.min(lane.totalM, snap.roadDistM));
      const channelPos = clampChannelPosToFiber(
        roadDistanceToChannelPos(lane, roadM),
        totalChannels,
      );
      return {
        channelPos,
        lon: snap.lon,
        lat: snap.lat,
        roadDistM: roadM,
        laneKey: snap.laneKey,
      };
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
    const ch = channels[best];
    return {
      channelPos: best,
      lon: ch.lon,
      lat: ch.lat,
      roadDistM: best * CHANNEL_SPACING_M,
      laneKey: null,
    };
  }

  function buildHazardMapFeatures(anoms) {
    const z = targets.map?.getZoom?.();
    const zBoost = mapVehicleExtentBoostFromZoom(z);

    return anoms.flatMap((a) => {
      const kind = a.kind || a.subtype || 'rock_slide';
      const midIdx = Math.min(
        Math.max(0, Math.floor((a.startChannel + a.endChannel) / 2)),
        totalChannels - 1,
      );
      const ch = channels[midIdx];
      const decay = a.initialTtl > 0 ? a.ttl / a.initialTtl : 0;
      const tickAge = tickCount - (a.tickCreated ?? tickCount);
      const mag = a.magnitude ?? 0.5;

      const markerGlyph =
        kind === 'crash' ? '⚠️' : kind === 'avalanche' ? '❄' : '⛰';

      if (kind === 'crash') {
        const lane = a.laneKey === 'wb' ? laneWb : laneEb;
        let bearingDeg;
        if (roadOk && lane && typeof a.roadDistM === 'number' && a.laneKey) {
          const dir = a.laneKey === 'wb' ? 'down_canyon' : 'up_canyon';
          bearingDeg = travelBearingDegAtRoadDistance(lane, a.roadDistM, dir);
        } else {
          const i0 = Math.max(0, Math.min(totalChannels - 2, midIdx));
          const c0 = channels[i0];
          const c1 = channels[Math.min(i0 + 1, totalChannels - 1)];
          bearingDeg = bearingDegClockwiseFromNorthLonLat(c0.lon, c0.lat, c1.lon, c1.lat);
        }
        const nVeh = a.vehicleCount ?? 1;
        const lenM = (5.5 + nVeh * 3.2 + mag * 4) * zBoost * 1.22;
        const widthM = (3.2 + nVeh * 0.9) * zBoost * 1.18;
        const heightM = Math.max(5, 3.2 + nVeh * 1.8 + mag * 5 + nVeh * 1.2);
        const lon = a.lon ?? ch.lon;
        const lat = a.lat ?? ch.lat;
        const geom = buildVehicleFootprintPolygon(lon, lat, lenM, widthM, bearingDeg);
        const footprint = {
          type: 'Feature',
          properties: {
            hazard_kind: kind,
            id: a.id,
            subtype: a.subtype,
            intensity: a.intensity,
            milepost: ch.milepost.toFixed(1),
            decay,
            tick_age: tickAge,
            height_m: heightM,
            vehicles: nVeh,
          },
          geometry: geom,
        };

        const markers = [];
        const stepM = Math.max(2.8, Math.min(5.2, 3.4 + mag * 1.1));
        const half = (nVeh - 1) * 0.5;
        for (let vi = 0; vi < nVeh; vi++) {
          const along = (vi - half) * stepM;
          let mLon;
          let mLat;
          if (roadOk && lane && typeof a.roadDistM === 'number') {
            const roadM = Math.max(0, Math.min(lane.totalM, a.roadDistM + along));
            const ll = lonLatAtRoadDistance(lane, roadM);
            mLon = ll[0];
            mLat = ll[1];
          } else {
            const o = offsetLonLatMeters(lon, lat, bearingDeg, along, 0);
            mLon = o[0];
            mLat = o[1];
          }
          markers.push({
            type: 'Feature',
            properties: {
              hazard_kind: kind,
              id: a.id,
              decay,
              hazard_marker: 1,
              marker_glyph: markerGlyph,
              marker_role: 'crash',
            },
            geometry: { type: 'Point', coordinates: [mLon, mLat] },
          });
        }
        return [footprint, ...markers];
      }

      const lane = a.laneKey === 'wb' ? laneWb : laneEb;
      let bearingDeg;
      if (roadOk && lane && typeof a.roadDistM === 'number' && a.laneKey) {
        const dir = a.laneKey === 'wb' ? 'down_canyon' : 'up_canyon';
        bearingDeg = travelBearingDegAtRoadDistance(lane, a.roadDistM, dir);
      } else {
        const i0 = Math.max(0, Math.min(totalChannels - 2, midIdx));
        const c0 = channels[i0];
        const c1 = channels[Math.min(i0 + 1, totalChannels - 1)];
        bearingDeg = bearingDegClockwiseFromNorthLonLat(c0.lon, c0.lat, c1.lon, c1.lat);
      }

      const spanCh = Math.max(1, Math.abs(a.endChannel - a.startChannel));

      const lon = a.lon ?? ch.lon;
      const lat = a.lat ?? ch.lat;

      const cells = buildHazardHexClusterFeatures(
        lon,
        lat,
        bearingDeg,
        kind,
        mag,
        spanCh,
        decay,
        tickAge,
        a.id,
        zBoost,
      );

      const marker = {
        type: 'Feature',
        properties: {
          hazard_kind: kind,
          id: a.id,
          decay,
          hazard_marker: 1,
          marker_glyph: markerGlyph,
          marker_role: 'mass',
        },
        geometry: { type: 'Point', coordinates: [lon, lat] },
      };
      return [...cells, marker];
    });
  }

  function syncHazardMapLayer() {
    const m = targets.map;
    if (!m?.getSource?.('anomalies')) return;
    updateMapAnomalies(m, buildHazardMapFeatures(anomalies));
  }

  function addHazardAtLngLat(kind, lng, lat, opts = {}) {
    const snap = snapIntentToFiber(lng, lat);
    if (!snap) return null;
    const magnitude =
      typeof opts.magnitude === 'number' && Number.isFinite(opts.magnitude)
        ? Math.max(0, Math.min(1, opts.magnitude))
        : 0.55;
    const vehicleCount = Math.min(3, Math.max(1, Math.floor(opts.vehicleCount ?? 1)));
    const halfSpan = Math.floor(hazardSpanChannels(kind, magnitude, totalChannels));
    let startChannel = Math.floor(snap.channelPos) - halfSpan;
    let endChannel = Math.floor(snap.channelPos) + halfSpan;
    startChannel = Math.max(0, Math.min(totalChannels - 1, startChannel));
    endChannel = Math.max(0, Math.min(totalChannels - 1, endChannel));
    if (endChannel < startChannel) {
      const t = startChannel;
      startChannel = endChannel;
      endChannel = t;
    }

    const intensity =
      kind === 'crash' ? 0.78 + vehicleCount * 0.07 : 0.68 + magnitude * 0.26;
    const initialTtl = hazardInitialTtl(kind, magnitude, vehicleCount);

    const id = `HAZ-${String(nextHazardId++).padStart(4, '0')}`;
    const a = {
      id,
      kind,
      subtype: kind,
      startChannel,
      endChannel,
      anchorChannel: snap.channelPos,
      channelCenter: snap.channelPos,
      intensity,
      initialTtl,
      ttl: initialTtl,
      phase: Math.random() * Math.PI * 2,
      magnitude,
      vehicleCount: kind === 'crash' ? vehicleCount : undefined,
      tickCreated: tickCount,
      lon: snap.lon,
      lat: snap.lat,
      laneKey: snap.laneKey,
      roadDistM: snap.roadDistM,
    };
    anomalies.push(a);
    targets.waterfall.scrollChannelIntoView(snap.channelPos);
    syncHazardMapLayer();
    return a;
  }

  function extendHazardRange(id, lng, lat) {
    const a = anomalies.find((x) => x.id === id);
    if (!a || (a.kind !== 'rock_slide' && a.kind !== 'avalanche')) return false;
    const snap = snapIntentToFiber(lng, lat);
    if (!snap) return false;
    const ci = Math.floor(snap.channelPos);
    a.startChannel = Math.max(0, Math.min(totalChannels - 1, Math.min(a.startChannel, ci)));
    a.endChannel = Math.max(0, Math.min(totalChannels - 1, Math.max(a.endChannel, ci)));
    if (a.endChannel < a.startChannel) {
      const t = a.startChannel;
      a.startChannel = a.endChannel;
      a.endChannel = t;
    }
    const mid = Math.floor((a.startChannel + a.endChannel) / 2);
    const ch = channels[mid];
    a.lon = ch.lon;
    a.lat = ch.lat;
    if (roadOk && a.laneKey && (a.laneKey === 'eb' || a.laneKey === 'wb')) {
      const lane = a.laneKey === 'eb' ? laneEb : laneWb;
      if (lane) {
        const roadM = Math.max(0, Math.min(lane.totalM, snap.roadDistM));
        a.roadDistM = roadM;
      }
    }
    syncHazardMapLayer();
    return true;
  }

  function setHazardChannelRange(id, channelPosA, channelPosB) {
    const a = anomalies.find((x) => x.id === id);
    if (!a) return false;
    let lo = Math.floor(Math.min(channelPosA, channelPosB));
    let hi = Math.ceil(Math.max(channelPosA, channelPosB));
    lo = Math.max(0, Math.min(totalChannels - 1, lo));
    hi = Math.max(0, Math.min(totalChannels - 1, hi));
    a.startChannel = lo;
    a.endChannel = hi;
    const mid = Math.floor((lo + hi) / 2);
    const ch = channels[mid];
    a.lon = ch.lon;
    a.lat = ch.lat;
    syncHazardMapLayer();
    return true;
  }

  function getHazardById(id) {
    return anomalies.find((x) => x.id === id) ?? null;
  }

  function nearestLaneSnap(lng, lat) {
    if (!roadOk || !laneEb || !laneWb) return null;
    const snap = nearestPointOnLanes(laneEb, laneWb, lng, lat);
    if (!snap || snap.distanceM > LAB_SNAP_MAX_M) return null;
    const lane = snap.laneKey === 'eb' ? laneEb : laneWb;
    const roadM = Math.max(0, Math.min(lane.totalM, snap.roadDistM));
    return {
      laneKey: snap.laneKey,
      roadDistM: roadM,
      lon: snap.lon,
      lat: snap.lat,
      laneTotalM: lane.totalM,
    };
  }

  function channelPosAtRoadDistance(laneKey, roadDistM) {
    if (!roadOk) return null;
    const lane = laneKey === 'wb' ? laneWb : laneEb;
    if (!lane) return null;
    const roadM = Math.max(0, Math.min(lane.totalM, roadDistM));
    return clampChannelPosToFiber(roadDistanceToChannelPos(lane, roadM), totalChannels);
  }

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
      targets.waterfall.scrollChannelIntoView(v.channelPos);
    }
    if (v) {
      targets.waterfall.setHighlightChannel(
        Math.min(Math.max(0, Math.floor(v.channelPos)), totalChannels - 1),
      );
    } else if (plotFocusChannel !== null) {
      targets.waterfall.setHighlightChannel(plotFocusChannel);
    } else {
      targets.waterfall.setHighlightChannel(null);
    }
    syncFleetPanelFn();
  }

  function focusMapOnChannel(channelIndex) {
    const ci = Math.max(0, Math.min(totalChannels - 1, Math.floor(channelIndex)));
    const ch = channels[ci];
    if (!ch) return;
    plotFocusChannel = ci;
    targets.waterfall.scrollChannelIntoView(ci);
    targets.waterfall.setHighlightChannel(ci);
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

          if (v.roadDistM < -30 || v.roadDistM > lane.totalM + 30) {
            v.dead = true;
          } else {
            v.roadDistM = Math.max(0, Math.min(lane.totalM, v.roadDistM));
          }

          v.channelPos = clampChannelPosToFiber(
            roadDistanceToChannelPos(lane, v.roadDistM),
            totalChannels,
          );
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
      setSelectedVehicleId(vehicles[0]?.id ?? null);
    }

    for (const v of vehicles) {
      const ci = Math.min(Math.max(0, Math.floor(v.channelPos)), totalChannels - 1);
      v.currentMilepost = channels[ci].milepost;
    }

    for (const a of anomalies) a.ttl -= 1;
    anomalies = anomalies.filter((a) => a.ttl > 0);

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
      const center = v.channelPos;
      const prev = typeof v.prevChannelPos === 'number' ? v.prevChannelPos : center;
      v.prevChannelPos = center;

      const { halfWidth, strength } = vehicleDasFootprint(v.vehicleType);
      const mph = Math.max(0, v.speedMph);
      const speedCoupling = 0.82 + 0.18 * Math.min(1, mph / 42);
      const classHeat = vehicleDasClassHeat(v.vehicleType);
      const microRipple = 0.92 + 0.08 * Math.sin(center * 0.11 + tickCount * 0.17 + v.id.length * 0.31);
      let peakStrength =
        strength * classHeat * microRipple * (0.96 + Math.random() * 0.04) * speedCoupling;

      const cpt =
        typeof v.channelsPerTick === 'number' && v.channelsPerTick > 0
          ? v.channelsPerTick
          : mphToChannelsPerTick(Math.max(1, mph));
      const skewSign = v.direction === 'up_canyon' ? 1 : -1;
      const skew = skewSign * WATERFALL_DIAGONAL_SKEW * cpt;
      const stampPrev = prev - skew * 0.5;
      const stampCenter = center + skew * 0.5;

      const delta = stampCenter - stampPrev;
      const pathLen = Math.abs(delta);
      if (pathLen < 0.02) {
        stampVehicleEnergyAt(stampCenter, peakStrength, halfWidth);
      } else {
        const nSteps = Math.min(40, Math.max(2, Math.ceil(pathLen * 3 + 4)));
        // Old 1/sqrt(n) made each sub-step so weak that diagonals sat in cyan/green only.
        const stackScale = 1 / Math.pow(nSteps, 0.15);
        for (let s = 0; s < nSteps; s++) {
          const u = nSteps === 1 ? 1 : s / (nSteps - 1);
          const pos = stampPrev + delta * u;
          const along = 0.68 + 0.32 * (1 - Math.abs(u - 0.5) * 2);
          stampVehicleEnergyAt(pos, peakStrength * along * stackScale, halfWidth);
        }
      }
    }

    for (const a of anomalies) {
      stampHazardOntoRow(row, a, totalChannels, tickCount);
    }

    targets.waterfall.pushRow(row);
    targets.waterfall.render();

    const sel = selectedVehicleId ? vehicleById(selectedVehicleId) : null;
    if (sel) {
      targets.waterfall.setHighlightChannel(
        Math.min(Math.max(0, Math.floor(sel.channelPos)), totalChannels - 1),
      );
    } else if (plotFocusChannel !== null) {
      targets.waterfall.setHighlightChannel(plotFocusChannel);
    } else {
      targets.waterfall.setHighlightChannel(null);
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
        const sel = v.id === selectedVehicleId;
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
        const fillColor = rgbaFromHex(baseFillHex, sel ? 0.96 : v.userPlaced ? 0.9 : 0.82);
        let outlineColor;
        if (v.userPlaced) {
          outlineColor = sel
            ? rgbaFromHex(mixRgbWithHex(baseFillHex, '#ffffff', 0.4), 0.95)
            : rgbaFromHex(baseFillHex, 0.88);
        } else {
          outlineColor = sel ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.42)';
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
            glow_color: glowColor,
          },
          geometry: geom,
        };
      });

    const anomalyFeatures = buildHazardMapFeatures(anomalies);

    updateMapVehicles(targets.map, vehicleFeatures);
    syncVehicleCallouts(targets.map, vehicles);
    updateMapAnomalies(targets.map, anomalyFeatures);

    targets.ui.updateStats(vehicles, anomalies, {
      simTimeS: tickCount * (TICK_MS / MS_PER_S),
    });

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
      prevChannelPos: channelPos,
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
      prevChannelPos: cp,
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
    targets.waterfall.scrollChannelIntoView(cp);
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
      existing.prevChannelPos = existing.channelPos;
      existing.channelPos = newCp;
      const ll = lonLatAtRoadDistance(lane, roadM);
      existing.lon = ll[0];
      existing.lat = ll[1];
      existing.desiredSpeedMph = speed;
      existing.vehicleType = vtype;
      targets.waterfall.scrollChannelIntoView(existing.channelPos);
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
    existing.prevChannelPos = existing.channelPos;
    existing.channelPos = best;
    existing.roadDistM = best * CHANNEL_SPACING_M;
    existing.lon = channels[best].lon;
    existing.lat = channels[best].lat;
    targets.waterfall.scrollChannelIntoView(best);
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
    const v = spawnUserVehicleLegacy(best, dir, { ...merged, userPlaced: true });
    if (v) setSelectedVehicleId(v.id);
    return v;
  }

  function removeVehicle(id) {
    const before = vehicles.length;
    vehicles = vehicles.filter((v) => v.id !== id);
    if (selectedVehicleId === id) setSelectedVehicleId(vehicles[0]?.id ?? null);
    if (dragVehicleId === id) dragVehicleId = null;
    syncVehicleCallouts(targets.map, vehicles);
    return vehicles.length < before;
  }

  function clearFleet() {
    vehicles = [];
    anomalies = [];
    nextHazardId = 1;
    setSelectedVehicleId(null);
    dragVehicleId = null;
    clearVehicleCallouts(targets.map);
    updateMapVehicles(targets.map, []);
    updateMapAnomalies(targets.map, []);
    targets.ui.updateStats(vehicles, anomalies, { simTimeS: 0 });
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
    setSelectedVehicleId(vehicles[0]?.id ?? null);

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
    v.prevChannelPos = v.channelPos;
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
    anomalies = [];
    nextHazardId = 1;
    selectedVehicleId = null;
    dragVehicleId = null;
    plotFocusChannel = null;
    intervalId = setInterval(tick, TICK_MS);
    targets.ui.updateChannelCount(totalChannels);
    targets.ui.updateStats(vehicles, anomalies, { simTimeS: 0 });
    syncHazardMapLayer();
  }

  const api = {
    start,
    isRoadOk: () => roadOk,
    getVehicles: () => vehicles,
    getSelectedVehicleId: () => selectedVehicleId,
    setSelectedVehicleId,
    focusMapOnChannel,
    addVehicleNearLngLat,
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
    addHazardAtLngLat,
    extendHazardRange,
    setHazardChannelRange,
    getHazardById,
    syncHazardMapLayer,
    nearestLaneSnap,
    channelPosAtRoadDistance,
    getChannels: () => channels,
    syncFleetPanel: () => {},
  };

  syncFleetPanelFn = () => targets.ui.refreshFleetPanel(api);
  api.syncFleetPanel = syncFleetPanelFn;

  return api;
}
