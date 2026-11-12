// Where is the hiker on the trail? Projects a GPS fix onto the trail line and resolves the
// ambiguity of loops, out-and-backs and overlapping sections (PLAN §6.6).
import { bearingDeg, closestOnSegmentToOrigin, haversine, localProjector } from './geo';
import { cumulativeDistance } from './gpx';
import type { LatLonEle, Trail } from './types';

/** A trail in its direction of travel, with segments joined into one distance axis. */
export interface TrailGeometry {
  segments: LatLonEle[][];
  cumDist: number[][];
  /** Distance at which each segment starts on the joined axis. */
  segOffsets: number[];
  totalM: number;
  isLoop: boolean;
}

export function makeGeometry(segments: LatLonEle[][], cumDist: number[][], isLoop: boolean): TrailGeometry {
  const segOffsets: number[] = [];
  let total = 0;
  for (const cd of cumDist) {
    segOffsets.push(total);
    total += cd[cd.length - 1] ?? 0;
  }
  return { segments, cumDist, segOffsets, totalM: total, isLoop };
}

/** Geometry in the direction the user walks it: honours the per-trail "Reverse direction" toggle. */
export function orientedGeometry(trail: Pick<Trail, 'segments' | 'cumDist' | 'reversed' | 'stats'>): TrailGeometry {
  if (!trail.reversed) return makeGeometry(trail.segments, trail.cumDist, trail.stats.isLoop);
  const segments = trail.segments.map((s) => s.slice().reverse()).reverse();
  return makeGeometry(segments, segments.map(cumulativeDistance), trail.stats.isLoop);
}

export interface TrailMatch {
  /** Distance walked from the start, metres. */
  alongM: number;
  /** Distance from the fix to the trail, metres. */
  offM: number;
  /** Nearest point on the trail. */
  lat: number;
  lon: number;
  /** Bearing from the fix to that point, degrees from north. */
  bearingToTrail: number;
  segIndex: number;
  pointIndex: number;
}

export interface LocateOptions {
  /** Last matched distance along the trail, if any. */
  lastAlongM?: number | null;
  /** GPS accuracy radius in metres; widens what counts as "equally close". */
  accuracyM?: number;
}

export const HISTORY_WINDOW_M = 1000;
export const LOOP_START_RADIUS_M = 200;
/** A saved match older than this is ignored: yesterday's finish must not pin today's start. */
export const HISTORY_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const MIN_TOLERANCE_M = 15;
const MAX_TOLERANCE_M = 50;
/** How far a match may slip backwards (GPS jitter) and still count as "not behind". */
const BACKWARD_SLACK_M = 30;

interface Candidate {
  alongM: number;
  d: number;
  seg: number;
  idx: number;
  t: number;
}

/**
 * Match a fix to the trail.
 *
 * Every stretch of trail that passes about as close to the fix as the closest one (within GPS
 * accuracy) is a candidate: a loop's start and finish, both directions of an out-and-back, a spur
 * walked twice... Then:
 *  - with history: among candidates within ±1 km of the last match take the first one that is not
 *    behind it (hikers move forward), else the closest one behind; with none in that window, the
 *    first candidate ahead of the last match; failing that, the nearest;
 *  - without history: the nearest, except that near the start/finish of a loop we assume the start.
 */
export function locateOnTrail(geom: TrailGeometry, lat: number, lon: number, opts: LocateOptions = {}): TrailMatch | null {
  if (geom.segments.length === 0) return null;
  const project = localProjector(lat, lon);

  // Pass 1: distance from the fix to every piece of the trail.
  let pieces = 0;
  for (const seg of geom.segments) pieces += seg.length - 1;
  if (pieces <= 0) return null;
  const dist = new Float64Array(pieces);
  const param = new Float32Array(pieces);
  let k = 0;
  let dMin = Infinity;
  for (const seg of geom.segments) {
    let [ax, ay] = project(seg[0]![0], seg[0]![1]);
    for (let i = 1; i < seg.length; i++) {
      const [bx, by] = project(seg[i]![0], seg[i]![1]);
      const { t, d2 } = closestOnSegmentToOrigin(ax, ay, bx, by);
      const d = Math.sqrt(d2);
      dist[k] = d;
      param[k] = t;
      if (d < dMin) dMin = d;
      k++;
      ax = bx;
      ay = by;
    }
  }

  // Pass 2: group consecutive near-minimum pieces into one candidate each.
  const tolerance = Math.min(MAX_TOLERANCE_M, Math.max(MIN_TOLERANCE_M, opts.accuracyM ?? 0));
  const limit = dMin + tolerance;
  const candidates: Candidate[] = [];
  k = 0;
  for (let s = 0; s < geom.segments.length; s++) {
    const count = geom.segments[s]!.length - 1;
    let best = -1;
    for (let i = 0; i <= count; i++) {
      const inRun = i < count && dist[k + i]! <= limit;
      if (inRun) {
        if (best === -1 || dist[k + i]! < dist[k + best]!) best = i;
      } else if (best !== -1) {
        const cd = geom.cumDist[s]!;
        const t = param[k + best]!;
        candidates.push({
          alongM: geom.segOffsets[s]! + cd[best]! + t * (cd[best + 1]! - cd[best]!),
          d: dist[k + best]!,
          seg: s,
          idx: best,
          t,
        });
        best = -1;
      }
    }
    k += count;
  }
  if (candidates.length === 0) return null;

  const nearest = (list: Candidate[]) => list.reduce((a, b) => (b.d < a.d ? b : a));
  const earliest = (list: Candidate[]) => list.reduce((a, b) => (b.alongM < a.alongM ? b : a));
  const latest = (list: Candidate[]) => list.reduce((a, b) => (b.alongM > a.alongM ? b : a));
  let chosen: Candidate;
  const last = opts.lastAlongM;
  if (last !== null && last !== undefined && Number.isFinite(last)) {
    const near = candidates.filter((c) => Math.abs(c.alongM - last) <= HISTORY_WINDOW_M);
    if (near.length) {
      const notBehind = near.filter((c) => c.alongM >= last - BACKWARD_SLACK_M);
      chosen = notBehind.length ? earliest(notBehind) : latest(near);
    } else {
      const ahead = candidates.filter((c) => c.alongM >= last);
      chosen = ahead.length ? earliest(ahead) : nearest(candidates);
    }
  } else {
    chosen = nearest(candidates);
    if (geom.isLoop) {
      const start = geom.segments[0]![0]!;
      if (haversine(lat, lon, start[0], start[1]) <= LOOP_START_RADIUS_M) {
        const early = candidates.filter((c) => c.alongM <= geom.totalM / 2);
        if (early.length) chosen = earliest(early);
      }
    }
  }

  const seg = geom.segments[chosen.seg]!;
  const a = seg[chosen.idx]!;
  const b = seg[chosen.idx + 1]!;
  const mLat = a[0] + chosen.t * (b[0] - a[0]);
  const mLon = a[1] + chosen.t * (b[1] - a[1]);
  return {
    alongM: chosen.alongM,
    offM: haversine(lat, lon, mLat, mLon),
    lat: mLat,
    lon: mLon,
    bearingToTrail: bearingDeg(lat, lon, mLat, mLon),
    segIndex: chosen.seg,
    pointIndex: chosen.idx,
  };
}

/** The point on the trail at a given distance from the start (for the profile scrubber). */
export function pointAtDistance(geom: TrailGeometry, alongM: number): { lat: number; lon: number } | null {
  if (geom.segments.length === 0) return null;
  const d = Math.min(geom.totalM, Math.max(0, alongM));
  let s = geom.segments.length - 1;
  for (let i = 0; i < geom.segments.length; i++) {
    const end = geom.segOffsets[i]! + (geom.cumDist[i]![geom.cumDist[i]!.length - 1] ?? 0);
    if (d <= end) {
      s = i;
      break;
    }
  }
  const cd = geom.cumDist[s]!;
  const seg = geom.segments[s]!;
  const local = d - geom.segOffsets[s]!;
  // Binary search for the piece containing `local`.
  let lo = 0;
  let hi = cd.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cd[mid]! <= local) lo = mid;
    else hi = mid;
  }
  const a = seg[lo]!;
  const b = seg[hi]!;
  const span = cd[hi]! - cd[lo]!;
  const t = span > 0 ? Math.min(1, Math.max(0, (local - cd[lo]!) / span)) : 0;
  return { lat: a[0] + t * (b[0] - a[0]), lon: a[1] + t * (b[1] - a[1]) };
}

export type OffTrailLevel = 'on' | 'near' | 'amber' | 'red';

/** Off-trail severity: shown above 30 m, amber above 50 m, red above 150 m. */
export function offTrailLevel(offM: number): OffTrailLevel {
  if (offM > 150) return 'red';
  if (offM > 50) return 'amber';
  if (offM > 30) return 'near';
  return 'on';
}
