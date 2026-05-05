/**
 * Pure hazard → waterfall row stamping (DAS-style synthetic signatures).
 * Used by simulation each tick; exported for unit tests.
 */

/** @typedef {{ kind: string, startChannel: number, endChannel: number, intensity: number, initialTtl: number, ttl: number, phase: number, vehicleCount?: number, magnitude?: number, tickCreated?: number }} HazardAnomaly */

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function hash01(i, seed) {
  const x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Add hazard energy into `row` (mutates). Caller already filled ambient noise.
 * @param {Float32Array} row
 * @param {HazardAnomaly} a
 * @param {number} totalChannels
 * @param {number} tickCount
 */
export function stampHazardOntoRow(row, a, totalChannels, tickCount) {
  const kind = a.kind || a.subtype || 'rock_slide';
  const mag = typeof a.magnitude === 'number' && Number.isFinite(a.magnitude) ? clamp01(a.magnitude) : 0.55;
  const decay = a.initialTtl > 0 ? clamp01(a.ttl / a.initialTtl) : 0;
  const age = Math.max(0, a.initialTtl - a.ttl);
  const sc0 = Math.min(a.startChannel, a.endChannel);
  const sc1 = Math.max(a.startChannel, a.endChannel);
  const span = Math.max(0, sc1 - sc0);

  if (kind === 'crash') {
    stampCrash(row, a, totalChannels, tickCount, decay, mag, sc0, sc1, span);
    return;
  }
  if (kind === 'avalanche') {
    stampAvalanche(row, a, totalChannels, tickCount, decay, mag, sc0, sc1, span, age);
    return;
  }
  stampRockSlide(row, a, totalChannels, tickCount, decay, mag, sc0, sc1, span, age);
}

function stampCrash(row, a, totalChannels, tickCount, decay, mag, sc0, sc1, _span) {
  const nVeh = Math.min(3, Math.max(1, Math.floor(a.vehicleCount ?? 1)));
  const base = a.intensity * (0.55 + mag * 0.45) * (0.35 + 0.65 * decay);
  const center = (sc0 + sc1) * 0.5;
  const spreadCh = 2 + nVeh * 3 + Math.round(mag * 8);

  for (let v = 0; v < nVeh; v++) {
    const off = (v - (nVeh - 1) / 2) * (4 + mag * 6);
    const pos = center + off;
    const ci = Math.floor(pos);
    const impulse = base * (0.85 + 0.15 * hash01(v * 17 + ci, a.phase));

    for (let d = -spreadCh; d <= spreadCh; d++) {
      const idx = ci + d;
      if (idx < 0 || idx >= totalChannels) continue;
      const dist = Math.abs(d - (pos - ci));
      const t = dist / Math.max(1, spreadCh);
      const envelope = Math.max(0, 1 - t * t);
      const micro = 0.88 + 0.12 * Math.sin(idx * 0.35 + tickCount * 0.9 + a.phase);
      const verticalBurst = 0.55 + 0.45 * decay;
      const amp = impulse * envelope * micro * verticalBurst * 0.95;
      if (amp < 0.002) continue;
      row[idx] = Math.min(1.0, row[idx] + amp);
    }
  }
}

function stampRockSlide(row, a, totalChannels, tickCount, decay, mag, sc0, sc1, span, age) {
  const grow = clamp01(age / Math.max(12, a.initialTtl * 0.35));
  const half = span * (0.55 + grow * 0.45);
  const mid = (sc0 + sc1) * 0.5;
  const effLo = Math.max(0, Math.floor(mid - half));
  const effHi = Math.min(totalChannels - 1, Math.ceil(mid + half));
  const base = a.intensity * (0.5 + mag * 0.5) * (0.4 + 0.6 * decay);

  for (let i = effLo; i <= effHi; i++) {
    const u = half < 1e-6 ? 0 : (i - mid) / Math.max(half, 1);
    const lateral = Math.max(0, 1 - Math.abs(u));
    const shard = 0.25 + 0.75 * Math.abs(Math.sin(i * 0.31 + a.phase * 1.7));
    const crackle = 0.65 + 0.35 * hash01(i + tickCount * 3, a.phase + tickCount * 0.01);
    const amp = base * lateral * lateral * shard * crackle * 0.62;
    if (amp < 0.001) continue;
    row[i] = Math.min(1.0, row[i] + amp);
  }
}

function stampAvalanche(row, a, totalChannels, tickCount, decay, mag, sc0, sc1, span, age) {
  const diffuse = clamp01(age / Math.max(20, a.initialTtl * 0.5));
  const half = span * (0.62 + diffuse * 0.38 + mag * 0.08);
  const mid = (sc0 + sc1) * 0.5;
  const effLo = Math.max(0, Math.floor(mid - half));
  const effHi = Math.min(totalChannels - 1, Math.ceil(mid + half));
  const base = a.intensity * (0.42 + mag * 0.38) * (0.35 + 0.65 * decay);

  for (let i = effLo; i <= effHi; i++) {
    const u = half < 1e-6 ? 0 : (i - mid) / Math.max(half, 1);
    const gauss = Math.exp(-u * u * 2.2);
    const rumble = 0.78 + 0.22 * Math.sin(i * 0.08 + tickCount * 0.22 + a.phase);
    const soft = 0.7 + 0.3 * hash01(i * 5, a.phase * 0.3);
    const amp = base * gauss * rumble * soft * 0.52;
    if (amp < 0.001) continue;
    row[i] = Math.min(1.0, row[i] + amp);
  }
}

/**
 * @param {'crash'|'rock_slide'|'avalanche'} kind
 * @param {number} magnitude 0–1
 * @param {number} vehicleCount 1–3 (crash only)
 */
export function hazardInitialTtl(kind, magnitude, vehicleCount = 1) {
  const mag = clamp01(magnitude);
  if (kind === 'crash') {
    const n = Math.min(3, Math.max(1, vehicleCount));
    return Math.round(38 + n * 22 + mag * 40);
  }
  if (kind === 'avalanche') {
    return Math.round(95 + mag * 85);
  }
  return Math.round(70 + mag * 70);
}

/**
 * Channel half-width from magnitude for mass hazards (fiber index units).
 */
export function hazardSpanChannels(kind, magnitude, totalChannels) {
  const mag = clamp01(magnitude);
  const cap = Math.max(80, Math.floor(totalChannels * 0.12));
  if (kind === 'avalanche') {
    return Math.min(cap, Math.round(35 + mag * (cap - 35)));
  }
  if (kind === 'rock_slide') {
    return Math.min(cap, Math.round(22 + mag * (cap * 0.85 - 22)));
  }
  return Math.min(40, Math.round(6 + mag * 28));
}
