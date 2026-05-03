/**
 * 3D MapLibre map — terrain, hillshade, GIS layers, and dynamic vehicle/anomaly markers.
 *
 * Tile sources (all free, no API key):
 *   - Base map: OpenStreetMap raster tiles
 *   - Terrain: AWS Terrarium RGB elevation tiles (for 3D + hillshade)
 *
 * GIS layers on load: fiber route only (road centerline, mileposts, crossings hidden).
 * Dynamic layers updated by simulation: vehicle markers (EB = up canyon, WB = down canyon),
 *
 * Exports: initMap(), updateMapVehicles(), updateMapAnomalies()
 */
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const TERRAIN_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

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
    addVehicleLayer(map);
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

function addVehicleLayer(map) {
  map.addSource('vehicles', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: 'vehicle-glow',
    type: 'circle',
    source: 'vehicles',
    paint: {
      'circle-radius': [
        'case',
        ['==', ['get', 'lab'], 1],
        14,
        10,
      ],
      'circle-color': [
        'match',
        ['get', 'lane'],
        'eb', '#66bb6a',
        'wb', '#ffa726',
        '#bdbdbd',
      ],
      'circle-opacity': 0.25,
      'circle-blur': 1,
    },
  });
  map.addLayer({
    id: 'vehicle-markers',
    type: 'circle',
    source: 'vehicles',
    paint: {
      'circle-radius': [
        'case',
        ['==', ['get', 'lab'], 1],
        8,
        5,
      ],
      'circle-color': [
        'match',
        ['get', 'lane'],
        'eb', '#66bb6a',
        'wb', '#ffa726',
        '#bdbdbd',
      ],
      'circle-stroke-width': [
        'case',
        ['==', ['get', 'lab'], 1],
        2.5,
        1.5,
      ],
      'circle-stroke-color': '#fff',
    },
  });

  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
  map.on('mouseenter', 'vehicle-markers', (e) => {
    map.getCanvas().style.cursor = 'pointer';
    const props = e.features[0].properties;
    const laneLabel = props.lane === 'eb' ? 'EB (up canyon)' : props.lane === 'wb' ? 'WB (down canyon)' : '';
    popup
      .setLngLat(e.lngLat)
      .setHTML(`
        <strong>${props.type === 'truck' ? 'Truck' : 'Vehicle'}</strong> ${props.id}<br/>
        ${laneLabel} &bull; ${props.speed} mph<br/>
        MP ${props.milepost}
      `)
      .addTo(map);
  });
  map.on('mouseleave', 'vehicle-markers', () => {
    map.getCanvas().style.cursor = '';
    popup.remove();
  });
}

/**
 * While `isDemoMode()` is true and `isRoadOk()` is true, drag on the map moves the lab vehicle
 * (snap to nearest EB/WB centerline). Map pan uses two-finger touch or right/middle mouse.
 */
export function setupTrafficLabMapDrag(map, { isDemoMode, isRoadOk, placeDemoVehicleAtLngLat }) {
  let dragging = false;

  function isLabDragAllowed() {
    return isDemoMode() && isRoadOk();
  }

  map.on('mousedown', (e) => {
    if (!isLabDragAllowed()) return;
    if (e.originalEvent.button !== 0) return;
    dragging = true;
    map.dragPan.disable();
    placeDemoVehicleAtLngLat(e.lngLat.lng, e.lngLat.lat);
    e.preventDefault();
  });

  map.on('mousemove', (e) => {
    if (!dragging) return;
    placeDemoVehicleAtLngLat(e.lngLat.lng, e.lngLat.lat);
  });

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    map.dragPan.enable();
  }

  map.on('mouseup', endDrag);
  map.on('mouseleave', endDrag);

  map.on('touchstart', (e) => {
    if (!isLabDragAllowed()) return;
    if (e.points.length !== 1) return;
    dragging = true;
    map.dragPan.disable();
    placeDemoVehicleAtLngLat(e.lngLat.lng, e.lngLat.lat);
  });

  map.on('touchmove', (e) => {
    if (!dragging || e.points.length !== 1) return;
    placeDemoVehicleAtLngLat(e.lngLat.lng, e.lngLat.lat);
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
