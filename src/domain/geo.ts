// Geodesy helpers. Pure functions, unit-tested.
import type { Bbox } from './types';

export const EARTH_RADIUS_M = 6371008.8;
export const MAX_MERCATOR_LAT = 85.05112878;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Great-circle distance in metres. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const s1 = Math.sin(((lat2 - lat1) * D2R) / 2);
  const s2 = Math.sin(((lon2 - lon1) * D2R) / 2);
  const a = s1 * s1 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * s2 * s2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing from point 1 to point 2, degrees clockwise from north, 0..360. */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * D2R;
  const p2 = lat2 * D2R;
  const dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

/** Point reached from (lat, lon) after `distM` metres on `bearing` degrees. Returns [lat, lon]. */
export function destinationPoint(lat: number, lon: number, bearing: number, distM: number): [number, number] {
  const d = distM / EARTH_RADIUS_M;
  const b = bearing * D2R;
  const p1 = lat * D2R;
  const l1 = lon * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [p2 * R2D, ((l2 * R2D + 540) % 360) - 180];
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export function compassLabel(bearing: number): string {
  return COMPASS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8]!;
}

export function emptyBbox(): Bbox {
  return [Infinity, Infinity, -Infinity, -Infinity];
}

export function extendBbox(b: Bbox, lat: number, lon: number): void {
  if (lon < b[0]) b[0] = lon;
  if (lat < b[1]) b[1] = lat;
  if (lon > b[2]) b[2] = lon;
  if (lat > b[3]) b[3] = lat;
}

export function isValidBbox(b: Bbox): boolean {
  return b.every(Number.isFinite) && b[0] <= b[2] && b[1] <= b[3];
}

/** Grow a bbox by `meters` on every side, clamped to the Web Mercator world. */
export function bufferBbox(b: Bbox, meters: number): Bbox {
  const dLat = (meters / EARTH_RADIUS_M) * R2D;
  const refLat = Math.min(MAX_MERCATOR_LAT, Math.max(Math.abs(b[1]), Math.abs(b[3])) + dLat);
  const dLon = dLat / Math.max(0.01, Math.cos(refLat * D2R));
  return [
    Math.max(-180, b[0] - dLon),
    Math.max(-MAX_MERCATOR_LAT, b[1] - dLat),
    Math.min(180, b[2] + dLon),
    Math.min(MAX_MERCATOR_LAT, b[3] + dLat),
  ];
}

export function bboxSizeKm(b: Bbox): { widthKm: number; heightKm: number } {
  const midLat = (b[1] + b[3]) / 2;
  return {
    widthKm: haversine(midLat, b[0], midLat, b[2]) / 1000,
    heightKm: haversine(b[1], b[0], b[3], b[0]) / 1000,
  };
}

export function bboxContains(b: Bbox, lat: number, lon: number): boolean {
  return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
}

/**
 * Local flat-earth projection around a reference point. Good to well under a metre
 * within a few kilometres, which is all the trail matcher needs.
 */
export function localProjector(lat0: number, lon0: number): (lat: number, lon: number) => [number, number] {
  const kx = EARTH_RADIUS_M * D2R * Math.cos(lat0 * D2R);
  const ky = EARTH_RADIUS_M * D2R;
  return (lat, lon) => {
    let dLon = lon - lon0;
    if (dLon > 180) dLon -= 360;
    else if (dLon < -180) dLon += 360;
    return [dLon * kx, (lat - lat0) * ky];
  };
}

/** Closest point on segment A→B to the origin (0,0), in a planar frame. */
export function closestOnSegmentToOrigin(ax: number, ay: number, bx: number, by: number): { t: number; d2: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 0) {
    t = -(ax * dx + ay * dy) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return { t, d2: cx * cx + cy * cy };
}

/** Ring of [lon, lat] pairs approximating a circle on the ground (for the GPS accuracy circle). */
export function circleRing(lat: number, lon: number, radiusM: number, steps = 48): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const [la, lo] = destinationPoint(lat, lon, (i * 360) / steps, radiusM);
    ring.push([lo, la]);
  }
  return ring;
}
