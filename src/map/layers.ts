// Overlay layers drawn on top of the basemap: trail, waypoints, user location, scrub highlight
// and the outlines of downloaded areas (PLAN §5.4, §6.5).
import type { Feature, FeatureCollection } from 'geojson';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { circleRing } from '../domain/geo';
import type { TrailGeometry } from '../domain/progress';
import type { Bbox, Fix, Region, Waypoint } from '../domain/types';

export const TRAIL_COLOR = '#E5007D';
const USER_COLOR = '#1a73e8';
const STALE_COLOR = '#8a8f98';

type FC = FeatureCollection;
const EMPTY: FC = { type: 'FeatureCollection', features: [] };

const SOURCES = ['tk-regions', 'tk-trail', 'tk-trail-points', 'tk-user-accuracy', 'tk-user', 'tk-highlight'] as const;
type SourceId = (typeof SOURCES)[number];

function setData(map: MlMap, id: SourceId, data: FC): void {
  (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
}

/** White chevron used for the direction arrows along the trail. */
function arrowImage(): ImageData {
  const size = 32;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(11, 7);
  ctx.lineTo(21, 16);
  ctx.lineTo(11, 25);
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

/** Soft blue cone showing which way the phone points. Drawn pointing north (up). */
function headingImage(): ImageData {
  const size = 96;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 6, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(26,115,232,0.55)');
  g.addColorStop(1, 'rgba(26,115,232,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(size / 2, size / 2);
  ctx.arc(size / 2, size / 2, size / 2, (-90 - 32) * (Math.PI / 180), (-90 + 32) * (Math.PI / 180));
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

/** Add overlay sources and layers. Call once, after the style has loaded. */
export function addOverlayLayers(map: MlMap): void {
  if (!map.hasImage('tk-arrow')) map.addImage('tk-arrow', arrowImage(), { pixelRatio: 2 });
  if (!map.hasImage('tk-heading')) map.addImage('tk-heading', headingImage(), { pixelRatio: 2 });
  for (const id of SOURCES) {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
  }

  map.addLayer({
    id: 'tk-regions-line',
    type: 'line',
    source: 'tk-regions',
    paint: { 'line-color': '#1f5d3a', 'line-width': 1.5, 'line-dasharray': [3, 2], 'line-opacity': 0.8 },
  });

  // Trail: 5 px line with a white halo, direction arrows from z14.
  map.addLayer({
    id: 'tk-trail-halo',
    type: 'line',
    source: 'tk-trail',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 5, 12, 9], 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: 'tk-trail-line',
    type: 'line',
    source: 'tk-trail',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': TRAIL_COLOR, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 3, 12, 5] },
  });
  map.addLayer({
    id: 'tk-trail-arrows',
    type: 'symbol',
    source: 'tk-trail',
    minzoom: 14,
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 110,
      'icon-image': 'tk-arrow',
      'icon-size': 0.95,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-rotation-alignment': 'map',
    },
  });

  map.addLayer({
    id: 'tk-waypoints',
    type: 'circle',
    source: 'tk-trail-points',
    filter: ['==', ['get', 'kind'], 'waypoint'],
    paint: { 'circle-radius': 6, 'circle-color': '#f59e0b', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
  });
  map.addLayer({
    id: 'tk-ends',
    type: 'circle',
    source: 'tk-trail-points',
    filter: ['!=', ['get', 'kind'], 'waypoint'],
    paint: {
      'circle-radius': 8,
      'circle-color': ['match', ['get', 'kind'], 'start', '#15803d', 'end', '#111827', '#15803d'],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2.5,
    },
  });
  map.addLayer({
    id: 'tk-point-labels',
    type: 'symbol',
    source: 'tk-trail-points',
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 12,
      'text-anchor': 'top',
      'text-offset': [0, 0.9],
      'text-optional': true,
    },
    paint: { 'text-color': '#111827', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
  });

  map.addLayer({
    id: 'tk-highlight',
    type: 'circle',
    source: 'tk-highlight',
    paint: { 'circle-radius': 8, 'circle-color': '#ffffff', 'circle-stroke-color': TRAIL_COLOR, 'circle-stroke-width': 4 },
  });

  map.addLayer({
    id: 'tk-user-accuracy',
    type: 'fill',
    source: 'tk-user-accuracy',
    paint: {
      'fill-color': ['case', ['get', 'stale'], STALE_COLOR, USER_COLOR],
      'fill-opacity': 0.14,
      'fill-outline-color': ['case', ['get', 'stale'], STALE_COLOR, USER_COLOR],
    },
  });
  map.addLayer({
    id: 'tk-user-heading',
    type: 'symbol',
    source: 'tk-user',
    filter: ['has', 'heading'],
    layout: {
      'icon-image': 'tk-heading',
      'icon-rotate': ['get', 'heading'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });
  map.addLayer({
    id: 'tk-user-dot',
    type: 'circle',
    source: 'tk-user',
    paint: {
      'circle-radius': 8,
      'circle-color': ['case', ['get', 'stale'], STALE_COLOR, USER_COLOR],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 3,
    },
  });
}

/** Draw the trail in its direction of travel, with start/end markers and waypoints. */
export function setTrailData(map: MlMap, geom: TrailGeometry | null, waypoints: Waypoint[]): void {
  if (!geom || geom.segments.length === 0) {
    setData(map, 'tk-trail', EMPTY);
    setData(map, 'tk-trail-points', EMPTY);
    return;
  }
  setData(map, 'tk-trail', {
    type: 'FeatureCollection',
    // One LineString per segment: no line is drawn across gaps between segments.
    features: geom.segments.map((seg) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: seg.map((p) => [p[1], p[0]]) },
    })),
  });

  const first = geom.segments[0]![0]!;
  const lastSeg = geom.segments[geom.segments.length - 1]!;
  const last = lastSeg[lastSeg.length - 1]!;
  const point = (lat: number, lon: number, kind: string, label: string): Feature => ({
    type: 'Feature',
    properties: { kind, label },
    geometry: { type: 'Point', coordinates: [lon, lat] },
  });
  const features: Feature[] = geom.isLoop
    ? [point(first[0], first[1], 'start', 'Start / End')]
    : [point(last[0], last[1], 'end', 'End'), point(first[0], first[1], 'start', 'Start')];
  for (const w of waypoints) features.push(point(w.lat, w.lon, 'waypoint', w.name ?? ''));
  setData(map, 'tk-trail-points', { type: 'FeatureCollection', features });
}

/** Blue dot, accuracy circle and optional heading cone. `stale` greys it out. */
export function setUserLocation(map: MlMap, fix: Fix | null, stale: boolean, heading: number | null): void {
  if (!fix) {
    setData(map, 'tk-user', EMPTY);
    setData(map, 'tk-user-accuracy', EMPTY);
    return;
  }
  const props: Record<string, unknown> = { stale };
  if (heading !== null && !stale) props.heading = heading;
  setData(map, 'tk-user', {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [fix.lon, fix.lat] } }],
  });
  setData(
    map,
    'tk-user-accuracy',
    fix.accuracyM > 5
      ? {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { stale },
              geometry: { type: 'Polygon', coordinates: [circleRing(fix.lat, fix.lon, Math.min(fix.accuracyM, 5000))] },
            },
          ],
        }
      : EMPTY,
  );
}

export function setHighlight(map: MlMap, point: { lat: number; lon: number } | null): void {
  setData(
    map,
    'tk-highlight',
    point
      ? {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [point.lon, point.lat] } }],
        }
      : EMPTY,
  );
}

export function bboxRing(b: Bbox): [number, number][] {
  return [
    [b[0], b[1]],
    [b[2], b[1]],
    [b[2], b[3]],
    [b[0], b[3]],
    [b[0], b[1]],
  ];
}

/** Dashed outlines of downloaded areas. */
export function setRegionOutlines(map: MlMap, regions: Region[]): void {
  setData(map, 'tk-regions', {
    type: 'FeatureCollection',
    features: regions.map((r) => ({
      type: 'Feature',
      properties: { name: r.name },
      geometry: { type: 'LineString', coordinates: bboxRing(r.bbox) },
    })),
  });
}
