/**
 * 3D MapLibre map — terrain, hillshade, GIS layers, and dynamic vehicle/anomaly markers.
 *
 * Tile sources (no API key in this build):
 *   - Base map: Esri World Imagery + reference overlays (transportation, boundaries/places) — hybrid satellite
 *   - Terrain: AWS Terrarium RGB elevation tiles (for 3D + hillshade)
 *
 * GIS layers on load: fiber route only (road centerline, mileposts, crossings hidden).
 * Dynamic layers: anomaly pulses (below), then vehicles as fill-extrusion blocks on terrain
 * so markers do not obscure vehicles.
 *
 * Exports: initMap(), updateMapVehicles(), updateMapAnomalies()
 */
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { vehicleSpec } from './vehicle-model.js';
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

function vehicleTypeLabel(type) {
  const s = vehicleSpec(type);
  return s.label;
}

export function initMap(containerId, data) {
  const bounds = computeBounds(data.road);
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
    addAnomalyLayer(map);
    addVehicleLayers(map);
  });

  return map;
}

function computeBounds(road) {
  let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
  for (const feat of road.features) {
    for (const coord of feat.geometry.coordinates) {
      if (coord[0] < minLon) minLon = coord[0];
      if (coord[0] > maxLon) maxLon = coord[0];
      if (coord[1] < minLat) minLat = coord[1];
      if (coord[1] > maxLat) maxLat = coord[1];
    }
  }
  return [minLon, minLat, maxLon, maxLat];
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
  map.addLayer({
    id: 'fiber-line',
    type: 'line',
    source: 'fiber',
    paint: {
      'line-color': '#4fc3f7',
      'line-width': 2.5,
      'line-dasharray': [4, 2],
    },
  });
}

function addVehicleLayers(map) {
  map.addSource('vehicles', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
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
    },
  });

  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });

  function bindHover(layerId) {
    map.on('mouseenter', layerId, (e) => {
      map.getCanvas().style.cursor = 'pointer';
      const props = e.features[0].properties;
      const laneLabel = props.lane === 'eb' ? 'EB (up canyon)' : props.lane === 'wb' ? 'WB (down canyon)' : '';
      const typeLabel = vehicleTypeLabel(props.type);
      popup
        .setLngLat(e.lngLat)
        .setHTML(`
        <strong>${typeLabel}</strong> ${props.id}<br/>
        ${laneLabel} &bull; ${props.speed} mph<br/>
        MP ${props.milepost}
      `)
        .addTo(map);
    });
    map.on('mouseleave', layerId, () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
    });
  }

  bindHover('vehicle-blocks-fill');
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
