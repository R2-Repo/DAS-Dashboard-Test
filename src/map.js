import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const CANYON_CENTER = [-111.76, 40.58];
const DEFAULT_ZOOM = 13;

export function initMap(containerId) {
  const map = new maplibregl.Map({
    container: containerId,
    style: {
      version: 8,
      name: 'DAS Dark',
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '&copy; OpenStreetMap contributors',
        },
      },
      layers: [
        {
          id: 'osm-tiles',
          type: 'raster',
          source: 'osm',
          minzoom: 0,
          maxzoom: 19,
        },
      ],
    },
    center: CANYON_CENTER,
    zoom: DEFAULT_ZOOM,
  });

  map.addControl(new maplibregl.NavigationControl(), 'top-right');

  map.on('load', () => {
    addFiberRoute(map);
  });

  return map;
}

function addFiberRoute(map) {
  const fiberLine = {
    type: 'Feature',
    properties: { name: 'Fiber Route' },
    geometry: {
      type: 'LineString',
      coordinates: [
        [-111.78, 40.565],
        [-111.775, 40.57],
        [-111.77, 40.575],
        [-111.765, 40.578],
        [-111.76, 40.58],
        [-111.755, 40.583],
        [-111.75, 40.588],
        [-111.745, 40.592],
        [-111.74, 40.595],
      ],
    },
  };

  map.addSource('fiber-route', {
    type: 'geojson',
    data: fiberLine,
  });

  map.addLayer({
    id: 'fiber-route-line',
    type: 'line',
    source: 'fiber-route',
    paint: {
      'line-color': '#4fc3f7',
      'line-width': 3,
      'line-dasharray': [2, 1],
    },
  });
}
