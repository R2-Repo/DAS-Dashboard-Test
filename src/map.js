import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const TERRAIN_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export function initMap(containerId, data) {
  const bounds = computeBounds(data.road);

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
    maxPitch: 85,
    maxZoom: 18,
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.TerrainControl({ source: 'terrainSource', exaggeration: 1.5 }), 'top-right');

  map.on('load', () => {
    addRoadLayer(map, data.road);
    addFiberLayer(map, data.fiberRoute);
    addMilepostLayer(map, data.mileposts);
    addCrossingLayer(map, data.crossings);
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

function addRoadLayer(map, road) {
  map.addSource('road', { type: 'geojson', data: road });
  map.addLayer({
    id: 'road-line',
    type: 'line',
    source: 'road',
    paint: {
      'line-color': '#ffcc02',
      'line-width': 4,
      'line-opacity': 0.7,
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

function addMilepostLayer(map, mileposts) {
  const majorMPs = {
    type: 'FeatureCollection',
    features: mileposts.features.filter((f) => {
      const mp = f.properties.milepost;
      return mp === Math.round(mp) || mp % 0.5 === 0;
    }),
  };

  map.addSource('mileposts', { type: 'geojson', data: majorMPs });
  map.addLayer({
    id: 'milepost-circles',
    type: 'circle',
    source: 'mileposts',
    paint: {
      'circle-radius': 4,
      'circle-color': '#fff',
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#333',
    },
  });
  map.addLayer({
    id: 'milepost-labels',
    type: 'symbol',
    source: 'mileposts',
    layout: {
      'text-field': ['get', 'label'],
      'text-size': 11,
      'text-offset': [0, -1.3],
      'text-anchor': 'bottom',
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#fff',
      'text-halo-color': '#000',
      'text-halo-width': 1.5,
    },
  });
}

function addCrossingLayer(map, crossings) {
  map.addSource('crossings', { type: 'geojson', data: crossings });
  map.addLayer({
    id: 'crossing-markers',
    type: 'circle',
    source: 'crossings',
    paint: {
      'circle-radius': 6,
      'circle-color': '#ab47bc',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff',
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
      'circle-radius': 10,
      'circle-color': ['case',
        ['==', ['get', 'direction'], 'up_canyon'], '#66bb6a',
        '#ffa726',
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
      'circle-radius': 5,
      'circle-color': ['case',
        ['==', ['get', 'direction'], 'up_canyon'], '#66bb6a',
        '#ffa726',
      ],
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#fff',
    },
  });

  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
  map.on('mouseenter', 'vehicle-markers', (e) => {
    map.getCanvas().style.cursor = 'pointer';
    const props = e.features[0].properties;
    popup
      .setLngLat(e.lngLat)
      .setHTML(`
        <strong>${props.type === 'truck' ? 'Truck' : 'Vehicle'}</strong> ${props.id}<br/>
        ${props.direction.replace('_', ' ')} &bull; ${props.speed} mph<br/>
        MP ${props.milepost}
      `)
      .addTo(map);
  });
  map.on('mouseleave', 'vehicle-markers', () => {
    map.getCanvas().style.cursor = '';
    popup.remove();
  });
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
