/**
 * 3D MapLibre map — terrain, hillshade, GIS layers, and dynamic vehicle/anomaly markers.
 *
 * Tile sources (no API key in this build):
 *   - Base map: Esri World Imagery + reference overlays (transportation, boundaries/places) — hybrid satellite
 *   - Terrain: AWS Terrarium RGB elevation tiles (for 3D + hillshade)
 *
 * GIS layers on load: fiber path (soft glow) + EB/WB road centerlines (mileposts, crossings not drawn).
 * Dynamic layers: anomaly pulses (below), then vehicles as fill-extrusion blocks on terrain
 * so markers do not obscure vehicles.
 *
 * Exports: initMap(), updateMapVehicles(), updateMapAnomalies()
 */
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { LANE_ROUTE_COLOR_HEX } from './lane-route-colors.js';
import { VEHICLE_HIT_LAYERS } from './map-constants.js';

const TERRAIN_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

/** Esri tiled basemap (ArcGIS Online); {z}/{row}/{col} with row = TMS Y from North. */
const ESRI_IMAGERY_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_TRANSPORT_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';
const ESRI_BOUNDARIES_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

const ESRI_ATTRIBUTION =
  'Tiles © <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> '
  + '(<a href="https://goto.arcgisonline.com/maps/World_Imagery" target="_blank" rel="noopener">World Imagery</a>, '
  + '<a href="https://goto.arcgisonline.com/maps/Reference/World_Transportation" target="_blank" rel="noopener">Transportation</a>, '
  + '<a href="https://goto.arcgisonline.com/maps/Reference/World_Boundaries_and_Places" target="_blank" rel="noopener">Boundaries</a>)';

export function initMap(containerId, data) {
  const bounds = unionBounds([
    boundsFromLineFeaturesGeojson(data.road),
    boundsFromLineFeaturesGeojson(data.fiberRoute),
  ]);
  const coarsePointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)')?.matches;
  const narrowScreen = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 768px)')?.matches;

  const map = new maplibregl.Map({
    container: containerId,
    style: {
      version: 8,
      sources: {
        'esri-imagery': {
          type: 'raster',
          tiles: [ESRI_IMAGERY_TILES],
          tileSize: 256,
          attribution: ESRI_ATTRIBUTION,
          maxzoom: 19,
        },
        'esri-transport': {
          type: 'raster',
          tiles: [ESRI_TRANSPORT_TILES],
          tileSize: 256,
          attribution: ESRI_ATTRIBUTION,
          maxzoom: 19,
        },
        'esri-boundaries': {
          type: 'raster',
          tiles: [ESRI_BOUNDARIES_TILES],
          tileSize: 256,
          attribution: ESRI_ATTRIBUTION,
          maxzoom: 19,
        },
        terrainSource: {
          type: 'raster-dem',
          tiles: [TERRAIN_URL],
          encoding: 'terrarium',
          tileSize: 256,
          maxzoom: 15,
        },
        hillshadeSource: {
          type: 'raster-dem',
          tiles: [TERRAIN_URL],
          encoding: 'terrarium',
          tileSize: 256,
          maxzoom: 15,
        },
      },
      layers: [
        { id: 'esri-imagery', type: 'raster', source: 'esri-imagery' },
        {
          id: 'hillshade',
          type: 'hillshade',
          source: 'hillshadeSource',
          paint: {
            'hillshade-shadow-color': '#1a1a2e',
            'hillshade-highlight-color': '#fafafa',
            'hillshade-accent-color': '#5a5a7a',
            'hillshade-exaggeration': 0.22,
          },
        },
        {
          id: 'esri-transport',
          type: 'raster',
          source: 'esri-transport',
          paint: { 'raster-opacity': 0.92 },
        },
        {
          id: 'esri-boundaries',
          type: 'raster',
          source: 'esri-boundaries',
          paint: { 'raster-opacity': 0.88 },
        },
      ],
      terrain: {
        source: 'terrainSource',
        exaggeration: 1.5,
      },
      sky: {},
    },
    center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
    zoom: 12.5,
    pitch: 55,
    bearing: -30,
    maxPitch: coarsePointer && narrowScreen ? 60 : 85,
    maxZoom: 18,
    touchPitch: true,
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.TerrainControl({ source: 'terrainSource', exaggeration: 1.5 }), 'top-right');

  map.on('load', () => {
    addFiberLayer(map, data.fiberRoute);
    addRoadCenterlineLayers(map, data.road);
    addAnomalyLayer(map);
    addVehicleLayers(map);
  });

  return map;
}

function extendBoundsWithCoord(bounds, lon, lat) {
  const [minLon, minLat, maxLon, maxLat] = bounds;
  return [
    Math.min(minLon, lon),
    Math.min(minLat, lat),
    Math.max(maxLon, lon),
    Math.max(maxLat, lat),
  ];
}

/** Walk LineString / MultiLineString coordinates (2D only). */
function extendBoundsWithLineCoords(bounds, coords) {
  if (!coords?.length) return bounds;
  if (typeof coords[0] === 'number') {
    return extendBoundsWithCoord(bounds, coords[0], coords[1]);
  }
  let b = bounds;
  for (const part of coords) {
    b = extendBoundsWithLineCoords(b, part);
  }
  return b;
}

const EMPTY_BOUNDS = [180, 90, -180, -90];

function boundsFromLineFeaturesGeojson(fc) {
  let b = EMPTY_BOUNDS.slice();
  for (const feat of fc?.features ?? []) {
    const g = feat?.geometry;
    if (!g) continue;
    if (g.type === 'LineString') b = extendBoundsWithLineCoords(b, g.coordinates);
    else if (g.type === 'MultiLineString') b = extendBoundsWithLineCoords(b, g.coordinates);
  }
  return b;
}

function unionBounds(boundsList) {
  let b = EMPTY_BOUNDS.slice();
  for (const box of boundsList) {
    if (!box || box[0] > box[2] || box[1] > box[3]) continue;
    b = [
      Math.min(b[0], box[0]),
      Math.min(b[1], box[1]),
      Math.max(b[2], box[2]),
      Math.max(b[3], box[3]),
    ];
  }
  if (b[0] > b[2] || b[1] > b[3]) {
    return [-111.8, 40.6, -111.6, 40.7];
  }
  return b;
}

function laneKeyFromRoadFeatureProps(props) {
  const alias = String(props?.ROUTE_ALIAS_COMMON ?? '').toLowerCase();
  if (alias.includes('eb') || alias.includes('east')) return 'eb';
  if (alias.includes('wb') || alias.includes('west')) return 'wb';
  return null;
}

function roadFeaturesForLane(roadGeojson, laneKey) {
  return (roadGeojson?.features ?? []).filter(
    (f) => laneKeyFromRoadFeatureProps(f.properties) === laneKey,
  );
}

function addRoadCenterlineLayers(map, roadGeojson) {
  const ebFc = { type: 'FeatureCollection', features: roadFeaturesForLane(roadGeojson, 'eb') };
  const wbFc = { type: 'FeatureCollection', features: roadFeaturesForLane(roadGeojson, 'wb') };

  map.addSource('road-eb', { type: 'geojson', data: ebFc });
  map.addSource('road-wb', { type: 'geojson', data: wbFc });

  map.addLayer({
    id: 'road-wb-centerline',
    type: 'line',
    source: 'road-wb',
    paint: {
      'line-color': LANE_ROUTE_COLOR_HEX.wb,
      'line-width': 2.2,
      'line-opacity': 0.72,
    },
  });
  map.addLayer({
    id: 'road-eb-centerline',
    type: 'line',
    source: 'road-eb',
    paint: {
      'line-color': LANE_ROUTE_COLOR_HEX.eb,
      'line-width': 2.2,
      'line-opacity': 0.72,
    },
  });
}

function addFiberLayer(map, fiberRoute) {
  map.addSource('fiber', { type: 'geojson', data: fiberRoute });
  map.addLayer({
    id: 'fiber-glow',
    type: 'line',
    source: 'fiber',
    paint: {
      'line-color': '#4fc3f7',
      'line-width': 6,
      'line-opacity': 0.3,
      'line-blur': 4,
    },
  });
}

function addVehicleLayers(map) {
  map.addSource('vehicles', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: 'vehicle-glow',
    type: 'line',
    source: 'vehicles',
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': ['get', 'glow_color'],
      'line-width': ['case', ['==', ['get', 'user_placed'], 1], 7, 0],
      'line-opacity': ['case', ['==', ['get', 'user_placed'], 1], 0.5, 0],
      'line-blur': 3.2,
    },
  });

  map.addLayer({
    id: 'vehicle-blocks-fill',
    type: 'fill-extrusion',
    source: 'vehicles',
    paint: {
      'fill-extrusion-height': ['get', 'height_m'],
      'fill-extrusion-base': 0,
      'fill-extrusion-color': ['get', 'fill_color'],
      // Per-feature opacity is not supported on fill-extrusion (data-constant only).
      'fill-extrusion-opacity': 0.92,
      'fill-extrusion-vertical-gradient': false,
    },
  });

  map.addLayer({
    id: 'vehicle-blocks-outline',
    type: 'fill-extrusion',
    source: 'vehicles',
    paint: {
      'fill-extrusion-height': ['+', ['get', 'height_m'], 0.25],
      'fill-extrusion-base': ['get', 'height_m'],
      'fill-extrusion-color': ['get', 'outline_color'],
      'fill-extrusion-opacity': 0.88,
      'fill-extrusion-vertical-gradient': false,
    },
  });

  map.on('mouseenter', 'vehicle-blocks-fill', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'vehicle-blocks-fill', () => {
    map.getCanvas().style.cursor = '';
  });
}

/**
 * Map interaction: click vehicle to select; drag vehicle to reposition (pan: right-drag / two fingers).
 * Adding vehicles is done via the sidebar palette (drag-drop or touch place mode).
 */
export function setupTrafficSimulatorMapInteractions(map, sim, options = {}) {
  const { tryConsumeMapClick } = options;

  let dragging = false;

  function vehicleFeatureAtPoint(e) {
    const hits = map.queryRenderedFeatures(e.point, { layers: VEHICLE_HIT_LAYERS });
    return hits.length ? hits[0] : null;
  }

  map.on('click', (e) => {
    if (tryConsumeMapClick?.(e)) return;

    const feat = vehicleFeatureAtPoint(e);
    if (feat) {
      sim.setSelectedVehicleId(feat.properties.id);
      sim.syncFleetPanel?.();
      return;
    }
    sim.setSelectedVehicleId(null);
    sim.syncFleetPanel?.();
  });

  map.on('mousedown', (e) => {
    if (e.originalEvent.button !== 0) return;
    const feat = vehicleFeatureAtPoint(e);
    if (!feat) return;
    const dragId = feat.properties.id;
    sim.setSelectedVehicleId(dragId);
    sim.setDragVehicleId(dragId);
    dragging = true;
    map.dragPan.disable();
    sim.moveVehicleToLngLat(dragId, e.lngLat.lng, e.lngLat.lat);
    e.preventDefault();
  });

  map.on('mousemove', (e) => {
    if (!dragging) return;
    const id = sim.getDragVehicleId();
    if (!id) return;
    sim.moveVehicleToLngLat(id, e.lngLat.lng, e.lngLat.lat);
  });

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    sim.setDragVehicleId(null);
    sim.releaseDragLocks();
    map.dragPan.enable();
  }

  map.on('mouseup', endDrag);
  map.on('mouseleave', endDrag);

  map.on('touchstart', (e) => {
    if (e.points.length !== 1) return;
    const hits = map.queryRenderedFeatures(e.point, { layers: VEHICLE_HIT_LAYERS });
    if (!hits.length) return;
    const dragId = hits[0].properties.id;
    sim.setSelectedVehicleId(dragId);
    sim.setDragVehicleId(dragId);
    dragging = true;
    map.dragPan.disable();
    sim.moveVehicleToLngLat(dragId, e.lngLat.lng, e.lngLat.lat);
  });

  map.on('touchmove', (e) => {
    if (!dragging || e.points.length !== 1) return;
    e.originalEvent?.preventDefault?.();
    const id = sim.getDragVehicleId();
    if (!id) return;
    sim.moveVehicleToLngLat(id, e.lngLat.lng, e.lngLat.lat);
  });

  map.on('touchend', endDrag);
  map.on('touchcancel', endDrag);
}

function addAnomalyLayer(map) {
  map.addSource('anomalies', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: 'anomaly-pulse',
    type: 'circle',
    source: 'anomalies',
    paint: {
      'circle-radius': 18,
      'circle-color': '#ef5350',
      'circle-opacity': 0.2,
      'circle-blur': 1,
    },
  });
  map.addLayer({
    id: 'anomaly-markers',
    type: 'circle',
    source: 'anomalies',
    paint: {
      'circle-radius': 7,
      'circle-color': '#ef5350',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff',
    },
  });
}

export function updateMapVehicles(map, vehicleFeatures) {
  const src = map.getSource('vehicles');
  if (src) src.setData({ type: 'FeatureCollection', features: vehicleFeatures });
}

export function updateMapAnomalies(map, anomalyFeatures) {
  const src = map.getSource('anomalies');
  if (src) src.setData({ type: 'FeatureCollection', features: anomalyFeatures });
}
