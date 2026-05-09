/**
 * Hazard types for map footprints + DAS waterfall coupling (V1 — simple tiers).
 */

/** @typedef {'crash' | 'rock_slide' | 'avalanche'} HazardKind */
/** @typedef {'small' | 'medium' | 'large'} HazardSize */

export const HAZARD_KINDS = /** @type {const} */ (['crash', 'rock_slide', 'avalanche']);
export const HAZARD_SIZES = /** @type {const} */ (['small', 'medium', 'large']);

/**
 * Canyon heuristic: wider mass sits on the left of travel direction (upslope side).
 * Tunable without changing call sites.
 */
export const UPSLOPE_ON_LEFT_OF_TRAVEL = true;

export function normalizeHazardKind(k) {
  const s = String(k || '').toLowerCase().replace(/-/g, '_');
  if (s === 'rockslide') return 'rock_slide';
  if (HAZARD_KINDS.includes(s)) return /** @type {HazardKind} */ (s);
  return 'crash';
}

export function normalizeHazardSize(z) {
  const s = String(z || '').toLowerCase();
  if (HAZARD_SIZES.includes(s)) return /** @type {HazardSize} */ (s);
  return 'medium';
}

/**
 * @returns {{ lengthM: number; leftWidthM: number; rightWidthM: number }}
 */
export function hazardFootprintMeters(kind, size) {
  const k = normalizeHazardKind(kind);
  const z = normalizeHazardSize(size);

  const tier =
    z === 'small'
      ? { L: 1.0, crashW: 1.0, asymL: 1.0, asymR: 1.0 }
      : z === 'large'
        ? { L: 2.35, crashW: 2.1, asymL: 2.5, asymR: 1.65 }
        : { L: 1.55, crashW: 1.45, asymL: 1.65, asymR: 1.28 };

  if (k === 'crash') {
    const lengthM = 12 * tier.L;
    const half = 4.2 * tier.crashW;
    return { lengthM, leftWidthM: half, rightWidthM: half };
  }

  const lengthM = (k === 'avalanche' ? 58 : 42) * tier.L;
  const leftW = (k === 'avalanche' ? 26 : 20) * tier.asymL;
  const rightW = (k === 'avalanche' ? 11 : 9) * tier.asymR;
  return { lengthM, leftWidthM: leftW, rightWidthM: rightW };
}

/**
 * Peak waterfall coupling 0..1 scale (before temporal noise in simulation).
 */
export function hazardPeakIntensity(kind, size) {
  const z = normalizeHazardSize(size);
  const base = z === 'small' ? 0.38 : z === 'large' ? 0.78 : 0.56;
  const k = normalizeHazardKind(kind);
  const mul =
    k === 'crash'
      ? z === 'large'
        ? 1.12
        : 1.24
      : k === 'rock_slide'
        ? 1.48
        : 1.62;
  return Math.min(1, base * mul);
}

/**
 * Extra multiplier for hazard-only waterfall stamping so peaks reach the jet LUT’s orange–red leg
 * (fixed plot scaling keeps ambient in deep blue; uncorrected hazard coupling sat in cyan/yellow).
 */
export function hazardWaterfallStampGain(kind, size) {
  const z = normalizeHazardSize(size);
  const k = normalizeHazardKind(kind);
  const tier = z === 'small' ? 1.92 : z === 'large' ? 2.52 : 2.15;
  if (k === 'crash') {
    const bump = z === 'large' ? 2.45 : z === 'medium' ? 2.98 : 3.12;
    return tier * bump;
  }
  if (k === 'rock_slide') return tier * 3.42;
  return tier * 3.62;
}

/**
 * @param {string} [size] Defaults to medium; only affects crash map tint.
 */
export function hazardPalette(kind, size) {
  const k = normalizeHazardKind(kind);
  const z = normalizeHazardSize(size);
  if (k === 'crash') {
    if (z === 'large') {
      return { fill: 'rgba(255,152,48,0.64)', outline: 'rgba(183,28,0,0.94)' };
    }
    return { fill: 'rgba(255,94,28,0.68)', outline: 'rgba(142,6,0,0.96)' };
  }
  if (k === 'rock_slide') {
    return { fill: 'rgba(141,110,99,0.65)', outline: 'rgba(62,39,35,0.9)' };
  }
  return { fill: 'rgba(227,242,253,0.62)', outline: 'rgba(21,101,192,0.92)' };
}

/**
 * Oriented corridor on the ground: forward = travel bearing (deg CW from north).
 * Left / right are lateral offsets using the standard right-hand rule (right = +90° from forward).
 */
export function buildCorridorPolygonLonLat(
  centerLon,
  centerLat,
  bearingDegClockwiseFromNorth,
  lengthM,
  leftWidthM,
  rightWidthM,
) {
  const α = (bearingDegClockwiseFromNorth * Math.PI) / 180;
  const fe = Math.sin(α);
  const fn = Math.cos(α);
  const re = Math.cos(α);
  const rn = -Math.sin(α);
  const halfL = lengthM / 2;

  function offsetFromCenter(dAlongM, dRightM) {
    const dE = dAlongM * fe + dRightM * re;
    const dN = dAlongM * fn + dRightM * rn;
    const cosφ = Math.cos((centerLat * Math.PI) / 180);
    const dLon = dE / (111320 * Math.max(0.25, Math.abs(cosφ)));
    const dLat = dN / 111320;
    return [centerLon + dLon, centerLat + dLat];
  }

  const L = leftWidthM;
  const R = rightWidthM;
  const ring = [
    offsetFromCenter(-halfL, -L),
    offsetFromCenter(-halfL, R),
    offsetFromCenter(halfL, R),
    offsetFromCenter(halfL, -L),
    offsetFromCenter(-halfL, -L),
  ];
  return { type: 'Polygon', coordinates: [ring] };
}

/**
 * Map upslope mass to lateral offsets: if upslope is left of travel, left strip is wider.
 */
export function lateralWidthsForHazard(kind, size) {
  const { lengthM, leftWidthM, rightWidthM } = hazardFootprintMeters(kind, size);
  const k = normalizeHazardKind(kind);
  if (k === 'crash') {
    return { lengthM, leftWidthM, rightWidthM };
  }
  if (UPSLOPE_ON_LEFT_OF_TRAVEL) {
    return { lengthM, leftWidthM, rightWidthM };
  }
  return { lengthM, leftWidthM: rightWidthM, rightWidthM: leftWidthM };
}

/** Fallback span in fiber channels when road geometry is unavailable. */
export function hazardFallbackChannelHalfWidth(size) {
  const z = normalizeHazardSize(size);
  if (z === 'small') return 14;
  if (z === 'large') return 48;
  return 28;
}

/**
 * DAS-style hazard lifetimes in simulation ticks (TICK_MS in simulation.js, 100ms each).
 * Tuned so the waterfall shows a finite “blob”: precursor energy, main event, then decay — not
 * a vertical column. Durations scale with size; kind controls shape (short impact vs. long mass flow).
 */
export function hazardEventPhaseTicks(kind, size) {
  const k = normalizeHazardKind(kind);
  const z = normalizeHazardSize(size);
  const scale = z === 'small' ? 0.75 : z === 'large' ? 1.35 : 1.0;

  if (k === 'crash') {
    return {
      prelude: Math.max(4, Math.round(14 * scale)),
      main: Math.max(2, Math.round(5 * scale)),
      tail: Math.max(8, Math.round(30 * scale)),
    };
  }
  if (k === 'rock_slide') {
    return {
      prelude: Math.max(6, Math.round(24 * scale)),
      main: Math.max(20, Math.round(58 * scale)),
      tail: Math.max(25, Math.round(78 * scale)),
    };
  }
  return {
    prelude: Math.max(8, Math.round(38 * scale)),
    main: Math.max(35, Math.round(88 * scale)),
    tail: Math.max(40, Math.round(108 * scale)),
  };
}

export function hazardEventDurationTicks(kind, size) {
  const p = hazardEventPhaseTicks(kind, size);
  return p.prelude + p.main + p.tail;
}

function smoothstep01(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** Stronger for small/medium so low-tier crashes still read clearly vs. large on the waterfall. */
function crashWaterfallShapeScale(size) {
  const z = normalizeHazardSize(size);
  if (z === 'small') return 0.98;
  if (z === 'medium') return 0.95;
  return 0.9;
}

/**
 * Twin-lobe main-phase curve shared by rock slide and avalanche (crash uses rock_slide params, scaled).
 */
function massFlowMainEnvelope01(u, kind) {
  const k = normalizeHazardKind(kind);
  const uLeft = k === 'avalanche' ? 0.28 : 0.3;
  const uRight = k === 'avalanche' ? 0.61 : 0.63;
  const sLeft = k === 'avalanche' ? 0.1 : 0.096;
  const sRight = k === 'avalanche' ? 0.122 : 0.116;
  const hLeft = 0.76;
  const hRight = 1.0;
  const gL = hLeft * Math.exp(-((u - uLeft) ** 2) / (2 * sLeft * sLeft));
  const gR = hRight * Math.exp(-((u - uRight) ** 2) / (2 * sRight * sRight));
  const ridge = Math.max(gL, gR);
  const soup = 0.5 * Math.min(1.2, gL + gR);
  const body = Math.max(ridge, soup);
  const frayPhase = k === 'avalanche' ? 0.31 : 1.07;
  const fray = 0.89 + 0.11 * Math.abs(Math.sin(u * 33.1 + frayPhase));
  return Math.min(1, (0.41 + 0.59 * body) * fray);
}

/**
 * 0..1 coupling for a single simulation tick, after the hazard’s start. Returns 0 before the event
 * and after it ends (so the waterfall does not show a static vertical band for the full history).
 */
export function hazardWaterfallEnvelope(kind, size, ageTicks) {
  const k = normalizeHazardKind(kind);
  const { prelude, main, tail } = hazardEventPhaseTicks(kind, size);
  const total = prelude + main + tail;
  if (ageTicks < 0 || ageTicks >= total) return 0;
  const crashShape = k === 'crash' ? crashWaterfallShapeScale(size) : 1;

  if (ageTicks < prelude) {
    const u = ageTicks / Math.max(1, prelude);
    const ramp = smoothstep01(u);
    if (k === 'crash') {
      return crashShape * (0.06 + 0.36 * ramp * ramp);
    }
    if (k === 'rock_slide') {
      return 0.06 + 0.36 * ramp * ramp;
    }
    return 0.06 + 0.35 * ramp * ramp;
  }

  if (ageTicks < prelude + main) {
    const u = (ageTicks - prelude) / Math.max(1, main);
    if (k === 'crash') {
      return Math.min(1, crashShape * massFlowMainEnvelope01(u, 'rock_slide'));
    }
    if (k === 'rock_slide') {
      return massFlowMainEnvelope01(u, 'rock_slide');
    }
    return massFlowMainEnvelope01(u, 'avalanche');
  }

  const u = (ageTicks - prelude - main) / Math.max(1, tail);
  const tailDecay = (1 - smoothstep01(u)) ** 1.55;
  if (k === 'crash') {
    return crashShape * 0.48 * tailDecay;
  }
  return 0.48 * tailDecay;
}
