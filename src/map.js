/**
 * 3D MapLibre map — terrain, hillshade, GIS layers, and dynamic vehicle/anomaly markers.
 *
 * Tile sources (no API key in this build):
 *   - Base map: Esri World Imagery + reference overlays (transportation, boundaries/places) — hybrid satellite
 *   - Terrain: AWS Terrarium RGB elevation tiles (for 3D + hillshade)
 *
 * GIS layers on load: road centerlines (EB/WB), fiber path, milepost markers (optional overlays).
 * Dynamic layers: anomaly pulses, then vehicles as fill-extrusion blocks on terrain.
 *
 * Reference rasters are pre-rendered tiles: opacity and color tuning are available; per-feature
 * filtering (hiding POIs or hydrology labels) would require a vector style, not these layers.
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
  + '(<a href="https://goto.arcgisonline.com/maps/World_Imagery" target="_blank" rel="noopener">Imagery</a>, '
  + '<a href="https://goto.arcgisonline.com/maps/Reference/World_Transportation" target="_blank" rel="noopener">Transport</a>, '
  + '<a href="https://goto.arcgisonline.com/maps/Reference/World_Boundaries_and_Places" target="_blank" rel="noopener">Labels</a>)';

/** Bearing in degrees (MapLibre): 0 = north up; ~45° ≈ northeast-facing view. */
const DEFAULT_VIEW_BEARING = 45;
/** Initial / reset pitch; `fitBounds` uses this so framing accounts for tilted horizon. */
const DEFAULT_VIEW_PITCH = 55;
/** Nudges zoom after fitBounds: positive = zoom out, negative = zoom in from the fitted level. */
const FIT_BOUNDS_ZOOM_NUDGE = -0.22;
/** Upper cap for auto-fit zoom (road + fiber union); raised so steeper pitch can still zoom in. */
const FIT_BOUNDS_MAX_ZOOM = 13.45;

/** Bright intro-only route highlight; hidden once the user zooms in closer to the ground past baseline. */
const CANYON_INTRO_LAYER_GLOW = 'canyon-intro-highlight-glow';
const CANYON_INTRO_LAYER_CORE = 'canyon-intro-highlight-core';
/** Hide when current zoom exceeds baseline (post-idle) by this amount (user moved in on the map). */
const CANYON_INTRO_ZOOM_IN_DELTA = 0.65;

const LAYER_TOGGLE_IDS = {
  road: ['road-wb-centerline', 'road-eb-centerline'],
  overlays: ['esri-transport', 'esri-boundaries'],
  fiber: 'fiber-glow',
  mileposts: ['milepost-markers', 'milepost-labels'],
};

export function initMap(containerId, data) {
  const bounds = unionBounds([
    boundsFromLineFeaturesGeojson(data.road),
    boundsFromLineFeaturesGeojson(data.fiberRoute),
  ]);
  const coarsePointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)')?.matches;
  const narrowScreen = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 768px)')?.matches;

  const map = new maplibregl.Map({
    container: containerId,
    attributionControl: false,
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
          paint: {
            'raster-opacity': 0.52,
            'raster-saturation': -0.35,
            'raster-contrast': 0.08,
            'raster-brightness-min': 0.02,
            'raster-brightness-max': 0.96,
            'raster-fade-duration': 0,
          },
        },
        {
          id: 'esri-boundaries',
          type: 'raster',
          source: 'esri-boundaries',
          paint: {
            'raster-opacity': 0.44,
            'raster-saturation': -0.45,
            'raster-contrast': 0.12,
            'raster-brightness-min': 0.08,
            'raster-brightness-max': 0.94,
            'raster-fade-duration': 0,
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
    zoom: 11,
    pitch: DEFAULT_VIEW_PITCH,
    bearing: DEFAULT_VIEW_BEARING,
    maxPitch: coarsePointer && narrowScreen ? 60 : 85,
    maxZoom: 18,
    touchPitch: true,
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.TerrainControl({ source: 'terrainSource', exaggeration: 1.5 }), 'top-right');
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

  const mapEl = document.getElementById(containerId);
  const mapHost = mapEl?.parentElement;
  if (mapHost) {
    addMapLayerPanel(mapHost, map);
  }

  map.on('load', () => {
    applyRouteBoundsCamera(map, bounds);
    addRoadCenterlineLayers(map, data.road);
    addFiberLayer(map, data.fiberRoute);
    addMilepostLayers(map, data.mileposts);
    addVehicleLayers(map);
    addCanyonIntroHighlightLayers(map);
    addAnomalyLayer(map, 'vehicle-glow');
    setupCanyonIntroHighlightLifecycle(map);
    applyDefaultLayerVisibility(map);
    const attrib = map.getContainer().querySelector('.maplibregl-ctrl-attrib.maplibregl-compact');
    if (attrib) {
      attrib.classList.remove('maplibregl-compact-show');
      attrib.removeAttribute('open');
    }
  });

  return map;
}

/**
 * Fit the camera to the route with padding and default bearing/pitch (pitch affects visible area).
 * Applies a small zoom nudge after fit so the route fills more of the screen when capped by maxZoom.
 */
function applyRouteBoundsCamera(map, bounds) {
  if (!bounds || bounds[0] > bounds[2] || bounds[1] > bounds[3]) return;
  const b = [
    [bounds[0], bounds[1]],
    [bounds[2], bounds[3]],
  ];
  map.fitBounds(b, {
    padding: { top: 36, bottom: 44, left: 44, right: 44 },
    bearing: DEFAULT_VIEW_BEARING,
    pitch: DEFAULT_VIEW_PITCH,
    maxZoom: FIT_BOUNDS_MAX_ZOOM,
    linear: true,
    duration: 0,
  });
  const z = map.getZoom();
  const minZ = map.getMinZoom?.() ?? 0;
  map.setZoom(Math.max(minZ, z + FIT_BOUNDS_ZOOM_NUDGE));
}

function setLayerVisibility(map, layerId, visible) {
  if (!map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
}

function applyDefaultLayerVisibility(map) {
  for (const id of LAYER_TOGGLE_IDS.road) {
    setLayerVisibility(map, id, true);
  }
  for (const id of LAYER_TOGGLE_IDS.overlays) {
    setLayerVisibility(map, id, true);
  }
  setLayerVisibility(map, LAYER_TOGGLE_IDS.fiber, false);
  for (const id of LAYER_TOGGLE_IDS.mileposts) {
    setLayerVisibility(map, id, false);
  }
}

function addMapLayerPanel(hostEl, map) {
  const wrap = document.createElement('div');
  wrap.className = 'map-layer-control';
  wrap.innerHTML = `
    <button type="button" class="map-layer-control-toggle" aria-expanded="false" aria-controls="map-layer-panel" title="Map layers">
      <span class="map-layer-control-icon" aria-hidden="true"></span>
      <span class="map-layer-control-sr">Map layers</span>
    </button>
    <div id="map-layer-panel" class="map-layer-panel" role="group" aria-label="Map layers" hidden>
      <div class="map-layer-panel-title">Layers</div>
      <label class="map-layer-row">
        <input type="checkbox" data-layer-toggle="road" checked />
        <span>Road centerlines</span>
      </label>
      <label class="map-layer-row">
        <input type="checkbox" data-layer-toggle="overlays" checked />
        <span>Reference overlay</span>
      </label>
      <label class="map-layer-row">
        <input type="checkbox" data-layer-toggle="fiber" />
        <span>Fiber route</span>
      </label>
      <label class="map-layer-row">
        <input type="checkbox" data-layer-toggle="mileposts" />
        <span>Mileposts</span>
      </label>
    </div>
  `;

  const btn = wrap.querySelector('.map-layer-control-toggle');
  const panel = wrap.querySelector('#map-layer-panel');
  const iconHolder = wrap.querySelector('.map-layer-control-icon');

  if (!btn || !panel) {
    hostEl.appendChild(wrap);
    return;
  }

  if (iconHolder) {
    iconHolder.innerHTML = layerStackSvg();
  }

  function closePanel() {
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }

  function togglePanel() {
    const open = panel.hidden;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePanel();
  });

  wrap.querySelectorAll('[data-layer-toggle]').forEach((el) => {
    if (el.tagName !== 'INPUT') return;
    const input = /** @type {HTMLInputElement} */ (el);
    const key = input.getAttribute('data-layer-toggle');
    input.addEventListener('change', () => {
      const on = input.checked;
      if (key === 'fiber') {
        setLayerVisibility(map, LAYER_TOGGLE_IDS.fiber, on);
      } else if (key === 'mileposts') {
        for (const id of LAYER_TOGGLE_IDS.mileposts) {
          setLayerVisibility(map, id, on);
        }
      } else if (key === 'road') {
        for (const id of LAYER_TOGGLE_IDS.road) {
          setLayerVisibility(map, id, on);
        }
      } else if (key === 'overlays') {
        for (const id of LAYER_TOGGLE_IDS.overlays) {
          setLayerVisibility(map, id, on);
        }
      }
    });
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) closePanel();
  });

  hostEl.appendChild(wrap);
}

function layerStackSvg() {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/>'
    + '<path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/>'
    + '<path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>'
    + '</svg>'
  );
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

function milepostLabel(props) {
  const mp = props?.milepost ?? props?.Measure;
  if (mp == null || mp === '') return '';
  const n = Number(mp);
  if (Number.isFinite(n)) return `MP ${n.toFixed(1)}`;
  return `MP ${mp}`;
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
      'line-opacity': 0.4,
    },
  });
  map.addLayer({
    id: 'road-eb-centerline',
    type: 'line',
    source: 'road-eb',
    paint: {
      'line-color': LANE_ROUTE_COLOR_HEX.eb,
      'line-width': 2.2,
      'line-opacity': 0.4,
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
      'line-color': '#ff1744',
      'line-width': 3.2,
      'line-opacity': 1,
      'line-blur': 0,
    },
  });
}

/**
 * Purely decorative bright red route pulse on first paint; hidden after the user zooms in past
 * CANYON_INTRO_ZOOM_IN_DELTA from the baseline captured on first idle (see setupCanyonIntroHighlightLifecycle).
 * Drawn under vehicle layers so drops stay readable.
 */
function addCanyonIntroHighlightLayers(map) {
  if (!map.getSource('fiber') || !map.getLayer('vehicle-glow')) return;
  map.addLayer(
    {
      id: CANYON_INTRO_LAYER_GLOW,
      type: 'line',
      source: 'fiber',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ff0000',
        'line-width': 14,
        'line-opacity': 0.52,
        'line-blur': 4.5,
      },
    },
    'vehicle-glow',
  );
  map.addLayer(
    {
      id: CANYON_INTRO_LAYER_CORE,
      type: 'line',
      source: 'fiber',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ff1a1a',
        'line-width': 5,
        'line-opacity': 0.95,
        'line-blur': 0.35,
      },
    },
    'vehicle-glow',
  );
}

function setupCanyonIntroHighlightLifecycle(map) {
  if (!map.getLayer(CANYON_INTRO_LAYER_GLOW) || !map.getLayer(CANYON_INTRO_LAYER_CORE)) return;

  let introActive = true;
  let rafId = 0;
  /** @type {number | null} */
  let baselineZoom = null;

  function hideIntroHighlight() {
    if (!introActive) return;
    introActive = false;
    if (rafId) globalThis.cancelAnimationFrame(rafId);
    rafId = 0;
    map.off('zoom', checkDismissZoomIn);
    for (const id of [CANYON_INTRO_LAYER_GLOW, CANYON_INTRO_LAYER_CORE]) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', 'none');
      }
    }
  }

  function snapshotBaselineZoom() {
    baselineZoom = map.getZoom();
  }

  function checkDismissZoomIn() {
    if (!introActive || baselineZoom == null) return;
    if (map.getZoom() > baselineZoom + CANYON_INTRO_ZOOM_IN_DELTA) {
      hideIntroHighlight();
    }
  }

  function animatePulse() {
    if (!introActive || !map.getLayer(CANYON_INTRO_LAYER_GLOW)) return;
    const t = globalThis.performance.now() * 0.001;
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.75);
    map.setPaintProperty(CANYON_INTRO_LAYER_GLOW, 'line-width', 11 + pulse * 7);
    map.setPaintProperty(CANYON_INTRO_LAYER_GLOW, 'line-opacity', 0.32 + pulse * 0.38);
    map.setPaintProperty(CANYON_INTRO_LAYER_GLOW, 'line-blur', 2.2 + pulse * 3.2);
    map.setPaintProperty(CANYON_INTRO_LAYER_CORE, 'line-width', 3.8 + pulse * 1.9);
    map.setPaintProperty(CANYON_INTRO_LAYER_CORE, 'line-opacity', 0.78 + pulse * 0.2);
    rafId = globalThis.requestAnimationFrame(animatePulse);
  }

  function onIdleOnce() {
    map.off('idle', onIdleOnce);
    snapshotBaselineZoom();
    rafId = globalThis.requestAnimationFrame(animatePulse);
  }

  map.once('idle', onIdleOnce);

  map.on('zoom', checkDismissZoomIn);
}

function addMilepostLayers(map, milepostsGeojson) {
  const labeledFeatures = (milepostsGeojson?.features ?? []).map((f) => ({
    ...f,
    properties: {
      ...f.properties,
      mp_label: milepostLabel(f.properties ?? {}),
    },
  }));
  const fc = { type: 'FeatureCollection', features: labeledFeatures };

  map.addSource('mileposts', { type: 'geojson', data: fc });

  map.addLayer({
    id: 'milepost-markers',
    type: 'circle',
    source: 'mileposts',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.6, 14, 2.8, 17, 3.8],
      'circle-color': '#e8ecf4',
      'circle-opacity': 0.88,
      'circle-stroke-width': 1,
      'circle-stroke-color': '#4fc3f7',
    },
  });

  map.addLayer({
    id: 'milepost-labels',
    type: 'symbol',
    source: 'mileposts',
    layout: {
      'text-field': ['get', 'mp_label'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 11, 6.5, 14, 8, 17, 9],
      'text-offset': [0, 0.85],
      'text-anchor': 'top',
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-font': ['Noto Sans Medium', 'Arial Unicode MS Regular'],
    },
    paint: {
      'text-color': '#f0f2f8',
      'text-halo-color': '#1a1d28',
      'text-halo-width': 1.25,
      'text-halo-blur': 0.5,
    },
    filter: ['!=', ['get', 'mp_label'], ''],
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
  const { tryConsumeMapClick, isMassHazardDrawing } = options;

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
    if (isMassHazardDrawing?.()) return;
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
    if (isMassHazardDrawing?.()) return;
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

function addAnomalyLayer(map, beforeLayerId) {
  map.addSource('anomalies', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  const hazardPolygonFilter = ['==', ['geometry-type'], 'Polygon'];
  const hazardCellPoly = [
    'all',
    hazardPolygonFilter,
    ['==', ['coalesce', ['get', 'hazard_cell'], 0], 1],
  ];
  const hazardFootprintPoly = [
    'all',
    hazardPolygonFilter,
    ['!=', ['coalesce', ['get', 'hazard_cell'], 0], 1],
  ];

  map.addLayer(
    {
      id: 'anomaly-debris',
      type: 'fill-extrusion',
      source: 'anomalies',
      filter: hazardFootprintPoly,
      paint: {
        'fill-extrusion-height': ['coalesce', ['get', 'height_m'], 8],
        'fill-extrusion-base': 0,
        'fill-extrusion-color': [
          'match',
          ['get', 'hazard_kind'],
          'crash',
          '#ff6f00',
          'avalanche',
          '#29b6f6',
          '#8d6e63',
        ],
        'fill-extrusion-opacity': [
          'interpolate',
          ['linear'],
          ['get', 'decay'],
          0,
          0.96,
          1,
          0.78,
        ],
        'fill-extrusion-vertical-gradient': true,
      },
    },
    beforeLayerId,
  );

  map.addLayer(
    {
      id: 'anomaly-debris-cells',
      type: 'fill-extrusion',
      source: 'anomalies',
      filter: hazardCellPoly,
      paint: {
        'fill-extrusion-height': ['coalesce', ['get', 'height_m'], 6],
        'fill-extrusion-base': 0,
        'fill-extrusion-color': ['coalesce', ['get', 'cell_fill'], '#a1887f'],
        'fill-extrusion-opacity': [
          'interpolate',
          ['linear'],
          ['get', 'decay'],
          0,
          0.94,
          1,
          0.76,
        ],
        'fill-extrusion-vertical-gradient': true,
      },
    },
    beforeLayerId,
  );

  map.addLayer(
    {
      id: 'anomaly-debris-rim',
      type: 'fill-extrusion',
      source: 'anomalies',
      filter: hazardFootprintPoly,
      paint: {
        'fill-extrusion-height': ['+', ['coalesce', ['get', 'height_m'], 8], 0.85],
        'fill-extrusion-base': ['coalesce', ['get', 'height_m'], 8],
        'fill-extrusion-color': [
          'match',
          ['get', 'hazard_kind'],
          'crash',
          '#fff3e0',
          'avalanche',
          '#e1f5fe',
          '#efebe9',
        ],
        'fill-extrusion-opacity': [
          'interpolate',
          ['linear'],
          ['get', 'decay'],
          0,
          0.55,
          1,
          0.38,
        ],
        'fill-extrusion-vertical-gradient': false,
      },
    },
    beforeLayerId,
  );

  map.addLayer(
    {
      id: 'anomaly-debris-rim-cells',
      type: 'fill-extrusion',
      source: 'anomalies',
      filter: hazardCellPoly,
      paint: {
        'fill-extrusion-height': ['+', ['coalesce', ['get', 'height_m'], 6], 0.45],
        'fill-extrusion-base': ['coalesce', ['get', 'height_m'], 6],
        'fill-extrusion-color': '#fafafa',
        'fill-extrusion-opacity': [
          'interpolate',
          ['linear'],
          ['get', 'decay'],
          0,
          0.42,
          1,
          0.28,
        ],
        'fill-extrusion-vertical-gradient': false,
      },
    },
    beforeLayerId,
  );

  map.addLayer(
    {
      id: 'hazard-marker-symbol',
      type: 'symbol',
      source: 'anomalies',
      filter: ['==', ['get', 'hazard_marker'], 1],
      layout: {
        'text-field': ['get', 'marker_glyph'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 18, 13, 26, 16, 32],
        'text-anchor': 'center',
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-font': ['Noto Sans Medium', 'Arial Unicode MS Regular'],
      },
      paint: {
        'text-color': [
          'case',
          ['==', ['coalesce', ['get', 'marker_role'], 'mass'], 'crash'],
          '#141414',
          '#fff8e1',
        ],
        'text-halo-color': [
          'case',
          ['==', ['coalesce', ['get', 'marker_role'], 'mass'], 'crash'],
          '#ffc107',
          '#1a120b',
        ],
        'text-halo-width': [
          'case',
          ['==', ['coalesce', ['get', 'marker_role'], 'mass'], 'crash'],
          1.65,
          2.1,
        ],
        'text-halo-blur': [
          'case',
          ['==', ['coalesce', ['get', 'marker_role'], 'mass'], 'crash'],
          0.2,
          0.35,
        ],
        'text-opacity': [
          'interpolate',
          ['linear'],
          ['get', 'decay'],
          0,
          1,
          1,
          0.82,
        ],
      },
    },
    beforeLayerId,
  );

  map.addSource('hazard-preview', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: 'hazard-preview-line',
    type: 'line',
    source: 'hazard-preview',
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': '#ffeb3b',
      'line-width': 3,
      'line-opacity': 0.75,
      'line-dasharray': [2, 1],
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

export function updateHazardPreview(map, previewFeatures) {
  const src = map.getSource('hazard-preview');
  if (src) src.setData({ type: 'FeatureCollection', features: previewFeatures ?? [] });
}
