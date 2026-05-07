/**
 * Minimal MapLibre helpers pulled out of `map.js` so other modules (e.g. simulation)
 * do not import the full map bundle + CSP worker wiring.
 */

export function updateMapVehicles(map, vehicleFeatures) {
  const src = map.getSource('vehicles');
  if (src) src.setData({ type: 'FeatureCollection', features: vehicleFeatures });
}

export function updateMapHazards(map, hazardFeatures) {
  const src = map.getSource('hazards');
  if (src) src.setData({ type: 'FeatureCollection', features: hazardFeatures });
}
