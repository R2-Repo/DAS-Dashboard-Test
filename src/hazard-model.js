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
  const mul = k === 'crash' ? 1.0 : k === 'rock_slide' ? 1.08 : 1.12;
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
  if (k === 'crash') return tier * 0.94;
  if (k === 'rock_slide') return tier * 1.03;
  return tier * 1.06;
}

export function hazardPalette(kind) {
  const k = normalizeHazardKind(kind);
  if (k === 'crash') {
    return { fill: 'rgba(255,183,77,0.58)', outline: 'rgba(230,81,0,0.92)' };
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

/**
 * 0..1 coupling for a single simulation tick, after the hazard’s start. Returns 0 before the event
 * and after it ends (so the waterfall does not show a static vertical band for the full history).
 */
export function hazardWaterfallEnvelope(kind, size, ageTicks) {
  const k = normalizeHazardKind(kind);
  const { prelude, main, tail } = hazardEventPhaseTicks(kind, size);
  const total = prelude + main + tail;
  if (ageTicks < 0 || ageTicks >= total) return 0;

  if (ageTicks < prelude) {
    const u = ageTicks / Math.max(1, prelude);
    const ramp = smoothstep01(u);
    if (k === 'crash') {
      return 0.05 + 0.3 * ramp;
    }
    if (k === 'rock_slide') {
      return 0.06 + 0.36 * ramp * ramp;
    }
    return 0.06 + 0.35 * ramp * ramp;
  }

  if (ageTicks < prelude + main) {
    const u = (ageTicks - prelude) / Math.max(1, main);
    if (k === 'crash') {
      const spike = Math.exp(-((u - 0.13) ** 2) / (2 * 0.065 ** 2));
      return 0.28 + 0.72 * spike;
    }
    // Mass-flow reference shape: asymmetric twin lobes (smaller / earlier left, larger / later right)
    // with a warm yellow–orange bridge between red cores — not three sharp pulses or a flat plateau.
    const uLeft = k === 'rock_slide' ? 0.3 : 0.28;
    const uRight = k === 'rock_slide' ? 0.63 : 0.61;
    const sLeft = k === 'rock_slide' ? 0.096 : 0.1;
    const sRight = k === 'rock_slide' ? 0.116 : 0.122;
    const hLeft = 0.76;
    const hRight = 1.0;
    const gL = hLeft * Math.exp(-((u - uLeft) ** 2) / (2 * sLeft * sLeft));
    const gR = hRight * Math.exp(-((u - uRight) ** 2) / (2 * sRight * sRight));
    const ridge = Math.max(gL, gR);
    const soup = 0.5 * Math.min(1.2, gL + gR);
    const body = Math.max(ridge, soup);
    return Math.min(1, 0.41 + 0.59 * body);
  }

  const u = (ageTicks - prelude - main) / Math.max(1, tail);
  const tailDecay = (1 - smoothstep01(u)) ** 1.55;
  if (k === 'crash') {
    return 0.07 * tailDecay;
  }
  return 0.48 * tailDecay;
}
