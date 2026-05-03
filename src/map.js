/**
 * 3D MapLibre map — terrain, hillshade, GIS layers, and dynamic vehicle/anomaly markers.
 *
 * Tile sources (all free, no API key):
 *   - Base map: OpenStreetMap raster tiles
 *   - Terrain: AWS Terrarium RGB elevation tiles (for 3D + hillshade)
 *
 * GIS layers on load: fiber route only (road centerline, mileposts, crossings hidden).
 * Dynamic layers: vehicles as fill-extrusion blocks (oriented rectangles on terrain),
 * anomalies as circles.
 *
 * Exports: initMap(), updateMapVehicles(), updateMapAnomalies()
 */
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { vehicleSpec } from './vehicle-model.js';

const TERRAIN_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

const VEHICLE_HIT_LAYERS = ['vehicle-blocks-fill', 'vehicle-blocks-outline'];

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
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '&copy; OpenStreetMap contributors',
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
        { id: 'osm-tiles', type: 'raster', source: 'osm' },
        {
          id: 'hillshade',
          type: 'hillshade',
          source: 'hillshadeSource',
          paint: {
            'hillshade-shadow-color': '#1a1a2e',
            'hillshade-highlight-color': '#fafafa',
            'hillshade-accent-color': '#5a5a7a',
            'hillshade-exaggeration': 0.3,
          },
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
    addVehicleLayers(map);
    addAnomalyLayer(map);
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
      'fill-extrusion-opacity': [
        'case',
        ['==', ['get', 'selected'], 1],
        0.95,
        0.82,
      ],
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
      'fill-extrusion-opacity': [
        'case',
        ['==', ['get', 'selected'], 1],
        1,
        0.55,
      ],
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
 * Map interaction for the traffic simulator: click vehicle to select, double-click empty
 * road to add, drag selected vehicle (left button / one finger). Pan with right/middle
 * mouse or two-finger touch.
 */
export function setupTrafficSimulatorMapInteractions(map, sim) {
  let dragging = false;

  function vehicleFeatureAtPoint(e) {
    const hits = map.queryRenderedFeatures(e.point, { layers: VEHICLE_HIT_LAYERS });
    return hits.length ? hits[0] : null;
  }

  map.on('click', (e) => {
    const feat = vehicleFeatureAtPoint(e);
    if (feat) {
      sim.setSelectedVehicleId(feat.properties.id);
      sim.syncFleetPanel?.();
      return;
    }
    sim.setSelectedVehicleId(null);
    sim.syncFleetPanel?.();
  });

  map.on('dblclick', (e) => {
    e.preventDefault();
    const v = sim.addVehicleNearLngLat(e.lngLat.lng, e.lngLat.lat);
    if (v) sim.syncFleetPanel?.();
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
