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
