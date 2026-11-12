// Builds the map style: OpenFreeMap "Liberty" (vendored in style.base.json) adapted into an
// outdoor style whose sources, fonts and sprites all resolve offline (PLAN §5.3-§5.5).
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import baseStyle from './style.base.json';
import { contourTilesUrl } from './contours';
import { BASEMAP_ATTRIBUTION, DEM_ATTRIBUTION, DEM_TILE_SIZE, appUrl } from './sources';

export interface StyleOptions {
  /** Version directory used in offline://basemap/{version}/... ; other stored versions are still found. */
  basemapVersion: string;
  basemapMaxzoom: number;
  demMaxzoom: number;
}

const PATH_COLOR = '#b3432b';
const TRACK_COLOR = '#8a5a2b';
const CONTOUR_COLOR = '#9a6a3a';
const LABEL_HALO = 'rgba(255,255,255,0.85)';

// Latin name first, so labels never depend on fonts that are not bundled.
const NAME_FIELD = ['coalesce', ['get', 'name:latin'], ['get', 'name_en'], ['get', 'name']];

// The style JSON is assembled as plain data and validated by MapLibre when it loads.
interface AnyLayer {
  id: string;
  type: string;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  [key: string]: unknown;
}

function isNonBridgeOrTunnel(): unknown[] {
  return ['match', ['get', 'brunnel'], ['bridge', 'tunnel'], false, true];
}

function outdoorLayers(): Record<'terrain' | 'paths' | 'labels', AnyLayer[]> {
  const lineOnly = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
  return {
    terrain: [
      {
        id: 'tk_hillshade',
        type: 'hillshade',
        source: 'dem',
        paint: {
          'hillshade-exaggeration': 0.42,
          'hillshade-shadow-color': '#4a4030',
          'hillshade-highlight-color': '#ffffff',
          'hillshade-accent-color': '#5c5140',
          'hillshade-illumination-direction': 315,
        },
      },
      {
        id: 'tk_contour_lines',
        type: 'line',
        source: 'contours',
        'source-layer': 'contours',
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': CONTOUR_COLOR,
          'line-opacity': ['match', ['get', 'level'], 1, 0.6, 0.35],
          'line-width': ['match', ['get', 'level'], 1, 1.1, 0.55],
        },
      },
    ],
    paths: [
      // Farm and forest tracks: long brown dashes.
      {
        id: 'tk_track_casing',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 12,
        filter: ['all', lineOnly, ['==', ['get', 'class'], 'track'], isNonBridgeOrTunnel()],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-opacity': 0.7,
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.8, 14, 3, 18, 7],
        },
      },
      {
        id: 'tk_track',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 12,
        filter: ['all', lineOnly, ['==', ['get', 'class'], 'track'], isNonBridgeOrTunnel()],
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': TRACK_COLOR,
          'line-dasharray': [4, 2],
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 14, 1.5, 18, 4],
        },
      },
      // Footpaths: short red-brown dashes, visible from z12.
      {
        id: 'tk_path_casing',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 12,
        filter: ['all', lineOnly, ['==', ['get', 'class'], 'path'], ['!=', ['get', 'brunnel'], 'tunnel']],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-opacity': 0.75,
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.8, 14, 3, 18, 6.5],
        },
      },
      {
        id: 'tk_path',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 12,
        filter: ['all', lineOnly, ['==', ['get', 'class'], 'path'], ['!=', ['get', 'brunnel'], 'tunnel']],
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': PATH_COLOR,
          'line-dasharray': [2, 1.4],
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.9, 14, 1.5, 18, 3.6],
        },
      },
    ],
    labels: [
      {
        id: 'tk_contour_labels',
        type: 'symbol',
        source: 'contours',
        'source-layer': 'contours',
        minzoom: 12,
        filter: ['==', ['get', 'level'], 1],
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 320,
          'text-field': ['concat', ['to-string', ['get', 'ele']], ' m'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 10.5,
          'text-max-angle': 25,
          'text-padding': 4,
        },
        paint: { 'text-color': '#7a5230', 'text-halo-color': LABEL_HALO, 'text-halo-width': 1.4 },
      },
      {
        id: 'tk_peaks',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'mountain_peak',
        minzoom: 9,
        layout: {
          'icon-image': ['match', ['get', 'class'], 'volcano', 'volcano_11', 'mountain_11'],
          'icon-size': 1,
          'text-field': [
            'case',
            ['has', 'ele'],
            ['concat', ['coalesce', ['get', 'name:latin'], ['get', 'name'], ''], '\n', ['to-string', ['get', 'ele']], ' m'],
            ['coalesce', ['get', 'name:latin'], ['get', 'name'], ''],
          ],
          'text-font': ['Noto Sans Italic'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 14, 12],
          'text-anchor': 'top',
          'text-offset': [0, 0.6],
          'text-max-width': 8,
          'text-optional': true,
          'symbol-sort-key': ['coalesce', ['get', 'rank'], 10],
        },
        paint: { 'text-color': '#4d3520', 'text-halo-color': LABEL_HALO, 'text-halo-width': 1.4 },
      },
    ],
  };
}

/** Build the full style. Pure function of its options apart from reading the app's base URL. */
export function buildStyle(opts: StyleOptions): StyleSpecification {
  const base = baseStyle as unknown as StyleSpecification;
  const extra = outdoorLayers();
  const layers: AnyLayer[] = [];

  for (const original of base.layers as unknown as AnyLayer[]) {
    // The Natural Earth raster backdrop is a remote source we do not download.
    if (original.id === 'natural_earth') continue;
    // No 3D: it costs GPU and battery (PLAN §5.4).
    if (original.type === 'fill-extrusion') continue;
    // Replaced by the outdoor path layers below.
    if (original.id === 'road_path_pedestrian' || original.id === 'bridge_path_pedestrian_casing') continue;

    const layer = structuredClone(original);
    if (layer.id === 'building') delete layer.maxzoom; // was handing over to the 3D layer at z14
    if (layer.type === 'symbol' && layer.layout && Array.isArray(layer.layout['text-field'])) {
      const field = layer.layout['text-field'] as unknown[];
      if (field[0] === 'case' && JSON.stringify(field).includes('name:nonlatin')) layer.layout['text-field'] = NAME_FIELD;
    }
    if (layer.id === 'bridge_path_pedestrian') {
      layer.paint = { ...layer.paint, 'line-color': PATH_COLOR, 'line-dasharray': [2, 1.4] };
    }

    // Terrain goes under roads: insert it just before the first aeroway / road layer.
    if (layer.id === 'aeroway_fill') layers.push(...extra.terrain);
    // Paths go where Liberty drew its white dashed paths.
    if (layer.id === 'road_motorway_link') layers.push(...extra.paths);
    // Contour and peak labels sit under place names.
    if (layer.id === 'waterway_line_label') layers.push(...extra.labels);
    layers.push(layer);
  }

  return {
    version: 8,
    name: 'TrailKeep Outdoor',
    glyphs: 'offline://glyphs/{fontstack}/{range}',
    sprite: appUrl('sprites/ofm'),
    sources: {
      openmaptiles: {
        type: 'vector',
        tiles: [`offline://basemap/${opts.basemapVersion}/{z}/{x}/{y}`],
        minzoom: 0,
        maxzoom: opts.basemapMaxzoom,
        attribution: BASEMAP_ATTRIBUTION,
        // Missing tiles are filled from the nearest stored lower-zoom tile (MapLibre ≥ 6).
        sparse: true,
      } as StyleSpecification['sources'][string],
      dem: {
        type: 'raster-dem',
        tiles: ['offline://dem/{z}/{x}/{y}'],
        tileSize: DEM_TILE_SIZE,
        encoding: 'terrarium',
        maxzoom: opts.demMaxzoom,
        attribution: DEM_ATTRIBUTION,
      },
      contours: {
        type: 'vector',
        tiles: [contourTilesUrl()],
        minzoom: 11,
        maxzoom: 15,
      },
    },
    layers: layers as unknown as LayerSpecification[],
  };
}
