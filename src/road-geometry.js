/**
 * Road centerline sampling for simulation: resample WB/EB lanes and map each sample
 * to the nearest fiber channel so vehicles move along the road while DAS stays
 * fiber-indexed (waterfall horizontal axis).
 */

const EARTH_RADIUS_M = 6371000;
const SAMPLE_SPACING_M = 2.0;

function haversine(lon1, lat1, lon2, lat2) {
  const rlat1 = (lat1 * Math.PI) / 180;
  const rlat2 = (lat2 * Math.PI) / 180;
  const dlat = ((lat2 - lat1) * Math.PI) / 180;
  const dlon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(rlat1) * Math.cos(rlat2) * Math.sin(dlon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function segmentLengthM(a, b) {
  return haversine(a[0], a[1], b[0], b[1]);
}

/** Merge coordinates from LineString / MultiLineString features into one polyline per lane id. */
function lanePolylinesFromRoad(roadGeojson) {
  const byLane = { eb: [], wb: [] };

  for (const feat of roadGeojson.features ?? []) {
    const alias = feat.properties?.ROUTE_ALIAS_COMMON ?? '';
    const lower = String(alias).toLowerCase();
    let key = null;
    if (lower.includes('eb') || lower.includes('east')) key = 'eb';
    else if (lower.includes('wb') || lower.includes('west')) key = 'wb';
    if (!key) continue;

    const g = feat.geometry;
    if (g.type === 'LineString') {
      byLane[key].push(g.coordinates.map((c) => [c[0], c[1]]));
    } else if (g.type === 'MultiLineString') {
      for (const part of g.coordinates) {
        byLane[key].push(part.map((c) => [c[0], c[1]]));
      }
    }
  }

  const pickLongest = (segments) => {
    if (segments.length === 0) return [];
    let best = segments[0];
    let bestLen = 0;
    for (const seg of segments) {
      let len = 0;
      for (let i = 1; i < seg.length; i++) len += segmentLengthM(seg[i - 1], seg[i]);
      if (len > bestLen) {
        bestLen = len;
        best = seg;
      }
    }
    return best;
  };

  let eb = pickLongest(byLane.eb);
  let wb = pickLongest(byLane.wb);
  if (eb.length < 2 && wb.length >= 2) eb = wb.slice();
  if (wb.length < 2 && eb.length >= 2) wb = eb.slice();

  if (eb.length < 2 && wb.length < 2) {
    const all = [];
    for (const feat of roadGeojson.features ?? []) {
      const g = feat.geometry;
      if (g.type === 'LineString') all.push(g.coordinates.map((c) => [c[0], c[1]]));
      else if (g.type === 'MultiLineString') {
        for (const part of g.coordinates) all.push(part.map((c) => [c[0], c[1]]));
      }
    }
    const fallback = pickLongest(all);
    if (fallback.length >= 2) {
      eb = fallback;
      wb = fallback.slice();
    }
  }

  return { eb, wb };
}

function resamplePolyline(coords, spacingM) {
  if (coords.length < 2) {
    return { points: coords.slice(), cumDistM: [0], segmentLengths: [] };
  }

  const dense = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const len = segmentLengthM(a, b);
    if (len < 1e-6) continue;
    const nInsert = Math.floor(len / spacingM);
    for (let k = 1; k <= nInsert; k++) {
      const t = (k * spacingM) / len;
      if (t < 1) {
        dense.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
    }
    dense.push(b);
  }

  const cumDistM = [0];
  const segmentLengths = [];
  for (let i = 1; i < dense.length; i++) {
    const d = segmentLengthM(dense[i - 1], dense[i]);
    segmentLengths.push(d);
    cumDistM.push(cumDistM[i - 1] + d);
  }

  return { points: dense, cumDistM, segmentLengths };
}

function nearestChannelIndex(lon, lat, channels, hintIndex) {
  const n = channels.length;
  let i0 = Math.max(0, Math.min(n - 1, hintIndex ?? Math.floor(n / 2)));
  let bestD = haversine(lon, lat, channels[i0].lon, channels[i0].lat);
  let best = i0;
  const window = 400;
  const lo = Math.max(0, i0 - window);
  const hi = Math.min(n - 1, i0 + window);
  for (let i = lo; i <= hi; i++) {
    const d = haversine(lon, lat, channels[i].lon, channels[i].lat);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function buildChannelAlong(points, channels) {
  const along = new Float32Array(points.length);
  let hint = Math.floor(channels.length / 2);
  for (let i = 0; i < points.length; i++) {
    const [lon, lat] = points[i];
    hint = nearestChannelIndex(lon, lat, channels, hint);
    along[i] = hint;
  }
  return along;
}

/** Bearing from point a to b in radians (0 = east). */
function bearingRad(a, b) {
  const φ1 = (a[1] * Math.PI) / 180;
  const φ2 = (b[1] * Math.PI) / 180;
  const Δλ = ((b[0] - a[0]) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return Math.atan2(y, x);
}

/**
 * Per-sample curvature proxy (radians per meter) from consecutive bearings.
 */
function buildCurvaturePerM(points) {
  const n = points.length;
  const curv = new Float32Array(n);
  if (n < 3) return curv;

  for (let i = 1; i < n - 1; i++) {
    const b0 = bearingRad(points[i - 1], points[i]);
    const b1 = bearingRad(points[i], points[i + 1]);
    let dθ = b1 - b0;
    while (dθ > Math.PI) dθ -= 2 * Math.PI;
    while (dθ < -Math.PI) dθ += 2 * Math.PI;
    const ds =
      segmentLengthM(points[i - 1], points[i]) * 0.5 +
      segmentLengthM(points[i], points[i + 1]) * 0.5;
    curv[i] = ds > 1e-3 ? Math.abs(dθ) / ds : 0;
  }
  curv[0] = curv[1];
  curv[n - 1] = curv[n - 2];
  return curv;
}

export function buildRoadMotionModel(roadGeojson, channels) {
  const lanes = lanePolylinesFromRoad(roadGeojson);
  const out = {};

  for (const laneKey of ['eb', 'wb']) {
    const coords = lanes[laneKey];
    if (coords.length < 2) {
      out[laneKey] = null;
      continue;
    }

    const { points, cumDistM } = resamplePolyline(coords, SAMPLE_SPACING_M);
    const channelAlong = buildChannelAlong(points, channels);
    const curvature = buildCurvaturePerM(points);
    const totalM = cumDistM[cumDistM.length - 1];

    let gradSum = 0;
    for (let i = 0; i < channelAlong.length - 1; i++) {
      gradSum += channelAlong[i + 1] - channelAlong[i];
    }
    const forwardIncreasesChannel = gradSum >= 0;

    out[laneKey] = {
      points,
      cumDistM,
      channelAlong,
      curvature,
      totalM,
      forwardIncreasesChannel,
    };
  }

  return { lanes: out };
}

/**
 * Convert road distance (m) to fractional index into samples; clamped.
 */
export function roadDistanceToSampleIndex(lane, roadDistM) {
  const { cumDistM } = lane;
  const maxS = cumDistM[cumDistM.length - 1];
  const s = Math.max(0, Math.min(maxS, roadDistM));
  let lo = 0;
  let hi = cumDistM.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cumDistM[mid] <= s) lo = mid;
    else hi = mid;
  }
  const i0 = lo;
  const i1 = Math.min(lo + 1, cumDistM.length - 1);
  const d0 = cumDistM[i0];
  const d1 = cumDistM[i1];
  const t = d1 > d0 ? (s - d0) / (d1 - d0) : 0;
  return i0 + t;
}

export function roadDistanceToChannelPos(lane, roadDistM) {
  const idx = roadDistanceToSampleIndex(lane, roadDistM);
  const i0 = Math.floor(idx);
  const frac = idx - i0;
  const ca = lane.channelAlong;
  const i1 = Math.min(i0 + 1, ca.length - 1);
  const c0 = ca[i0];
  const c1 = ca[i1];
  return c0 + frac * (c1 - c0);
}

/** Interpolate WGS84 position along resampled centerline at cumulative distance `roadDistM`. */
export function lonLatAtRoadDistance(lane, roadDistM) {
  const idx = roadDistanceToSampleIndex(lane, roadDistM);
  const i0 = Math.floor(idx);
  const frac = idx - i0;
  const pts = lane.points;
  const i1 = Math.min(i0 + 1, pts.length - 1);
  const p0 = pts[i0];
  const p1 = pts[i1];
  return [p0[0] + frac * (p1[0] - p0[0]), p0[1] + frac * (p1[1] - p0[1])];
}

/** +1 = increasing cumulative distance along polyline when channel index should increase (up_canyon). */
export function roadForwardSignForDirection(lane, direction) {
  const up = direction === 'up_canyon';
  if (lane.forwardIncreasesChannel) return up ? 1 : -1;
  return up ? -1 : 1;
}

export function curvatureAtRoadDistance(lane, roadDistM) {
  const idx = roadDistanceToSampleIndex(lane, roadDistM);
  const i = Math.min(lane.curvature.length - 1, Math.max(0, Math.round(idx)));
  return lane.curvature[i];
}
