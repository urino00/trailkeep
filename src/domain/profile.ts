// Elevation profile: one algorithm feeds both the trail stats and the chart (PLAN §6.7).
//   1. resample the track to a fixed spacing (10 m),
//   2. smooth with a centred moving average (5 samples = 50 m),
//   3. sum the positive / negative steps for gain / loss.
import type { LatLonEle } from './types';

export const PROFILE_STEP_M = 10;
export const SMOOTH_WINDOW = 5;
const MAX_SAMPLES = 200_000;

export interface Profile {
  /** Number of samples. Sample i sits at distance i * stepM. */
  n: number;
  stepM: number;
  totalM: number;
  /** Smoothed elevation in metres. */
  ele: Float64Array;
  /** Cumulative gain / loss up to each sample. */
  cumGain: Float64Array;
  cumLoss: Float64Array;
  gainM: number;
  lossM: number;
  minEle: number;
  maxEle: number;
}

/**
 * Build the profile for a whole trail. Segments are joined end to end (gaps add no distance),
 * matching how progress along the trail is measured. Points without elevation are bridged by
 * linear interpolation. Returns null when the trail has no elevation at all.
 */
export function buildProfile(segments: LatLonEle[][], cumDist: number[][]): Profile | null {
  const rawD: number[] = [];
  const rawE: number[] = [];
  let offset = 0;
  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s]!;
    const cd = cumDist[s]!;
    for (let i = 0; i < seg.length; i++) {
      const e = seg[i]![2];
      if (e !== null) {
        rawD.push(offset + cd[i]!);
        rawE.push(e);
      }
    }
    offset += cd[cd.length - 1] ?? 0;
  }
  const totalM = offset;
  if (rawE.length === 0 || !(totalM > 0)) return null;

  let n = Math.max(2, Math.round(totalM / PROFILE_STEP_M) + 1);
  if (n > MAX_SAMPLES) n = MAX_SAMPLES;
  const stepM = totalM / (n - 1);

  // Resample by linear interpolation.
  const resampled = new Float64Array(n);
  let j = 0;
  const last = rawD.length - 1;
  for (let i = 0; i < n; i++) {
    const d = i * stepM;
    while (j < last && rawD[j + 1]! < d) j++;
    if (d <= rawD[0]!) resampled[i] = rawE[0]!;
    else if (j >= last) resampled[i] = rawE[last]!;
    else {
      const d0 = rawD[j]!;
      const d1 = rawD[j + 1]!;
      const t = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
      resampled[i] = rawE[j]! + t * (rawE[j + 1]! - rawE[j]!);
    }
  }

  // Centred moving average; the window shrinks symmetrically near the ends.
  const ele = new Float64Array(n);
  const half = Math.floor(SMOOTH_WINDOW / 2);
  for (let i = 0; i < n; i++) {
    const k = Math.min(half, i, n - 1 - i);
    let sum = 0;
    for (let m = i - k; m <= i + k; m++) sum += resampled[m]!;
    ele[i] = sum / (2 * k + 1);
  }

  const cumGain = new Float64Array(n);
  const cumLoss = new Float64Array(n);
  let minEle = ele[0]!;
  let maxEle = ele[0]!;
  for (let i = 1; i < n; i++) {
    const d = ele[i]! - ele[i - 1]!;
    cumGain[i] = cumGain[i - 1]! + (d > 0 ? d : 0);
    cumLoss[i] = cumLoss[i - 1]! + (d < 0 ? -d : 0);
    if (ele[i]! < minEle) minEle = ele[i]!;
    if (ele[i]! > maxEle) maxEle = ele[i]!;
  }

  return { n, stepM, totalM, ele, cumGain, cumLoss, gainM: cumGain[n - 1]!, lossM: cumLoss[n - 1]!, minEle, maxEle };
}

function interp(arr: Float64Array, p: Profile, alongM: number): number {
  const x = Math.min(p.n - 1, Math.max(0, alongM / p.stepM));
  const i = Math.min(p.n - 2, Math.floor(x));
  const t = x - i;
  return arr[i]! + t * (arr[i + 1]! - arr[i]!);
}

export function elevationAt(p: Profile, alongM: number): number {
  return interp(p.ele, p, alongM);
}

/** Slope (rise / run) around a point, measured over ±2 samples. */
export function gradeAt(p: Profile, alongM: number): number {
  const span = 2 * p.stepM;
  const a = Math.max(0, alongM - span);
  const b = Math.min(p.totalM, alongM + span);
  return b > a ? (elevationAt(p, b) - elevationAt(p, a)) / (b - a) : 0;
}

/** Smoothed ascent and descent between two distances along the trail. */
export function gainLossBetween(p: Profile, fromM: number, toM: number): { gainM: number; lossM: number } {
  if (toM <= fromM) return { gainM: 0, lossM: 0 };
  return {
    gainM: Math.max(0, interp(p.cumGain, p, toM) - interp(p.cumGain, p, fromM)),
    lossM: Math.max(0, interp(p.cumLoss, p, toM) - interp(p.cumLoss, p, fromM)),
  };
}

export interface ChartSeries {
  dist: Float64Array;
  ele: Float64Array;
}

/**
 * Reduce the profile to at most ~maxPoints for drawing. Each bucket contributes its lowest and
 * highest sample, in order, so summits and cols survive downsampling of 100k-point tracks.
 */
export function chartSeries(p: Profile, maxPoints: number): ChartSeries {
  if (p.n <= maxPoints) {
    const dist = new Float64Array(p.n);
    for (let i = 0; i < p.n; i++) dist[i] = i * p.stepM;
    return { dist, ele: p.ele.slice() };
  }
  const buckets = Math.max(1, Math.floor(maxPoints / 2));
  const dist: number[] = [];
  const ele: number[] = [];
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor((b * p.n) / buckets);
    const end = Math.max(start + 1, Math.floor(((b + 1) * p.n) / buckets));
    let lo = start;
    let hi = start;
    for (let i = start; i < end; i++) {
      if (p.ele[i]! < p.ele[lo]!) lo = i;
      if (p.ele[i]! > p.ele[hi]!) hi = i;
    }
    const first = Math.min(lo, hi);
    const second = Math.max(lo, hi);
    dist.push(first * p.stepM);
    ele.push(p.ele[first]!);
    if (second !== first) {
      dist.push(second * p.stepM);
      ele.push(p.ele[second]!);
    }
  }
  // Always end exactly at the finish.
  if (dist[dist.length - 1] !== p.totalM) {
    dist.push(p.totalM);
    ele.push(p.ele[p.n - 1]!);
  }
  return { dist: Float64Array.from(dist), ele: Float64Array.from(ele) };
}
