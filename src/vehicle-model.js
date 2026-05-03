/**
 * Vehicle classes for traffic sim + map 3D footprints + DAS row coupling.
 * Length/width are approximate real-world meters for car-following and extruded blocks.
 */

export const VEHICLE_TYPES = ['bicycle', 'motorcycle', 'car', 'truck', 'semi_truck'];

/**
 * Real vehicles are only a few meters long; at canyon overview zoom they are invisible
 * as fill-extrusion footprints. Map rendering uses this scale (physics still uses true meters).
 */
export const MAP_VEHICLE_FOOTPRINT_SCALE = 2.85;

/** Extra scale for user-placed vehicles so they read clearly on the map. */
export const MAP_VEHICLE_USER_DROP_SCALE = 1.58;

/** Minimum ground footprint width (m) so narrow classes stay clickable at overview zoom. */
export const MAP_VEHICLE_MIN_WIDTH_M = 2.8;

/** Minimum extrusion height (m) so blocks read clearly against terrain and satellite. */
export const MAP_VEHICLE_MIN_HEIGHT_M = 7;

/**
 * @param {string | { lengthM: number; widthM: number; heightM: number }} typeOrSpec — vehicle type key or spec-like object
 * @param {{ userPlaced?: boolean }} [opts]
 */
export function mapVehicleFootprintDims(typeOrSpec, opts = {}) {
  const s = typeof typeOrSpec === 'string' ? vehicleSpec(typeOrSpec) : typeOrSpec;
  const k = MAP_VEHICLE_FOOTPRINT_SCALE * (opts.userPlaced ? MAP_VEHICLE_USER_DROP_SCALE : 1);
  return {
    lengthM: s.lengthM * k,
    widthM: Math.max(MAP_VEHICLE_MIN_WIDTH_M, s.widthM * k),
    heightM: Math.max(MAP_VEHICLE_MIN_HEIGHT_M, s.heightM * k * 1.05),
  };
}

/** @type {Record<string, { lengthM: number; widthM: number; heightM: number; color: string; label: string; dasHalfWidthCh: number; dasStrength: number }>} */
export const VEHICLE_SPECS = {
  bicycle: {
    lengthM: 1.8,
    widthM: 0.55,
    heightM: 1.6,
    color: '#26c6da',
    label: 'Bicycle',
    dasHalfWidthCh: 0.5,
    dasStrength: 0.1,
  },
  motorcycle: {
    lengthM: 2.2,
    widthM: 0.9,
    heightM: 1.45,
    color: '#ba68c8',
    label: 'Motorcycle',
    dasHalfWidthCh: 0.5,
    dasStrength: 0.16,
  },
  car: {
    lengthM: 4.6,
    widthM: 1.85,
    heightM: 1.5,
    color: '#90caf9',
    label: 'Car',
    dasHalfWidthCh: 1,
    dasStrength: 0.34,
  },
  truck: {
    lengthM: 9.0,
    widthM: 2.5,
    heightM: 3.2,
    color: '#ffb74d',
    label: 'Pickup',
    dasHalfWidthCh: 2,
    dasStrength: 0.52,
  },
  semi_truck: {
    lengthM: 22,
    widthM: 2.55,
    heightM: 4.0,
    color: '#ff8a65',
    label: 'Semi',
    dasHalfWidthCh: 2.5,
    dasStrength: 0.68,
  },
};

export function normalizeVehicleType(t) {
  const s = String(t || '').toLowerCase();
  if (s === 'semi' || s === 'semi-truck' || s === 'semitruck') return 'semi_truck';
  if (VEHICLE_SPECS[s]) return s;
  return 'car';
}

export function vehicleSpec(type) {
  return VEHICLE_SPECS[normalizeVehicleType(type)] ?? VEHICLE_SPECS.car;
}

export function vehicleLengthM(type) {
  return vehicleSpec(type).lengthM;
}

export function vehicleDasFootprint(type) {
  const s = vehicleSpec(type);
  return { halfWidth: s.dasHalfWidthCh, strength: s.dasStrength };
}

/**
 * Oriented rectangle on the ground (WGS84), meters long × wide, `bearingDeg` clockwise from north.
 */
export function buildVehicleFootprintPolygon(centerLon, centerLat, lengthM, widthM, bearingDegClockwiseFromNorth) {
  const α = (bearingDegClockwiseFromNorth * Math.PI) / 180;
  const fe = Math.sin(α);
  const fn = Math.cos(α);
  const re = Math.cos(α);
  const rn = -Math.sin(α);
  const halfL = lengthM / 2;
  const halfW = widthM / 2;

  function offset(dE, dN) {
    const cosφ = Math.cos((centerLat * Math.PI) / 180);
    const dLon = dE / (111320 * Math.max(0.25, Math.abs(cosφ)));
    const dLat = dN / 111320;
    return [centerLon + dLon, centerLat + dLat];
  }

  const ring = [
    offset(-halfL * fe - halfW * re, -halfL * fn - halfW * rn),
    offset(-halfL * fe + halfW * re, -halfL * fn + halfW * rn),
    offset(halfL * fe + halfW * re, halfL * fn + halfW * rn),
    offset(halfL * fe - halfW * re, halfL * fn - halfW * rn),
    offset(-halfL * fe - halfW * re, -halfL * fn - halfW * rn),
  ];
  return { type: 'Polygon', coordinates: [ring] };
}
